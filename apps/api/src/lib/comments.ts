/**
 * Comentarios (fase 5).
 *
 * El documento Yjs es la **fuente de verdad**: los comentarios viven en
 * `doc.getMap('comments')` como `Y.Map` planos (ver `comments.ts` de
 * `@tablero/shared` y `apps/web/src/collab/comments.ts`, que es el contrato).
 * Acá viven:
 *
 *   - la extracción del documento a la tabla `Comment` (upsert + borrado de los
 *     que ya no están), que corre en el hook de persistencia y antes de listar;
 *   - las notificaciones de menciones y respuestas, idempotentes por fila;
 *   - las mutaciones que pide la interfaz (resolver, reabrir, borrar) aplicadas
 *     **al documento** —vivo si hay servidor, persistido si no— y reflejadas
 *     enseguida en la tabla.
 *
 * La fila que se devuelve por REST es **plana** y espeja el `Y.Map`: la web
 * mapea `parentCommentId` a su `parentId` y espera `x`, `y`, `resolvedAt`,
 * `resolvedBy` y `mentions`.
 */

import type { CommentRow } from '@tablero/shared';
import { COMMENT_MAX_LENGTH, elementsOf, readComments, removeComment, resolveComment } from '@tablero/shared';
import type { CommentEntry } from '@tablero/shared';
import * as Y from 'yjs';

import { flushBoardDocument, transactBoardDocument } from '../collab/server.js';
import { prisma } from '../db.js';
import { loadBoardDoc } from './documents.js';
import { createNotification } from './notifications.js';
import { boardMentionTargets } from './members.js';

export type ExtractedCommentRow = {
  id: string;
  boardId: string;
  elementId: string | null;
  parentCommentId: string | null;
  authorId: string;
  body: string;
  x: number | null;
  y: number | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  mentions: string[];
  createdAt: Date;
};

export const COMMENT_SYNC_ORIGIN = 'comments:sync';

/**
 * Una fila por comentario (raíz o respuesta) con la forma plana del documento.
 *
 * Contrato del anclaje: `elementId` solo viaja si el elemento **existe en el
 * documento** (igual que valida `recordActivity`). Un comentario anclado a una
 * tarjeta borrada queda como **chincheta libre** (`elementId: null`): el
 * comentario no se pierde (podría tener respuestas y texto del usuario) y sigue
 * apareciendo en el listado, sin apuntar a nada.
 */
export function commentRowsFromDoc(boardId: string, doc: Y.Doc): ExtractedCommentRow[] {
  const entries = readComments(doc);
  const elementIds = new Set(elementsOf(doc).keys());
  const roots = new Map(entries.filter((entry) => entry.parentId === null).map((entry) => [entry.id, entry]));
  return entries.map((entry: CommentEntry) => {
    // Resolver es del hilo entero: la respuesta hereda la marca de su raíz para
    // que los filtros de abiertos/resueltos no la dejen suelta.
    const root = entry.parentId !== null ? roots.get(entry.parentId) : entry;
    const resolvedAt = root?.resolvedAt ?? entry.resolvedAt;
    const elementId = entry.elementId !== null && elementIds.has(entry.elementId) ? entry.elementId : null;
    return {
      id: entry.id,
      boardId,
      elementId,
      parentCommentId: entry.parentId,
      authorId: entry.authorId,
      body: entry.body.slice(0, COMMENT_MAX_LENGTH),
      x: entry.x,
      y: entry.y,
      resolvedAt: resolvedAt !== null ? new Date(resolvedAt) : null,
      resolvedBy: resolvedAt !== null ? (root?.resolvedBy ?? entry.resolvedBy) : null,
      mentions: entry.mentions,
      createdAt: new Date(entry.createdAt),
    };
  });
}

/**
 * Quita las filas que la tabla no puede guardar: un autor que ya no existe (FK
 * a `User`) o una respuesta cuyo hilo padre no está en el documento (FK propia
 * de `parentCommentId`). Un documento manipulado (o una cuenta borrada) no
 * puede tumbar la sincronización.
 */
async function withoutDanglingReferences(rows: ExtractedCommentRow[]): Promise<ExtractedCommentRow[]> {
  if (rows.length === 0) return rows;
  const authorIds = [...new Set(rows.map((row) => row.authorId))];
  const authors = await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true } });
  const known = new Set(authors.map((author) => author.id));
  const commentIds = new Set(rows.map((row) => row.id));
  return rows.filter(
    (row) => known.has(row.authorId) && (row.parentCommentId === null || commentIds.has(row.parentCommentId)),
  );
}

/**
 * Sincroniza la tabla con el documento: upsert de lo que hay y borrado de lo
 * que ya no está. Como los ids de las filas son los del documento, borrar un
 * hilo o una respuesta en el documento los borra también de la tabla.
 *
 * El documento es del cliente y no siempre está bien formado, así que la
 * sincronización **nunca lanza** por un comentario raro:
 *
 *   - un comentario de un autor que ya no existe no se sincroniza (la tabla
 *     tiene FK a `User` y antes tumbaba la petición con un 500); se ignora en
 *     silencio, como los eventos de actividad de elementos inexistentes;
 *   - una respuesta cuyo hilo padre no está en el documento tampoco (FK propia
 *     de `parentCommentId`).
 */
export async function syncBoardComments(
  boardId: string,
  doc: Y.Doc,
): Promise<{ upserted: number; removed: number; mentions: number; replies: number }> {
  const extracted = commentRowsFromDoc(boardId, doc);
  const rows = await withoutDanglingReferences(extracted);
  const ids = rows.map((row) => row.id);
  const removed = await prisma.comment.deleteMany({ where: { boardId, id: { notIn: ids } } });

  for (const row of rows) {
    await prisma.comment.upsert({
      where: { id: row.id },
      create: {
        id: row.id,
        boardId: row.boardId,
        elementId: row.elementId,
        parentCommentId: row.parentCommentId,
        authorId: row.authorId,
        body: row.body,
        x: row.x,
        y: row.y,
        resolvedAt: row.resolvedAt,
        resolvedBy: row.resolvedBy,
        mentions: row.mentions,
        createdAt: row.createdAt,
      },
      update: {
        elementId: row.elementId,
        body: row.body,
        x: row.x,
        y: row.y,
        resolvedAt: row.resolvedAt,
        resolvedBy: row.resolvedBy,
        mentions: row.mentions,
      },
    });
  }

  const replies = await notifyCommentReplies(boardId, rows);
  const mentions = await notifyCommentMentions(boardId, rows);
  return { upserted: rows.length, removed: removed.count, mentions, replies };
}

/**
 * Sincroniza desde el documento vivo (si el tablero está abierto en el servidor
 * de colaboración) o desde el estado persistido. Es lo que corre antes de
 * listar: el panel nunca muestra un hilo más viejo que el documento.
 */
export async function syncCommentsFromBoard(boardId: string): Promise<{ upserted: number; removed: number; live: boolean }> {
  // Abrir y cerrar el documento vivo lo persiste (el hook de persistencia corre
  // al desconectar la conexión directa), así que el estado en Postgres ya es el
  // último y la tabla se sincroniza de ahí.
  const live = await flushBoardDocument(boardId);
  const doc = await loadBoardDoc(boardId);
  if (!doc) return { upserted: 0, removed: 0, live };
  const result = await syncBoardComments(boardId, doc);
  return { upserted: result.upserted, removed: result.removed, live };
}

// --- Menciones y respuestas -------------------------------------------------

/** Tokens `@algo` del cuerpo (email o nombre, sin espacios). */
export function extractMentions(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/@([^\s@,.;:!?()[\]{}<>"']+)/g)) {
    const token = match[1];
    if (token && token.length > 0) found.add(token.toLowerCase());
  }
  return [...found];
}

/** Normaliza un texto para comparar menciones: minúsculas y sin separadores. */
function mentionKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Candidatos de un miembro para resolver `@token`: email, parte local del email,
 * nombre completo y **cada palabra** del nombre. La mención escrita en el editor
 * no puede llevar espacios (`@Beto Lector` llega como `@Beto`), así que se
 * resuelve por cualquier palabra: «D Caro» se menciona con `@D` o con `@Caro`
 * (antes solo valía la primera palabra, y `@Caro` no encontraba a nadie).
 */
function mentionCandidates(target: { name: string; email: string }): string[] {
  const local = target.email.split('@')[0] ?? '';
  const words = target.name
    .trim()
    .split(/\s+/)
    .map(mentionKey)
    .filter((word) => word.length >= 2);
  return [...new Set([mentionKey(target.email), mentionKey(local), mentionKey(target.name), ...words])].filter(
    (candidate) => candidate.length >= 2,
  );
}

/**
 * Crea la notificación de mención de cada comentario. La web resuelve las
 * menciones al escribirlas y guarda los ids en `mentions`; acá se notifica a
 * esos ids (siempre que sean miembros del tablero) y, como respaldo, se
 * resuelven los `@token` del cuerpo contra los miembros (email, parte local,
 * nombre completo o primer nombre).
 *
 * Idempotente: la clave es (comentario, usuario), así que editar el comentario
 * o volver a sincronizar no duplica el aviso.
 */
export async function notifyCommentMentions(boardId: string, rows: ExtractedCommentRow[]): Promise<number> {
  const withMentions = rows.filter((row) => row.mentions.length > 0 || row.body.includes('@'));
  if (withMentions.length === 0) return 0;
  const targets = await boardMentionTargets(boardId);
  if (targets.length === 0) return 0;
  const byUserId = new Map(targets.map((target) => [target.userId, target]));

  let created = 0;
  for (const row of withMentions) {
    const wanted = new Map<string, { userId: string; name: string }>();
    for (const mentionedId of row.mentions) {
      const target = byUserId.get(mentionedId);
      if (target && target.userId !== row.authorId) wanted.set(target.userId, target);
    }
    const tokens = extractMentions(row.body).map(mentionKey).filter((token) => token.length >= 2);
    if (tokens.length > 0) {
      for (const target of targets) {
        if (target.userId === row.authorId) continue;
        if (wanted.has(target.userId)) continue;
        const candidates = mentionCandidates(target);
        if (tokens.some((token) => candidates.includes(token))) wanted.set(target.userId, target);
      }
    }
    for (const target of wanted.values()) {
      const result = await createNotification({
        userId: target.userId,
        kind: 'mention',
        boardId,
        elementId: row.elementId ?? row.parentCommentId ?? row.id,
        actorId: row.authorId,
        meta: { commentId: row.id, body: row.body.slice(0, 200) },
        dedupeKey: `mention:${row.id}:${target.userId}`,
      });
      if (result.created) created += 1;
    }
  }
  return created;
}

/**
 * Avisa al autor del comentario raíz que le respondieron (una fila por
 * respuesta). Si al autor ya le llegó la mención de esa misma respuesta, la
 * clave distinta produce dos avisos: es intencional, son dos hechos (te
 * respondieron y te mencionaron).
 */
export async function notifyCommentReplies(boardId: string, rows: ExtractedCommentRow[]): Promise<number> {
  const replies = rows.filter((row) => row.parentCommentId !== null);
  if (replies.length === 0) return 0;
  const roots = new Map(rows.filter((row) => row.parentCommentId === null).map((row) => [row.id, row]));
  let created = 0;
  for (const reply of replies) {
    const root = roots.get(reply.parentCommentId!);
    if (!root || root.authorId === reply.authorId) continue;
    const result = await createNotification({
      userId: root.authorId,
      kind: 'reply',
      boardId,
      elementId: root.elementId ?? root.id,
      actorId: reply.authorId,
      meta: { commentId: reply.id, rootCommentId: root.id, body: reply.body.slice(0, 200) },
      dedupeKey: `reply:${reply.id}:${root.authorId}`,
    });
    if (result.created) created += 1;
  }
  return created;
}

// --- Lectura ----------------------------------------------------------------

type CommentRecord = {
  id: string;
  boardId: string;
  elementId: string | null;
  parentCommentId: string | null;
  authorId: string;
  body: string;
  x: number | null;
  y: number | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  mentions: unknown;
  createdAt: Date;
  author: { name: string; avatarUrl: string | null };
};

function toCommentRow(row: CommentRecord): CommentRow {
  const mentions = Array.isArray(row.mentions)
    ? row.mentions.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: row.id,
    boardId: row.boardId,
    elementId: row.elementId,
    parentCommentId: row.parentCommentId,
    authorId: row.authorId,
    authorName: row.author.name,
    authorAvatarUrl: row.author.avatarUrl,
    body: row.body,
    x: row.x,
    y: row.y,
    resolvedAt: row.resolvedAt ? row.resolvedAt.getTime() : null,
    resolvedBy: row.resolvedBy,
    mentions,
    createdAt: row.createdAt.getTime(),
  };
}

export type ListCommentsOptions = { filter: 'all' | 'open' | 'resolved'; elementId?: string | undefined };

/**
 * Comentarios del tablero en **forma plana** (una fila por comentario, raíz o
 * respuesta), lo más nuevo primero. La web arma los hilos en el cliente con
 * `commentThreads()`, igual que con los del documento.
 */
export async function listBoardComments(boardId: string, options: ListCommentsOptions): Promise<CommentRow[]> {
  const rows = await prisma.comment.findMany({
    where: {
      boardId,
      ...(options.elementId ? { elementId: options.elementId } : {}),
      ...(options.filter === 'open' ? { resolvedAt: null } : {}),
      ...(options.filter === 'resolved' ? { resolvedAt: { not: null } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { author: { select: { name: true, avatarUrl: true } } },
  });
  return rows.map(toCommentRow);
}

// --- Mutaciones -------------------------------------------------------------

export type CommentMutation = 'resolve' | 'reopen' | 'delete';

export type CommentRowTarget = {
  id: string;
  boardId: string;
  elementId: string | null;
  parentCommentId: string | null;
  authorId: string;
};

/**
 * Aplica la mutación al documento (vivo si hay servidor de colaboración,
 * persistido si no) y sincroniza la tabla acto seguido.
 *
 * Resolver y reabrir marcan la **raíz** del hilo (una respuesta redirige a su
 * raíz). Borrar una respuesta cae con esa respuesta sola y borrar la raíz cae
 * con el hilo completo. La conexión directa del servidor persiste el documento
 * al cerrarse, así que releer el estado ya trae el cambio.
 */
export async function mutateCommentDocument(
  boardId: string,
  target: CommentRowTarget,
  mutation: CommentMutation,
  options: { by?: string | null } = {},
): Promise<{ changed: boolean; live: boolean }> {
  const rootId = target.parentCommentId ?? target.id;
  const by = options.by ?? null;
  let changed = false;

  const apply = (doc: Y.Doc): void => {
    if (mutation === 'resolve') {
      changed = resolveComment(doc, rootId, true, by, COMMENT_SYNC_ORIGIN);
      return;
    }
    if (mutation === 'reopen') {
      changed = resolveComment(doc, rootId, false, null, COMMENT_SYNC_ORIGIN);
      return;
    }
    changed = removeComment(doc, target.id, COMMENT_SYNC_ORIGIN).length > 0;
  };

  const live = await transactBoardDocument(boardId, apply, { source: COMMENT_SYNC_ORIGIN });

  if (live) {
    const doc = await loadBoardDoc(boardId);
    if (doc) await syncBoardComments(boardId, doc);
    return { changed, live: true };
  }

  const persisted = await loadBoardDoc(boardId);
  if (!persisted) return { changed: false, live: false };
  apply(persisted);
  await prisma.boardDocument.upsert({
    where: { boardId },
    create: { boardId, yjsState: Buffer.from(Y.encodeStateAsUpdate(persisted)) },
    update: { yjsState: Buffer.from(Y.encodeStateAsUpdate(persisted)) },
  });
  await syncBoardComments(boardId, persisted);
  return { changed, live: false };
}

/** ¿El comentario existe en el documento persistido? */
export async function commentExists(boardId: string, commentId: string): Promise<boolean> {
  const doc = await loadBoardDoc(boardId);
  if (!doc) return false;
  return readComments(doc).some((entry) => entry.id === commentId);
}

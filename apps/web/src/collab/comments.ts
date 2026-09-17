/**
 * Comentarios (punto 5 de la fase 5).
 *
 * Decisión de la fase: **los comentarios viven en el documento Yjs**, así el
 * tiempo real sale gratis y el documento sigue siendo la fuente de verdad
 * (igual que con el índice de búsqueda). El servidor los extrae a su tabla en
 * el hook de persistencia.
 *
 * Modelo (contrato que la API reproduce en `Comment`):
 *
 *   doc.getMap('comments')            // Y.Map<Y.Map>
 *     └─ <commentId>: Y.Map plano con
 *          id, body, authorId, authorName, createdAt,
 *          elementId  (anclaje a una tarjeta) | null
 *          x, y       (chincheta libre en el lienzo, en coordenadas de mundo)
 *          parentId   (respuesta: id del comentario raíz) | null
 *          resolvedAt, resolvedBy | null
 *          mentions   (JSON con los ids mencionados)
 *
 * Un hilo es un comentario raíz (`parentId: null`) más sus respuestas. Se
 * guardan planos (sin anidar Y.Map dentro de Y.Map) por el mismo motivo que los
 * elementos: merges predecibles y extracción trivial en el servidor.
 */

import * as Y from 'yjs';

import { createId } from '@tablero/shared';

export const COMMENTS_KEY = 'comments';

/** Tope de caracteres de un comentario (coherente con el límite del API). */
export const COMMENT_MAX_LENGTH = 2000;

/** Tope de menciones que se resuelven en un comentario. */
export const MENTION_LIMIT = 20;

export type CommentEntry = {
  id: string;
  parentId: string | null;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  /** Tarjeta anclada, o `null` si es una chincheta libre en el lienzo. */
  elementId: string | null;
  x: number | null;
  y: number | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
  mentions: string[];
};

export type CommentThread = {
  root: CommentEntry;
  replies: CommentEntry[];
  resolved: boolean;
};

export type CommentDraft = {
  body: string;
  authorId: string;
  authorName: string;
  elementId?: string | null;
  x?: number | null;
  y?: number | null;
  parentId?: string | null;
  mentions?: string[];
  createdAt?: number;
  id?: string;
};

export function commentsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(COMMENTS_KEY);
}

function readString(map: Y.Map<unknown>, key: string): string | null {
  const value = map.get(key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(map: Y.Map<unknown>, key: string): number | null {
  const value = map.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readMentions(map: Y.Map<unknown>): string[] {
  const raw = map.get('mentions');
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string');
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
    } catch {
      return [];
    }
  }
  return [];
}

/** Lee un `Y.Map` de comentario. Devuelve `null` si no tiene forma válida. */
export function readComment(map: Y.Map<unknown>): CommentEntry | null {
  const id = readString(map, 'id');
  const authorId = readString(map, 'authorId');
  if (!id || !authorId) return null;
  const body = map.get('body');
  return {
    id,
    parentId: readString(map, 'parentId'),
    body: typeof body === 'string' ? body : '',
    authorId,
    authorName: readString(map, 'authorName') ?? 'Alguien',
    createdAt: readNumber(map, 'createdAt') ?? 0,
    elementId: readString(map, 'elementId'),
    x: readNumber(map, 'x'),
    y: readNumber(map, 'y'),
    resolvedAt: readNumber(map, 'resolvedAt'),
    resolvedBy: readString(map, 'resolvedBy'),
    mentions: readMentions(map),
  };
}

export function readComments(doc: Y.Doc): CommentEntry[] {
  const result: CommentEntry[] = [];
  commentsOf(doc).forEach((map) => {
    const entry = readComment(map);
    if (entry) result.push(entry);
  });
  return result.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function getComment(doc: Y.Doc, id: string): CommentEntry | null {
  const map = commentsOf(doc).get(id);
  return map ? readComment(map) : null;
}

/** Crea un comentario (raíz o respuesta) y devuelve su id. */
export function addComment(doc: Y.Doc, draft: CommentDraft, origin: unknown = null): string {
  const id = draft.id ?? createId('cm');
  const now = draft.createdAt ?? Date.now();
  const body = draft.body.slice(0, COMMENT_MAX_LENGTH);
  const map = new Y.Map<unknown>();
  doc.transact(() => {
    commentsOf(doc).set(id, map);
  }, origin);
  doc.transact(() => {
    map.set('id', id);
    map.set('parentId', draft.parentId ?? null);
    map.set('body', body);
    map.set('authorId', draft.authorId);
    map.set('authorName', draft.authorName);
    map.set('createdAt', now);
    map.set('elementId', draft.elementId ?? null);
    map.set('x', draft.x ?? null);
    map.set('y', draft.y ?? null);
    map.set('resolvedAt', null);
    map.set('resolvedBy', null);
    map.set('mentions', JSON.stringify(draft.mentions ?? []));
  }, origin);
  return id;
}

export function updateCommentBody(doc: Y.Doc, id: string, body: string, origin: unknown = null): void {
  const map = commentsOf(doc).get(id);
  if (!map) return;
  doc.transact(() => {
    map.set('body', body.slice(0, COMMENT_MAX_LENGTH));
  }, origin);
}

export function setCommentMentions(doc: Y.Doc, id: string, mentions: string[], origin: unknown = null): void {
  const map = commentsOf(doc).get(id);
  if (!map) return;
  doc.transact(() => {
    map.set('mentions', JSON.stringify(mentions.slice(0, MENTION_LIMIT)));
  }, origin);
}

/** Resuelve o reabre un hilo (marca el comentario raíz). */
export function resolveComment(
  doc: Y.Doc,
  id: string,
  resolved: boolean,
  by: string | null,
  origin: unknown = null,
): void {
  const map = commentsOf(doc).get(id);
  if (!map) return;
  doc.transact(() => {
    map.set('resolvedAt', resolved ? Date.now() : null);
    map.set('resolvedBy', resolved ? by : null);
  }, origin);
}

/** Borra un comentario y, si es raíz, sus respuestas. */
export function removeComment(doc: Y.Doc, id: string, origin: unknown = null): string[] {
  const store = commentsOf(doc);
  const removed: string[] = [id];
  store.forEach((map, key) => {
    if (readString(map, 'parentId') === id) removed.push(key);
  });
  doc.transact(() => {
    for (const key of removed) store.delete(key);
  }, origin);
  return removed;
}

// --- Proyección (pura) ------------------------------------------------------

/** Hilos del tablero: raíces con sus respuestas, del más nuevo al más viejo. */
export function commentThreads(entries: CommentEntry[]): CommentThread[] {
  const roots = entries.filter((entry) => entry.parentId === null);
  const repliesByRoot = new Map<string, CommentEntry[]>();
  for (const entry of entries) {
    if (!entry.parentId) continue;
    const list = repliesByRoot.get(entry.parentId);
    if (list) list.push(entry);
    else repliesByRoot.set(entry.parentId, [entry]);
  }
  return roots
    .map((root) => {
      const replies = (repliesByRoot.get(root.id) ?? []).sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      );
      // Un hilo está resuelto si lo está su raíz: resolver es del hilo entero.
      return { root, replies, resolved: root.resolvedAt !== null };
    })
    .sort((a, b) => b.root.createdAt - a.root.createdAt || a.root.id.localeCompare(b.root.id));
}

export function openThreads(entries: CommentEntry[]): CommentThread[] {
  return commentThreads(entries).filter((thread) => !thread.resolved);
}

export function resolvedThreads(entries: CommentEntry[]): CommentThread[] {
  return commentThreads(entries).filter((thread) => thread.resolved);
}

/** Hilos (raíces) anclados a una tarjeta concreta. */
export function threadsForElement(entries: CommentEntry[], elementId: string): CommentThread[] {
  return commentThreads(entries.filter((entry) => entry.elementId === elementId));
}

/** Chinchetas libres del lienzo (sin tarjeta anclada). */
export function pinnedThreads(entries: CommentEntry[]): CommentThread[] {
  return commentThreads(entries).filter(
    (thread) => thread.root.elementId === null && thread.root.x !== null && thread.root.y !== null,
  );
}

/** Contador que va en el icono de la tarjeta: comentarios **abiertos** del hilo. */
export function elementCommentCount(entries: CommentEntry[], elementId: string): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.elementId !== elementId) continue;
    const resolved = entry.parentId === null ? entry.resolvedAt !== null : rootResolved(entries, entry);
    if (!resolved) count += 1;
  }
  return count;
}

function rootResolved(entries: CommentEntry[], reply: CommentEntry): boolean {
  if (!reply.parentId) return reply.resolvedAt !== null;
  const root = entries.find((entry) => entry.id === reply.parentId);
  return root ? root.resolvedAt !== null : false;
}

export function openCommentCount(entries: CommentEntry[]): number {
  return openThreads(entries).length;
}

export function resolvedCommentCount(entries: CommentEntry[]): number {
  return resolvedThreads(entries).length;
}

// --- Menciones --------------------------------------------------------------

export type MentionCandidate = { userId: string; name: string; email: string };

export type MentionQuery = {
  /** Texto escrito después de la arroba (puede estar vacío). */
  query: string;
  /** Índice de la arroba en el texto. */
  start: number;
  /** Índice del final del token (`caret` o el primer espacio). */
  end: number;
};

const MENTION_TOKEN = /@([\p{L}\p{N}._-]*)$/u;

/**
 * Detecta si el cursor está escribiendo una mención: la arroba más cercana
 * antes del cursor, sin espacios en medio.
 */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const match = MENTION_TOKEN.exec(upto);
  if (!match) return null;
  const start = upto.length - match[0].length;
  return { query: match[1] ?? '', start, end: upto.length };
}

/**
 * Aplica una mención: reemplaza el token `@lo-que-sea` por `@Nombre` y deja el
 * cursor después. Si ya hay un espacio después del token no se añade otro.
 */
export function insertMention(
  text: string,
  query: MentionQuery,
  name: string,
): { text: string; caret: number } {
  const before = text.slice(0, query.start);
  const after = text.slice(query.end);
  const suffix = after.startsWith(' ') ? '' : ' ';
  const inserted = `@${name}${suffix}`;
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

/**
 * Miembros que hay que notificar: cada `@Nombre` del texto resuelto contra la
 * lista de miembros (por nombre o por email). Sin duplicados y en orden.
 */
export function resolveMentions(text: string, members: MentionCandidate[]): MentionCandidate[] {
  if (members.length === 0) return [];
  const byName = new Map<string, MentionCandidate>();
  for (const member of members) {
    byName.set(member.name.toLowerCase(), member);
    if (member.email) byName.set(member.email.toLowerCase(), member);
    const first = member.name.trim().split(/\s+/)[0];
    if (first && first.length > 1) byName.set(first.toLowerCase(), member);
  }
  const found = new Map<string, MentionCandidate>();
  const pattern = /@([\p{L}\p{N}._-]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const key = (match[1] ?? '').toLowerCase();
    if (!key) continue;
    const member = byName.get(key);
    if (!member) continue;
    found.set(member.userId, member);
    if (found.size >= MENTION_LIMIT) break;
  }
  return [...found.values()];
}

/** Trozos del texto para pintarlo con las menciones resaltadas. */
export type CommentSegment = { text: string; mention: boolean };

export function commentSegments(text: string): CommentSegment[] {
  const segments: CommentSegment[] = [];
  const pattern = /@([\p{L}\p{N}._-]+)/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), mention: false });
    segments.push({ text: match[0], mention: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mention: false });
  return segments;
}

/** Fecha relativa corta («hace 5 min») para la lista de comentarios. */
export function relativeTime(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const date = new Date(at);
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

/**
 * Comentarios (fase 5): el documento Yjs es la fuente de verdad.
 *
 * Modelo — el mismo que usa la web (`apps/web/src/collab/comments.ts`), que es
 * el contrato de esta fase:
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
 * guardan planos (sin anidar Y.Map dentro de Y.Map) para que los merges sean
 * predecibles y la extracción en el servidor sea trivial: el hook de
 * persistencia los copia a la tabla `Comment` con la misma forma.
 */

import * as Y from 'yjs';

import { createId } from './ids.js';

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

/** Todos los comentarios del documento, del más viejo al más nuevo. */
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
  options: { now?: number } = {},
): boolean {
  const map = commentsOf(doc).get(id);
  if (!map) return false;
  const now = options.now ?? Date.now();
  doc.transact(() => {
    map.set('resolvedAt', resolved ? now : null);
    map.set('resolvedBy', resolved ? by : null);
  }, origin);
  return true;
}

/** Borra un comentario y, si es raíz, sus respuestas. Devuelve los ids borrados. */
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

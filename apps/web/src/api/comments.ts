/**
 * Comentarios por REST (complemento del documento).
 *
 * El documento Yjs es la **fuente de verdad** de los comentarios: las
 * mutaciones se hacen ahí (tiempo real gratis) y el servidor los extrae a su
 * tabla en el hook de persistencia. Este módulo existe para dos cosas:
 *
 * 1. Leer el listado del servidor (mismo contenido, ya extraído); sirve para
 *    comparar y para mostrar los comentarios de un tablero cuyo documento no
 *    está abierto en este cliente.
 * 2. Espejar una mutación recién hecha (`PATCH /comments/:id/resolve`,
 *    `DELETE /comments/:id`) para que la tabla del servidor quede al día antes
 *    del próximo guardado. es *best-effort*: si el endpoint no está, la
 *    extracción del documento lo resolverá igual y nadie se entera.
 */

import { type CommentEntry } from '@/collab/comments';
import { apiRequest } from './client';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseComment(raw: unknown): CommentEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = asRecord(raw);
  const id = typeof record['id'] === 'string' ? record['id'] : null;
  const authorId = typeof record['authorId'] === 'string' ? record['authorId'] : null;
  if (!id || !authorId) return null;
  const mentions = Array.isArray(record['mentions'])
    ? (record['mentions'] as unknown[]).filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id,
    parentId: typeof record['parentCommentId'] === 'string' ? record['parentCommentId'] : null,
    body: typeof record['body'] === 'string' ? record['body'] : '',
    authorId,
    authorName: typeof record['authorName'] === 'string' ? record['authorName'] : 'Alguien',
    createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : 0,
    elementId: typeof record['elementId'] === 'string' ? record['elementId'] : null,
    x: typeof record['x'] === 'number' ? record['x'] : null,
    y: typeof record['y'] === 'number' ? record['y'] : null,
    resolvedAt: typeof record['resolvedAt'] === 'number' ? record['resolvedAt'] : null,
    resolvedBy: typeof record['resolvedBy'] === 'string' ? record['resolvedBy'] : null,
    mentions,
  };
}

export async function fetchBoardComments(boardId: string): Promise<CommentEntry[]> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(boardId)}/comments`);
  const record = asRecord(payload);
  const list = Array.isArray(payload) ? payload : Array.isArray(record['comments']) ? (record['comments'] as unknown[]) : [];
  return list.map(parseComment).filter((comment): comment is CommentEntry => comment !== null);
}

/** Espeja la resolución de un hilo. Nunca lanza: el documento ya la aplicó. */
export async function mirrorCommentResolve(commentId: string, resolved: boolean): Promise<boolean> {
  try {
    await apiRequest<unknown>(`/comments/${encodeURIComponent(commentId)}/resolve`, {
      method: 'PATCH',
      body: { resolved },
    });
    return true;
  } catch {
    return false;
  }
}

/** Espeja el borrado de un comentario. Nunca lanza. */
export async function mirrorCommentDelete(commentId: string): Promise<boolean> {
  try {
    await apiRequest<void>(`/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Acciones de la papelera de elementos del documento.
 *
 * Borrar una tarjeta la manda a la papelera (marca, no mover), así que el
 * archivo (asset) se libera recién cuando el elemento sale del documento para
 * siempre: al vaciar la papelera o al purgar lo que superó los 30 días. Esos dos
 * caminos pasan por acá, que primero junta lo que va a caer (para liberar sus
 * assets después) y recién entonces llama al dominio compartido.
 */

import {
  type CanvasElement,
  TRASH_TTL_MS,
  emptyTrash,
  getTrashedElements,
  purgeTrash,
  restoreElements,
} from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { releaseUnreferencedAssets } from '@/lib/assetCleanup';

/** Elementos de la papelera del documento, del más reciente al más viejo. */
export function trashedElements(session: BoardSession): CanvasElement[] {
  return getTrashedElements(session.doc);
}

/** Restaura elementos de la papelera (quita la marca; los hijos vienen con ellos). */
export function restoreTrashedElements(session: BoardSession, ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  return restoreElements(session.doc, [...ids], session.origin);
}

/**
 * Purga lo que superó los 30 días (se ejecuta al abrir el tablero). Devuelve los
 * ids eliminados definitivamente.
 */
export async function purgeExpiredTrash(
  session: BoardSession,
  options: { maxAgeMs?: number; now?: number } = {},
): Promise<string[]> {
  const maxAge = options.maxAgeMs ?? TRASH_TTL_MS;
  const now = options.now ?? Date.now();
  const expiring = getTrashedElements(session.doc).filter(
    (element) => now - (element.deletedAt ?? now) >= maxAge,
  );
  const ids = purgeTrash(session.doc, session.origin, options);
  if (ids.length > 0) await releaseUnreferencedAssets(session, expiring);
  return ids;
}

/** Vacía la papelera para siempre (con la liberación de sus archivos). */
export async function emptyTrashForever(session: BoardSession): Promise<string[]> {
  const doomed = getTrashedElements(session.doc);
  const ids = emptyTrash(session.doc, session.origin);
  if (ids.length > 0) await releaseUnreferencedAssets(session, doomed);
  return ids;
}

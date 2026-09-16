/**
 * Mover elementos entre tableros (§5.5).
 *
 * El movimiento es **del lado del cliente**: no hay endpoint que copie
 * documentos. Se abre una sesión temporal del tablero destino, se espera a que
 * sincronice (`synced`), se copian los elementos (con su texto enriquecido, que
 * viaja como instantánea de `Y.XmlFragment`) y recién cuando el servidor
 * confirmó la escritura se borran del origen. Si el destino no sincroniza, no se
 * borra nada: el movimiento falla entero y se avisa.
 *
 * Las columnas viajan con sus hijos: se expande la selección y se remapean
 * `parentId` y `childrenIds` con el mapa de ids nuevos.
 */

import * as Y from 'yjs';

import {
  type CanvasElement,
  type Rect,
  type Size,
  addElement,
  boundsOf,
  boundsOfElements,
  ensureTextFragment,
  getElementMap,
  getTextFragment,
  removeElements,
} from '@tablero/shared';

import { BoardSession } from '@/collab/BoardSession';
import { rawChildIds } from '@/lib/columns';
import { restoreFragment, snapshotFragment } from '@/lib/xmlFragment';
import { useAppStore } from '@/state/appStore';

export const TRANSFER_GAP = 64;

export type TransferFailure = 'same-board' | 'offline' | 'local-target' | 'sync' | 'nothing';

export type TransferResult = { moved: number; failure?: TransferFailure };

/**
 * Plan de colocación: los elementos llegan a la derecha de lo que ya hay en el
 * tablero destino (y si está vacío, al origen).
 */
export function transferOffset(existing: Rect[], group: Rect | null): { dx: number; dy: number } {
  if (!group || existing.length === 0) return { dx: 0, dy: 0 };
  const bounds = boundsOf(existing);
  if (!bounds) return { dx: 0, dy: 0 };
  return {
    dx: bounds.x + bounds.width + TRANSFER_GAP - group.x,
    dy: bounds.y - group.y,
  };
}

/** Expande la selección con los hijos de las columnas (para que viajen enteras). */
export function expandWithColumnChildren(session: BoardSession, ids: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
  };
  for (const id of ids) {
    const element = session.getElement(id);
    if (!element) continue;
    push(id);
    if (element.type === 'column') {
      for (const childId of rawChildIds(session.doc, id)) {
        if (session.getElement(childId)) push(childId);
      }
    }
  }
  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Espera el primer `synced` del proveedor (o el timeout). */
function waitForSync(target: BoardSession, timeoutMs = 6000): Promise<boolean> {
  const provider = target.provider;
  if (!provider) return Promise.resolve(false);
  if (provider.isSynced) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      provider.off('synced', onSynced);
      resolve(value);
    };
    const onSynced = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    provider.on('synced', onSynced);
  });
}

/** Espera a que el proveedor termine de enviar los cambios. */
async function flushProvider(target: BoardSession, timeoutMs = 5000): Promise<boolean> {
  const provider = target.provider;
  if (!provider) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!provider.hasUnsyncedChanges && provider.isSynced) return true;
    await delay(120);
  }
  return !provider.hasUnsyncedChanges;
}

export type TransferOptions = {
  /** Callback de progreso (mensajes para el aviso). */
  onProgress?(message: string): void;
};

/**
 * Mueve elementos (y sus columnas completas) al tablero destino.
 * Nunca lanza: devuelve el motivo del fallo, si lo hubo.
 */
export async function transferElements(
  session: BoardSession,
  ids: readonly string[],
  targetBoardId: string,
  options: TransferOptions = {},
): Promise<TransferResult> {
  if (targetBoardId === session.boardId) return { moved: 0, failure: 'same-board' };
  if (!useAppStore.getState().apiOnline) return { moved: 0, failure: 'offline' };
  if (targetBoardId.startsWith('bd_')) return { moved: 0, failure: 'local-target' };

  const expanded = expandWithColumnChildren(session, ids);
  const sources = expanded
    .map((id) => session.getElement(id))
    .filter((element): element is CanvasElement => element !== null && !element.parentId)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (sources.length === 0) return { moved: 0, failure: 'nothing' };

  options.onProgress?.('Moviendo al tablero destino…');
  const target = new BoardSession({ boardId: targetBoardId, connect: true });
  try {
    await target.init();
    const synced = await waitForSync(target);
    if (!synced) return { moved: 0, failure: 'sync' };

    const existing = target.getLayout().map((item) => ({
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    }));
    const groupRects: Rect[] = sources.map((element) => ({
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height ?? 48,
    }));
    const offset = transferOffset(existing, boundsOf(groupRects));
    const now = Date.now();
    const idMap = new Map<string, string>();

    target.doc.transact(() => {
      for (const source of sources) {
        const init: Record<string, unknown> = {
          ...source,
          x: Math.round(source.x + offset.dx),
          y: Math.round(source.y + offset.dy),
          createdBy: source.createdBy,
          createdAt: now,
          updatedAt: now,
        };
        delete init['id'];
        delete init['parentId'];
        delete init['childrenIds'];
        delete init['text'];
        const created = addElement(target.doc, source.type, init as never, target.origin);
        idMap.set(source.id, created);
      }
      // Segunda pasada: relaciones internas (hijos de columna) con los ids nuevos.
      for (const source of sources) {
        const created = idMap.get(source.id);
        if (!created) continue;
        if (source.parentId) {
          const mapped = idMap.get(source.parentId);
          const map = getElementMap(target.doc, created);
          if (mapped) map?.set('parentId', mapped);
        }
        if (source.type === 'column') {
          const map = getElementMap(target.doc, created);
          const children = new Y.Array<string>();
          for (const childId of rawChildIds(session.doc, source.id)) {
            const mappedChild = idMap.get(childId);
            if (mappedChild) children.push([mappedChild]);
          }
          map?.set('childrenIds', children);
        }
        // Texto enriquecido: instantánea y reconstrucción (no se puede clonar el
        // `Y.XmlFragment` con una actualización binaria).
        const fragment = getTextFragment(session.doc, source.id);
        if (fragment) {
          const destination = ensureTextFragment(target.doc, created, target.origin);
          if (destination) restoreFragment(destination, snapshotFragment(fragment));
        }
      }
    }, target.origin);

    const flushed = await flushProvider(target);
    if (!flushed) return { moved: 0, failure: 'sync' };

    removeElements(session.doc, sources.map((element) => element.id), session.origin);
    return { moved: sources.length };
  } finally {
    target.destroy();
  }
}

/** Mensaje de aviso para cada motivo de fallo. */
export function transferFailureMessage(failure: TransferFailure): string {
  switch (failure) {
    case 'offline':
      return 'Mover entre tableros necesita conexión con el servidor.';
    case 'local-target':
      return 'El tablero destino todavía no está en el servidor.';
    case 'sync':
      return 'El tablero destino no respondió a tiempo: no se movió nada.';
    case 'same-board':
      return 'Las tarjetas ya están en ese tablero.';
    case 'nothing':
    default:
      return 'No hay nada que mover.';
  }
}

/** Tamaño de grupo (para la vista previa del movimiento). */
export function groupSizeOf(sources: readonly CanvasElement[]): Size {
  const rect = boundsOfElements(sources as CanvasElement[]);
  return rect ? { width: rect.width, height: rect.height } : { width: 0, height: 0 };
}

/**
 * Camino del cliente para la captura rápida: escribe la nota en el documento del
 * tablero «Sin ordenar» sin salir del tablero actual.
 *
 * Se usa cuando `POST /api/capture` todavía no responde (contrato en curso con
 * el API). La técnica es la de mover elementos entre tableros: se abre una
 * sesión temporal del destino, se espera el `synced`, se escribe el elemento y
 * se espera a que el proveedor confirme. Nada se borra en el origen.
 */

import {
  addElement,
  type CreateElementInit,
  DEFAULT_SIZES,
  ensureTextFragment,
  getOrderedElements,
} from '@tablero/shared';

import { fetchUnsortedBoard } from '@/api/boards';
import { BoardSession } from '@/collab/BoardSession';
import { writePlainText } from '@/lib/xmlFragment';
import { useAppStore } from '@/state/appStore';

const NOTE_HEIGHT = 120;
const COLUMN_GAP = 24;
const ROW_GAP = 16;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForSync(session: BoardSession, timeoutMs = 6000): Promise<boolean> {
  const provider = session.provider;
  if (!provider) return false;
  if (provider.isSynced) return true;
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

async function flushProvider(session: BoardSession, timeoutMs = 6000): Promise<boolean> {
  const provider = session.provider;
  if (!provider) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (provider.isSynced && !provider.hasUnsyncedChanges) return true;
    await delay(120);
  }
  return !provider.hasUnsyncedChanges;
}

/** Coloca la nota nueva a la izquierda y por encima de lo que ya hay. */
export function capturePlacement(existing: { x: number; y: number; width: number }[]): { x: number; y: number } {
  if (existing.length === 0) return { x: 0, y: 0 };
  let top = Infinity;
  for (const item of existing) top = Math.min(top, item.y);
  return { x: 0, y: top - NOTE_HEIGHT - ROW_GAP - COLUMN_GAP };
}

export type UnsortedCaptureResult = { boardId: string; elementId: string };

/**
 * Crea la nota en «Sin ordenar». Lanza si la API no está o la sesión no
 * sincroniza (el llamante muestra el aviso).
 */
export async function appendNoteToUnsorted(text: string, createdBy: string): Promise<UnsortedCaptureResult> {
  const { board } = await fetchUnsortedBoard();
  useAppStore.getState().upsertBoard(board);

  const target = new BoardSession({ boardId: board.id, connect: true });
  try {
    await target.init();
    const synced = await waitForSync(target);
    if (!synced) throw new Error('el tablero «Sin ordenar» no sincronizó');

    const point = capturePlacement(getOrderedElements(target.doc));
    let elementId = '';
    target.doc.transact(() => {
      const init: Record<string, unknown> = {
        x: point.x,
        y: point.y,
        width: DEFAULT_SIZES.note.width,
        height: NOTE_HEIGHT,
        createdBy,
      };
      elementId = addElement(target.doc, 'note', init as unknown as CreateElementInit, target.origin);
      const fragment = ensureTextFragment(target.doc, elementId, target.origin);
      if (fragment) writePlainText(fragment, text, target.origin);
    }, target.origin);

    const flushed = await flushProvider(target);
    if (!flushed) throw new Error('el servidor no confirmó la nota');
    return { boardId: board.id, elementId };
  } finally {
    target.destroy();
  }
}

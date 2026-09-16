/**
 * Zonas de soltado de tableros.
 *
 * Mover una tarjeta a otro tablero se hace soltándola encima de una tarjeta de
 * tablero (entra al tablero hijo) o sobre una miga de pan (sube al tablero
 * antecesor). Acá se resuelve qué hay debajo del puntero y se resalta el destino.
 */

import type { BoardSession } from '@/collab/BoardSession';

export type BoardDropTarget = {
  /** Tablero destino. */
  boardId: string;
  /** Etiqueta para el indicador (título del tablero). */
  label: string;
  /** Nodo que se resalta. */
  node: HTMLElement;
};

let highlighted: HTMLElement | null = null;

function highlight(node: HTMLElement | null): void {
  if (highlighted === node) return;
  highlighted?.classList.remove('is-drop-target');
  highlighted = node;
  node?.classList.add('is-drop-target');
}

export function clearBoardHighlight(): void {
  highlight(null);
}

/** Tablero destino bajo el puntero (tarjeta de tablero o miga de pan). */
export function boardDropTargetAt(
  clientX: number,
  clientY: number,
  session: BoardSession,
  excludedIds: ReadonlySet<string> = new Set(),
): BoardDropTarget | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    const element = node as HTMLElement;
    const crumb = element.closest?.('[data-drop-target="breadcrumb"][data-board-id]') as HTMLElement | null;
    if (crumb) {
      const boardId = crumb.dataset.boardId;
      if (!boardId || boardId === session.boardId) return null;
      highlight(crumb);
      return { boardId, label: crumb.textContent?.trim() ?? 'Tablero', node: crumb };
    }
    const card = element.closest?.('.el--board[data-element-id]') as HTMLElement | null;
    if (!card) continue;
    const id = card.dataset.elementId;
    if (!id || excludedIds.has(id)) continue;
    const target = session.getElement(id);
    if (!target || target.type !== 'board' || target.boardId.length === 0) continue;
    if (target.boardId === session.boardId) return null;
    highlight(card);
    return { boardId: target.boardId, label: target.icon ? `${target.icon}` : 'Tablero', node: card };
  }
  clearBoardHighlight();
  return null;
}

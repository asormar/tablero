/**
 * Arrastre de tarjetas dentro y entre columnas (kanban).
 *
 * Durante el gesto no se toca el documento: la tarjeta se desplaza con un
 * `transform` relativo (sigue en el flujo de la columna, así el resto no se
 * reacomoda a cada frame) y se publica la línea de inserción. Al soltar se
 * resuelve todo en una sola transacción:
 *
 *   - soltada dentro de una columna → reordena o entra en esa columna
 *   - soltada fuera → sale de la columna y queda suelta en el punto de soltado
 *
 * Las posiciones se leen del DOM (`getBoundingClientRect`), que es la única
 * fuente de verdad de dónde está cada tarjeta dentro de una columna.
 */

import type { Point } from '@tablero/shared';

import { addElementsToColumn, detachFromColumn, reorderInColumn } from '@/canvas/columnCommands';
import type { BoardSession } from '@/collab/BoardSession';
import type { ChildSlot } from '@/lib/kanban';
import { insertionIndexFromPoint, insertionLineY } from '@/lib/kanban';

/** Rectángulo del cuerpo de una columna, en coordenadas de pantalla. */
export type ColumnBodyRect = { id: string; left: number; top: number; width: number; height: number };

export type KanbanTarget = {
  columnId: string;
  index: number;
  /** Línea de inserción, en coordenadas de pantalla (para el indicador). */
  line: { x: number; y: number; width: number };
  /** Rectángulo del cuerpo de la columna destino (para resaltarla). */
  body: ColumnBodyRect;
};

function toSlots(nodes: Element[], dragged: ReadonlySet<string>): ChildSlot[] {
  const slots: ChildSlot[] = [];
  for (const node of nodes) {
    const element = node as HTMLElement;
    const id = element.dataset.childId;
    if (!id || dragged.has(id)) continue;
    const rect = element.getBoundingClientRect();
    slots.push({ id, top: rect.top, height: rect.height });
  }
  return slots;
}

/**
 * Huecos visibles de una columna, sin las tarjetas que se están arrastrando.
 * Las columnas plegadas (sin cuerpo) no devuelven nada.
 */
export function columnSlots(columnId: string, dragged: ReadonlySet<string>): ChildSlot[] {
  const body = document.querySelector(`[data-column-body][data-column-id="${CSS.escape(columnId)}"]`);
  if (!body) return [];
  return toSlots(Array.from(body.querySelectorAll('[data-child-id]')), dragged);
}

const COLUMN_IDS_IN_DOM = '[data-column-body][data-column-id]';

/** Columna y posición donde caería un punto de pantalla (o null si cae fuera). */
export function kanbanTargetAt(
  clientX: number,
  clientY: number,
  dragged: ReadonlySet<string>,
): KanbanTarget | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    const body = (node as HTMLElement).closest?.(COLUMN_IDS_IN_DOM) as HTMLElement | null;
    if (!body) continue;
    const columnId = body.dataset.columnId;
    if (!columnId) return null;
    const rect = body.getBoundingClientRect();
    const slots = columnSlots(columnId, dragged);
    const index = insertionIndexFromPoint(slots, clientY);
    const lineY = insertionLineY(slots, index, rect.top + 8);
    return {
      columnId,
      index,
      line: { x: rect.left + 6, y: lineY, width: Math.max(24, rect.width - 12) },
      body: { id: columnId, left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  }
  return null;
}

let highlighted: HTMLElement | null = null;
let highlightedId: string | null = null;

/**
 * Resalta la columna destino (una sola a la vez). El resaltado va en la tarjeta
 * de la columna, no en el cuerpo: la sombra de foco tiene que rodear el marco.
 */
export function highlightColumn(columnId: string | null): void {
  if (highlightedId === columnId) return;
  highlighted?.classList.remove('is-drop-target');
  highlighted = null;
  highlightedId = columnId;
  if (!columnId) return;
  const body = document.querySelector(`[data-column-id="${CSS.escape(columnId)}"]`);
  const card = (body?.closest('.el--column') ?? body) as HTMLElement | null;
  if (!card) return;
  card.classList.add('is-drop-target');
  highlighted = card;
}

/** Limpia el resaltado (fin del gesto o cambio de tablero). */
export function clearColumnHighlight(): void {
  highlightColumn(null);
}

export type KanbanDragOptions = {
  session: BoardSession;
  /** Id de la tarjeta que se arrastra. */
  id: string;
  /** Punto de mundo donde se soltó (para dejarla suelta ahí si sale). */
  worldAt: (clientX: number, clientY: number) => Point;
  /** Estado visual del destino (o null si no hay columna debajo). */
  onTarget(target: KanbanTarget | null): void;
  /** Desplazamiento relativo de la tarjeta, en píxeles de pantalla. */
  onOffset(x: number, y: number): void;
};

export type KanbanDrag = {
  move(clientX: number, clientY: number): void;
  end(commit: boolean): void;
  readonly target: KanbanTarget | null;
};

/**
 * Arrastre de una tarjeta que ya vive en una columna: reordena dentro, la pasa
 * a otra columna o la deja suelta en el lienzo.
 */
export function startKanbanDrag(options: KanbanDragOptions): KanbanDrag {
  const { session, id } = options;
  const dragged = new Set([id]);
  const start = { x: 0, y: 0, dx: 0, dy: 0 };
  let target: KanbanTarget | null = null;
  let done = false;

  return {
    get target() {
      return target;
    },
    move(clientX, clientY) {
      if (done) return;
      if (start.x === 0 && start.y === 0) {
        start.x = clientX;
        start.y = clientY;
      }
      const dx = clientX - start.x;
      const dy = clientY - start.y;
      start.dx = dx;
      start.dy = dy;
      options.onOffset(dx, dy);
      const next = kanbanTargetAt(clientX, clientY, dragged);
      const same =
        (next === null && target === null) ||
        (next !== null &&
          target !== null &&
          next.columnId === target.columnId &&
          next.index === target.index);
      if (!same) {
        target = next;
        options.onTarget(target);
      }
    },
    end(commit) {
      if (done) return;
      done = true;
      options.onOffset(0, 0);
      options.onTarget(null);
      highlightColumn(null);
      if (!commit) return;
      // Sin movimiento real: se deja como estaba.
      if (Math.abs(start.dx) < 3 && Math.abs(start.dy) < 3) return;
      const column = session.getElement(id)?.parentId ?? null;
      if (target && target.columnId === column) {
        reorderInColumn(session, target.columnId, id, target.index);
        return;
      }
      if (target) {
        addElementsToColumn(session, target.columnId, [id], target.index);
        return;
      }
      detachFromColumn(session, [id], options.worldAt(start.x + start.dx, start.y + start.dy));
    },
  };
}

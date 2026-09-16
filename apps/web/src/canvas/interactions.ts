/**
 * Controladores de arrastre y redimensión.
 *
 * Regla de oro del rendimiento: durante el gesto NO se toca el estado de React
 * ni el documento. Se aplica el desplazamiento directamente al DOM de las
 * tarjetas y, al soltar, se commitea a Yjs en una sola transacción (un solo paso
 * de deshacer). Las guías magnéticas se publican como mucho una vez por frame.
 */

import type { Guide, Point, Rect, Viewport } from '@tablero/shared';

import { appliedAspectResize, appliedDrag, appliedWidthResize, type ResizeDirection, type ResizeResult } from '@/lib/dragMath';
import { useUiStore } from '@/state/uiStore';

import { setNodeTransform, setNodeWidth } from './nodeRegistry';

export type DragItem = { id: string; rect: Rect };
export type Move = { id: string; x: number; y: number };

export type PointerDrag = {
  move(pointer: Point): void;
  end(commit: boolean): void;
  readonly moved: boolean;
};

function guidesEqual(a: Guide[], b: Guide[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (!left || !right) return false;
    if (
      left.axis !== right.axis ||
      left.position !== right.position ||
      left.start !== right.start ||
      left.end !== right.end ||
      left.kind !== right.kind
    ) {
      return false;
    }
  }
  return true;
}

export type MoveDragParams = {
  items: DragItem[];
  targets: Rect[];
  viewport: Viewport;
  startPointer: Point;
  /** Se llama solo si el desplazamiento es distinto de cero. */
  onCommit(moves: Move[]): void;
};

export function startMoveDrag(params: MoveDragParams): PointerDrag {
  const { items, targets, viewport, startPointer, onCommit } = params;
  let pointer: Point | null = startPointer;
  let frame = 0;
  let offset = { dx: 0, dy: 0 };
  let guides: Guide[] = [];
  let done = false;
  let moved = false;

  // La marca de arrastre vive en el store: así la pinta React y sobrevive a
  // cualquier re-render que ocurra a mitad de gesto.
  useUiStore.getState().setDraggingIds(items.map((item) => item.id));

  const paint = (dx: number, dy: number): void => {
    for (const item of items) {
      setNodeTransform(item.id, Math.round(item.rect.x + dx), Math.round(item.rect.y + dy));
    }
  };

  const compute = (): { dx: number; dy: number; guides: Guide[] } | null => {
    if (!pointer) return null;
    const rawDx = (pointer.x - startPointer.x) / viewport.scale;
    const rawDy = (pointer.y - startPointer.y) / viewport.scale;
    if (!moved && Math.abs(rawDx) < 0.5 && Math.abs(rawDy) < 0.5) return null;
    const result = appliedDrag({
      rects: items.map((item) => item.rect),
      dx: rawDx,
      dy: rawDy,
      targets,
    });
    return { dx: result.dx, dy: result.dy, guides: result.guides };
  };

  const flush = (): void => {
    frame = 0;
    if (done) return;
    const result = compute();
    if (!result) return;
    const unchanged = result.dx === offset.dx && result.dy === offset.dy && guidesEqual(guides, result.guides);
    if (unchanged) return;
    offset = { dx: result.dx, dy: result.dy };
    guides = result.guides;
    moved = true;
    paint(offset.dx, offset.dy);
    useUiStore.getState().setGuides(guides);
  };

  return {
    get moved() {
      return moved;
    },
    move(next) {
      if (done) return;
      pointer = next;
      if (frame === 0) frame = requestAnimationFrame(flush);
    },
    end(commit) {
      if (done) return;
      done = true;
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      // Asegura que el DOM refleja la última posición del puntero.
      const result = compute();
      if (result) {
        offset = { dx: result.dx, dy: result.dy };
        if (result.dx !== 0 || result.dy !== 0) moved = true;
      }
      if (commit && moved) {
        paint(offset.dx, offset.dy);
        const moves: Move[] = items.map((item) => ({
          id: item.id,
          x: Math.round(item.rect.x + offset.dx),
          y: Math.round(item.rect.y + offset.dy),
        }));
        onCommit(moves);
      } else {
        // Cancelado (Esc) o sin movimiento: se vuelve al punto de partida.
        paint(0, 0);
        if (moved) useUiStore.getState().setGuides([]);
      }
      useUiStore.getState().setDraggingIds([]);
      useUiStore.getState().setGuides([]);
    },
  };
}

export type ResizeDragParams = {
  item: DragItem;
  /** `se` es la esquina (aspecto intacto: solo cambia el ancho). */
  direction: ResizeDirection | 'se';
  viewport: Viewport;
  startPointer: Point;
  onCommit(change: { id: string; x: number; width: number }): void;
};

export function startWidthResize(params: ResizeDragParams): PointerDrag {
  const { item, direction, viewport, startPointer, onCommit } = params;
  let pointer: Point | null = startPointer;
  let frame = 0;
  let current = { x: item.rect.x, width: item.rect.width };
  let done = false;
  let moved = false;

  useUiStore.getState().setDraggingIds([item.id]);

  const paint = (): void => {
    setNodeWidth(item.id, current.width);
    setNodeTransform(item.id, Math.round(current.x), Math.round(item.rect.y));
  };

  const resolve = (at: Point): ResizeResult => {
    const dx = (at.x - startPointer.x) / viewport.scale;
    if (direction === 'se') {
      const dy = (at.y - startPointer.y) / viewport.scale;
      return appliedAspectResize(
        { x: item.rect.x, y: item.rect.y, width: item.rect.width, height: item.rect.height },
        dx,
        dy,
      );
    }
    return appliedWidthResize({ x: item.rect.x, width: item.rect.width }, dx, direction);
  };

  const flush = (): void => {
    frame = 0;
    if (done || !pointer) return;
    const next = resolve(pointer);
    if (next.width === current.width && next.x === current.x) return;
    current = next;
    moved = true;
    paint();
  };

  return {
    get moved() {
      return moved;
    },
    move(next) {
      if (done) return;
      pointer = next;
      if (frame === 0) frame = requestAnimationFrame(flush);
    },
    end(commit) {
      if (done) return;
      done = true;
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (!done) return;
      const last = pointer;
      if (last) {
        const next = resolve(last);
        if (next.width !== current.width || next.x !== current.x) {
          current = next;
          moved = true;
        }
      }
      if (commit && moved) {
        paint();
        onCommit({ id: item.id, x: Math.round(current.x), width: current.width });
      } else {
        current = { x: item.rect.x, width: item.rect.width };
        paint();
      }
      useUiStore.getState().setDraggingIds([]);
    },
  };
}

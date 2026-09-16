/**
 * Matemática de las interacciones de arrastre y redimensión.
 *
 * Funciones puras para poder probarlas sin DOM: reciben rectángulos de mundo y
 * devuelven el desplazamiento final (ya ajustado a rejilla y a guías).
 */

import {
  type Guide,
  type Rect,
  GRID_SIZE,
  GUIDE_THRESHOLD,
  MIN_ELEMENT_WIDTH,
  computeAlignment,
  snapToGrid,
  translateRect,
} from '@tablero/shared';

export type DragInput = {
  /** Rectángulos de partida (mundo) de los elementos que se arrastran. */
  rects: Rect[];
  /** Desplazamiento crudo del puntero, en unidades de mundo. */
  dx: number;
  dy: number;
  /** Rectángulos de referencia (todos menos los arrastrados). */
  targets: Rect[];
  threshold?: number;
  grid?: number;
  guides?: boolean;
  gridSnap?: boolean;
};

export type DragResult = {
  /** Desplazamiento final = crudo + ajuste magnético. */
  dx: number;
  dy: number;
  /** Rectángulos destino, en el mismo orden que la entrada. */
  rects: Rect[];
  guides: Guide[];
};

/**
 * Aplica el desplazamiento crudo y después el imán: los bordes/centros del
 * grupo se pegan a los de los elementos de referencia y, si no hay guía, el
 * conjunto cae en la rejilla de 8 px.
 */
export function appliedDrag(input: DragInput): DragResult {
  const proposals = input.rects.map((rect) => translateRect(rect, input.dx, input.dy));
  const alignment = computeAlignment(proposals, input.targets, {
    threshold: input.threshold ?? GUIDE_THRESHOLD,
    grid: input.grid ?? GRID_SIZE,
    guides: input.guides ?? true,
    gridSnap: input.gridSnap ?? true,
  });
  const rects =
    alignment.dx === 0 && alignment.dy === 0
      ? proposals
      : proposals.map((rect) => translateRect(rect, alignment.dx, alignment.dy));

  return {
    dx: input.dx + alignment.dx,
    dy: input.dy + alignment.dy,
    rects,
    guides: alignment.guides,
  };
}

export type ResizeDirection = 'w' | 'e';

export type ResizeResult = { x: number; width: number };

/**
 * Cambio de ancho desde un tirador lateral. El borde opuesto queda fijo y el
 * ancho se ajusta a la rejilla, nunca por debajo del mínimo.
 */
export function appliedWidthResize(
  start: { x: number; width: number },
  dx: number,
  direction: ResizeDirection,
  grid: number = GRID_SIZE,
): ResizeResult {
  if (direction === 'e') {
    const width = Math.max(MIN_ELEMENT_WIDTH, snapToGrid(start.width + dx, grid));
    return { x: start.x, width };
  }
  const width = Math.max(MIN_ELEMENT_WIDTH, snapToGrid(start.width - dx, grid));
  return { x: start.x + (start.width - width), width };
}

/** Movimientos de teclado (flechas): 1 px, 10 px con Shift. */
export function nudgeDelta(shift: boolean): number {
  return shift ? 10 : 1;
}

/**
 * Cambio de tamaño desde la esquina con el aspecto intacto.
 *
 * Las tarjetas de imagen y vídeo calculan su alto a partir del ancho (y del
 * aspecto de su recorte), así que la esquina solo mueve el ancho: el alto sigue
 * solo. El desplazamiento vertical se proyecta sobre el horizontal para que el
 * gesto se sienta diagonal (arrastrar hacia abajo-derecha agranda).
 */
export function appliedAspectResize(
  start: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
  direction: 'se' | 'sw' = 'se',
  grid: number = GRID_SIZE,
): ResizeResult {
  const aspect = start.height > 0 ? start.width / start.height : 1;
  const horizontal = direction === 'se' ? dx : -dx;
  const projected = horizontal + dy * aspect;
  const width = Math.max(MIN_ELEMENT_WIDTH, snapToGrid(start.width + projected, grid));
  const x = direction === 'se' ? start.x : start.x + (start.width - width);
  return { x, width };
}

export type NudgeMove = { id: string; x: number; y: number };

export function nudgeMoves(
  rects: { id: string; x: number; y: number }[],
  dx: number,
  dy: number,
): NudgeMove[] {
  return rects.map((item) => ({ id: item.id, x: item.x + dx, y: item.y + dy }));
}

/**
 * Alineación y distribución de la selección.
 *
 * `alignRects` (paquete compartido) devuelve las posiciones nuevas; aquí se
 * traducen a movimientos listos para `moveElements`, en una sola transacción.
 */

import {
  type AlignAction,
  type ElementMove,
  type Rect,
  alignRects,
  boundsOf,
} from '@tablero/shared';

export type AlignableItem = { id: string; rect: Rect };

/**
 * Posiciones nuevas para una acción de alineación/distribución.
 * Devuelve solo los movimientos que cambian de posición.
 */
export function alignmentMoves(items: AlignableItem[], action: AlignAction): ElementMove[] {
  if (items.length < 2) return [];
  const positions = alignRects(
    items.map((item) => item.rect),
    action,
  );
  const moves: ElementMove[] = [];
  items.forEach((item, index) => {
    const position = positions[index];
    if (!position) return;
    if (position.x === item.rect.x && position.y === item.rect.y) return;
    moves.push({ id: item.id, x: position.x, y: position.y });
  });
  return moves;
}

/** Caja envolvente de la selección (mundo), o `null` si está vacía. */
export function selectionBounds(items: AlignableItem[]): Rect | null {
  return boundsOf(items.map((item) => item.rect));
}

/** ¿Tiene sentido mostrar las acciones de distribuir? (3 o más elementos) */
export function canDistribute(items: AlignableItem[]): boolean {
  return items.length >= 3;
}

export type AlignActionOption = {
  action: AlignAction;
  label: string;
  requiresThree?: boolean;
};

export const ALIGN_ACTIONS: AlignActionOption[] = [
  { action: 'left', label: 'Alinear a la izquierda' },
  { action: 'center-x', label: 'Centrar horizontalmente' },
  { action: 'right', label: 'Alinear a la derecha' },
  { action: 'top', label: 'Alinear arriba' },
  { action: 'center-y', label: 'Centrar verticalmente' },
  { action: 'bottom', label: 'Alinear abajo' },
  { action: 'distribute-x', label: 'Distribuir horizontalmente', requiresThree: true },
  { action: 'distribute-y', label: 'Distribuir verticalmente', requiresThree: true },
];

/** Acciones ofrecidas para una selección concreta. */
export function availableAlignActions(count: number): AlignActionOption[] {
  return ALIGN_ACTIONS.filter((option) => !option.requiresThree || count >= 3);
}

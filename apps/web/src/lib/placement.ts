/**
 * Colocación de elementos nuevos.
 *
 * El elemento se centra en el punto pedido (el cursor al soltar o el centro del
 * viewport), se ajusta a la rejilla de 8 px y, si el hueco está ocupado, baja
 * hasta encontrar sitio libre sin tapar lo que ya hay.
 */

import {
  type Point,
  type Rect,
  type Size,
  nextPlacement,
  snapPointToGrid,
} from '@tablero/shared';

export type PlacementInput = {
  /** Rectángulos ya ocupados (mundo). */
  existing: Rect[];
  size: Size;
  /** Punto de mundo donde se quiere el centro del elemento. */
  world: Point;
  snap?: boolean;
  gap?: number;
};

export function placementForNewElement(input: PlacementInput): Point {
  const topLeft: Point = {
    x: input.world.x - input.size.width / 2,
    y: input.world.y - input.size.height / 2,
  };
  const origin = input.snap === false ? topLeft : snapPointToGrid(topLeft);
  return nextPlacement(input.existing, input.size, origin, input.gap ?? 16);
}

/** Esquina superior izquierda a partir de un punto que se quiere como centro. */
export function centeredTopLeft(world: Point, size: Size): Point {
  return { x: Math.round(world.x - size.width / 2), y: Math.round(world.y - size.height / 2) };
}

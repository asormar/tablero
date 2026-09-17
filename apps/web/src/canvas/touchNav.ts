/**
 * Gestos táctiles del lienzo (fase 4, punto 8: «gestos para navegar el lienzo»).
 *
 * Un dedo arrastra el lienzo (paneo) y dos dedos hacen pinza (zoom). La
 * aritmética vive acá para poder probarla sin navegador: el componente solo
 * conecta los eventos de puntero.
 */

import type { Point } from '@tablero/shared';

/** Distancia entre dos puntos (0 si falta alguno). */
export function distanceBetween(a: Point | undefined, b: Point | undefined): number {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Punto medio entre dos puntos. */
export function midpointOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Factor de zoom de una pinza: cuánto cambió la distancia entre los dedos.
 * Se acota a un rango razonable para que un salto de un dedo mal leído no
 * dispare el zoom a los extremos.
 */
export function pinchScaleFor(previousDistance: number, nextDistance: number, min = 0.25, max = 4): number {
  if (previousDistance <= 0 || nextDistance <= 0) return 1;
  const ratio = nextDistance / previousDistance;
  if (!Number.isFinite(ratio)) return 1;
  return Math.min(max, Math.max(min, ratio));
}

/** ¿El gesto tiene los dos dedos necesarios para la pinza? */
export function canPinch(points: readonly Point[]): boolean {
  return points.length >= 2;
}

/** Los dos primeros puntos activos (los que usa la pinza). */
export function pinchPair(points: readonly Point[]): [Point, Point] | null {
  if (points.length < 2) return null;
  const first = points[0];
  const second = points[1];
  if (!first || !second) return null;
  return [first, second];
}

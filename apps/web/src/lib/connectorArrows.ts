/**
 * Puntas de los conectores.
 *
 * La geometría la da el contrato compartido (extremos, curva, punto medio y
 * direcciones en cada punta); acá se convierte eso en un `path` de SVG: una
 * flecha triangular o un punto. Es una función pura para poder probarla.
 */

import { type ArrowKind, type Point } from '@tablero/shared';

/** Tamaño de la punta a partir del grosor del trazo. */
export function arrowSize(kind: ArrowKind, width: number): number {
  if (kind === 'dot') return Math.max(3, width * 1.35);
  return Math.max(9, width * 3.2);
}

function normalize(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) return { x: 1, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `path` de la punta: la punta mira en `direction` (la dirección con la que
 * llega el trazo) y su vértice está en `tip`.
 */
export function arrowPath(kind: ArrowKind, tip: Point, direction: Point, width: number): string {
  if (kind === 'none' || width <= 0) return '';
  const dir = normalize(direction);
  const size = arrowSize(kind, width);
  if (kind === 'dot') {
    const center = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
    return `M ${round(center.x - size)} ${round(center.y)} a ${round(size)} ${round(size)} 0 1 0 ${round(size * 2)} 0 a ${round(size)} ${round(size)} 0 1 0 ${round(-size * 2)} 0 Z`;
  }
  const baseX = tip.x - dir.x * size * 1.6;
  const baseY = tip.y - dir.y * size * 1.6;
  const half = size * 0.62;
  const nx = -dir.y;
  const ny = dir.x;
  const left = { x: baseX + nx * half, y: baseY + ny * half };
  const right = { x: baseX - nx * half, y: baseY - ny * half };
  return `M ${round(tip.x)} ${round(tip.y)} L ${round(left.x)} ${round(left.y)} L ${round(right.x)} ${round(right.y)} Z`;
}

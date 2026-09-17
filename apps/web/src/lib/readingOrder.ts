/**
 * Orden de lectura del tablero (punto 8 de la fase 4: vista de lista).
 *
 * La posición en el lienzo manda: primero las tarjetas sueltas (de arriba hacia
 * abajo y de izquierda a derecha) y, debajo de cada columna, sus hijos en el
 * mismo orden. Es también el orden que usa la búsqueda del tablero para navegar
 * entre coincidencias.
 */

import type { CanvasElement } from '@tablero/shared';

function byPosition(a: CanvasElement, b: CanvasElement): number {
  if (Math.abs(a.y - b.y) > 24) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.createdAt - b.createdAt;
}

export function readingOrder(elements: CanvasElement[]): CanvasElement[] {
  const top = elements.filter((element) => !element.parentId).sort(byPosition);
  const childrenByParent = new Map<string, CanvasElement[]>();
  for (const element of elements) {
    if (!element.parentId) continue;
    const list = childrenByParent.get(element.parentId);
    if (list) list.push(element);
    else childrenByParent.set(element.parentId, [element]);
  }
  const ordered: CanvasElement[] = [];
  for (const element of top) {
    ordered.push(element);
    const children = childrenByParent.get(element.id);
    if (children) ordered.push(...children.sort(byPosition));
  }
  // Hijos cuyo padre no está (huérfanos): al final, en orden de posición.
  const seen = new Set(ordered.map((element) => element.id));
  for (const element of elements) {
    if (seen.has(element.id)) continue;
    ordered.push(element);
  }
  return ordered;
}

/**
 * Cálculo de la capa visible del lienzo (virtualización).
 *
 * El lienzo completo puede tener cientos o miles de elementos: solo se montan
 * en el DOM los que intersectan el viewport ampliado por un margen, para que
 * el usuario no note el borde al desplazarse.
 */

import {
  type CanvasElement,
  type ElementType,
  type Rect,
  expandRect,
  elementRect,
  rectsIntersect,
} from '@tablero/shared';

/** Margen (unidades de mundo) alrededor del viewport que se monta igualmente. */
export const LAYOUT_PADDING = 320;

export type ElementLayout = {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  /** La altura depende del contenido: se mide en el DOM y se reporta al store. */
  autoHeight: boolean;
  parentId: string | null;
  locked: boolean;
};

/** Proyecta los elementos del documento a la estructura mínima de layout. */
export function layoutOf(elements: CanvasElement[]): ElementLayout[] {
  const result: ElementLayout[] = [];
  for (const element of elements) {
    const rect = elementRect(element);
    result.push({
      id: element.id,
      type: element.type,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      autoHeight: element.height === undefined,
      parentId: element.parentId ?? null,
      locked: element.locked === true,
    });
  }
  return result;
}

/**
 * Elementos que el lienzo coloca por su cuenta: los hijos de una columna no
 * (los ubica el flujo de la columna), así que quedan fuera del layout absoluto.
 */
export function topLevelElements(elements: CanvasElement[]): CanvasElement[] {
  return elements.filter((element) => !element.parentId);
}

/** Layout de los elementos sueltos del lienzo. */
export function topLevelLayoutOf(elements: CanvasElement[]): ElementLayout[] {
  return layoutOf(topLevelElements(elements));
}

/** Altura efectiva: la del documento si está fijada, si no la medida en el DOM. */
export function effectiveHeight(item: ElementLayout, measured?: ReadonlyMap<string, number>): number {
  if (!item.autoHeight) return item.height;
  const value = measured?.get(item.id);
  return value !== undefined && value > 0 ? value : item.height;
}

/** Rectángulos de mundo de un layout, con las alturas medidas aplicadas. */
export function layoutRects(layout: ElementLayout[], measured?: ReadonlyMap<string, number>): Rect[] {
  const rects: Rect[] = [];
  for (const item of layout) {
    rects.push({ x: item.x, y: item.y, width: item.width, height: effectiveHeight(item, measured) });
  }
  return rects;
}

export function rectOf(item: ElementLayout, measured?: ReadonlyMap<string, number>): Rect {
  return { x: item.x, y: item.y, width: item.width, height: effectiveHeight(item, measured) };
}

/**
 * Subconjunto de `layout` que intersecta `worldView` ampliado por `padding`.
 * Preserva el orden de apilado del original.
 */
export function visibleLayout(
  layout: ElementLayout[],
  worldView: Rect,
  measured?: ReadonlyMap<string, number>,
  padding: number = LAYOUT_PADDING,
): ElementLayout[] {
  const expanded = expandRect(worldView, padding);
  const result: ElementLayout[] = [];
  for (const item of layout) {
    const height = effectiveHeight(item, measured);
    if (!rectsIntersect({ x: item.x, y: item.y, width: item.width, height }, expanded)) continue;
    result.push(height === item.height ? item : { ...item, height });
  }
  return result;
}

/** Ids de los elementos visibles, útil para tests y para el contador de rendimiento. */
export function visibleIds(
  layout: ElementLayout[],
  worldView: Rect,
  measured?: ReadonlyMap<string, number>,
  padding: number = LAYOUT_PADDING,
): string[] {
  return visibleLayout(layout, worldView, measured, padding).map((item) => item.id);
}

/** Rectángulos de referencia para las guías magnéticas, excluyendo los arrastrados. */
export function targetRects(
  layout: ElementLayout[],
  measured: ReadonlyMap<string, number> | undefined,
  excluded: ReadonlySet<string>,
  view: Rect,
): Rect[] {
  const result: Rect[] = [];
  for (const item of layout) {
    if (excluded.has(item.id)) continue;
    const rect = rectOf(item, measured);
    // Solo los cercanos al viewport influyen en las guías (evita O(n²) inútil).
    if (!rectsIntersect(rect, expandRect(view, 1200))) continue;
    result.push(rect);
  }
  return result;
}

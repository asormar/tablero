/**
 * Lectura de columnas: quién es hijo de quién.
 *
 * Las columnas guardan sus hijos en `childrenIds` (un `Y.Array<string>` dentro
 * del elemento). Los hijos conservan `parentId`. Este módulo resuelve esa
 * relación en un solo sitio: los hijos en papelera o borrados **no** cuentan
 * (si no, quedaría un hueco en el layout).
 */

import * as Y from 'yjs';

import {
  type CanvasElement,
  type Rect,
  elementsOf,
  getElementMap,
  isTrashed,
  readElement,
} from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { rectOf, type ElementLayout } from '@/lib/layout';

/** `Y.Array` de hijos de una columna, si existe. */
export function childIdArray(doc: Y.Doc, columnId: string): Y.Array<string> | null {
  const map = getElementMap(doc, columnId);
  const array = map?.get('childrenIds');
  return array instanceof Y.Array ? (array as Y.Array<string>) : null;
}

/** Ids declarados por la columna, tal como están en el documento. */
export function rawChildIds(doc: Y.Doc, columnId: string): string[] {
  const array = childIdArray(doc, columnId);
  if (!array) return [];
  const ids: string[] = [];
  array.forEach((value) => {
    if (typeof value === 'string') ids.push(value);
  });
  return ids;
}

/** Ids de todas las columnas que contienen algún elemento (para no duplicar). */
export function columnIdsWithChildren(doc: Y.Doc): string[] {
  const result: string[] = [];
  elementsOf(doc).forEach((map, id) => {
    if (map.get('type') !== 'column') return;
    const array = map.get('childrenIds');
    if (array instanceof Y.Array && array.length > 0) result.push(id);
  });
  return result;
}

/**
 * Hijos vivos de una columna, en el orden de `childrenIds`: descarta ids que ya
 * no existen, elementos en papelera y elementos cuyo `parentId` ya no es la
 * columna (por ejemplo tras deshacer un movimiento).
 */
export function columnChildren(session: BoardSession, columnId: string): CanvasElement[] {
  const store = elementsOf(session.doc);
  const result: CanvasElement[] = [];
  for (const id of rawChildIds(session.doc, columnId)) {
    const map = store.get(id);
    if (!map) continue;
    const element = readElement(map);
    if (!element || isTrashed(element)) continue;
    if (element.parentId !== columnId) continue;
    result.push(element);
  }
  return result;
}

/** ¿Este elemento vive dentro de una columna? */
export function isColumnChild(element: CanvasElement | null | undefined): boolean {
  return !!element && typeof element.parentId === 'string' && element.parentId.length > 0;
}

export type ColumnContainer = {
  id: string;
  rect: Rect;
  /** Ids de los hijos que se van a ver (los de papelera no cuentan). */
  childIds: string[];
};

/** Columnas del tablero con su rectángulo, para decidir dónde cae un arrastre. */
export function columnContainers(session: BoardSession, measured?: ReadonlyMap<string, number>): ColumnContainer[] {
  const result: ColumnContainer[] = [];
  for (const item of session.getLayout()) {
    if (item.type !== 'column') continue;
    result.push({
      id: item.id,
      rect: rectOf(item, measured),
      childIds: columnChildren(session, item.id).map((child) => child.id),
    });
  }
  return result;
}

/** Columna que contiene el rectángulo dado (la última de la pila, si se solapan). */
export function columnAtPoint(containers: readonly ColumnContainer[], point: { x: number; y: number }): ColumnContainer | null {
  for (let index = containers.length - 1; index >= 0; index -= 1) {
    const container = containers[index]!;
    const { rect } = container;
    if (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    ) {
      return container;
    }
  }
  return null;
}

/** Layout de los hijos de una columna (para depuración y pruebas). */
export function childLayout(layout: ElementLayout[], columnId: string): ElementLayout[] {
  return layout.filter((item) => item.parentId === columnId);
}

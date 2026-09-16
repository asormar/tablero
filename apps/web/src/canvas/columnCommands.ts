/**
 * Comandos de columnas y kanban.
 *
 * Las tarjetas dentro de una columna no tienen posición libre: el layout las
 * apila en el orden de `childrenIds`. Todo lo que cambia esa pertenencia pasa
 * por acá, en una sola transacción (un paso de deshacer por gesto).
 */

import * as Y from 'yjs';

import {
  type CreateElementInit,
  type ElementType,
  type Point,
  DEFAULT_SIZES,
  addElement,
  createTodoItem,
  elementsOf,
  ensureTextFragment,
  getElementMap,
  isRichTextType,
  isTrashed,
} from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { columnIdsWithChildren, rawChildIds } from '@/lib/columns';
import { insertIds, reorderIds } from '@/lib/kanban';
import { useAppStore } from '@/state/appStore';

function currentUserId(): string {
  return useAppStore.getState().user.id;
}

/** `childrenIds` de la columna, creándolo si el elemento no lo tenía. */
function ensureChildArray(session: BoardSession, columnId: string): Y.Array<string> | null {
  const map = getElementMap(session.doc, columnId);
  if (!map) return null;
  const existing = map.get('childrenIds');
  if (existing instanceof Y.Array) return existing as Y.Array<string>;
  const created = new Y.Array<string>();
  map.set('childrenIds', created);
  return created;
}

function setIds(array: Y.Array<string>, ids: readonly string[]): void {
  array.delete(0, array.length);
  if (ids.length > 0) array.push([...ids]);
}

/** Saca los ids de todas las columnas (menos de la que se indique). */
function removeFromOtherColumns(session: BoardSession, ids: readonly string[], exceptId?: string): void {
  const wanted = new Set(ids);
  for (const columnId of columnIdsWithChildren(session.doc)) {
    if (columnId === exceptId) continue;
    const array = ensureChildArray(session, columnId);
    if (!array) continue;
    const remaining = rawChildIds(session.doc, columnId).filter((id) => !wanted.has(id));
    if (remaining.length !== array.length) setIds(array, remaining);
  }
}

/**
 * Mete tarjetas en una columna (al soltarlas encima). Sale de la columna donde
 * estuvieran y entra en la posición pedida, conservando su orden relativo.
 */
export function addElementsToColumn(
  session: BoardSession,
  columnId: string,
  ids: readonly string[],
  index?: number,
): void {
  if (ids.length === 0) return;
  const column = session.getElement(columnId);
  if (!column || column.type !== 'column') return;

  const incoming = ids.filter((id) => {
    const element = session.getElement(id);
    // Una columna no se anida en otra (el kanban es de un solo nivel).
    return !!element && !isTrashed(element) && element.id !== columnId && element.type !== 'column';
  });
  if (incoming.length === 0) return;

  session.doc.transact(() => {
    const array = ensureChildArray(session, columnId);
    if (!array) return;
    removeFromOtherColumns(session, incoming, columnId);
    const current = rawChildIds(session.doc, columnId);
    const alreadyInside = incoming.every((id) => current.includes(id));
    const next = alreadyInside
      ? reorderIds(current, incoming[0]!, index ?? current.length)
      : insertIds(current, incoming, index ?? current.length);
    setIds(array, next);
    const store = elementsOf(session.doc);
    for (const id of incoming) {
      const map = store.get(id);
      if (!map) continue;
      map.set('parentId', columnId);
      // La posición guardada se conserva como referencia por si la tarjeta sale
      // de la columna: al soltarla fuera, se reemplaza por el punto de soltado.
      if (typeof map.get('x') !== 'number') map.set('x', column.x);
      if (typeof map.get('y') !== 'number') map.set('y', column.y);
      map.set('updatedAt', Date.now());
    }
  }, session.origin);
}

/** Reordena una tarjeta dentro de su columna (arrastrar dentro de la columna). */
export function reorderInColumn(session: BoardSession, columnId: string, id: string, index: number): void {
  const array = ensureChildArray(session, columnId);
  if (!array) return;
  const current = rawChildIds(session.doc, columnId);
  const next = reorderIds(current, id, index);
  if (next === current) return;
  session.doc.transact(() => {
    setIds(array, next);
  }, session.origin);
}

/**
 * Saca tarjetas de su columna y las deja sueltas en el lienzo. Con `point` se
 * colocan ahí mismo (el punto donde se soltaron).
 */
export function detachFromColumn(session: BoardSession, ids: readonly string[], point?: Point): void {
  if (ids.length === 0) return;
  session.doc.transact(() => {
    const store = elementsOf(session.doc);
    for (const id of ids) {
      const map = store.get(id);
      if (!map) continue;
      const parentId = map.get('parentId');
      if (typeof parentId !== 'string') continue;
      const array = ensureChildArray(session, parentId);
      if (array) setIds(array, rawChildIds(session.doc, parentId).filter((child) => child !== id));
      map.delete('parentId');
      // Solo se recoloca la tarjeta que salía de la columna: si el id no era de
      // ninguna, no hay motivo para moverla.
      if (point) {
        const width = typeof map.get('width') === 'number' ? (map.get('width') as number) : 240;
        map.set('x', Math.round(point.x - Math.min(width, 240) / 2));
        map.set('y', Math.round(point.y - 24));
      }
      map.set('updatedAt', Date.now());
    }
  }, session.origin);
}

/** Limpia de `childrenIds` los ids que ya no son hijos vivos (borrados o movidos). */
export function pruneColumnChildren(session: BoardSession, columnId: string): number {
  const array = ensureChildArray(session, columnId);
  if (!array) return 0;
  const store = elementsOf(session.doc);
  const before = rawChildIds(session.doc, columnId);
  const kept = before.filter((id) => {
    const map = store.get(id);
    if (!map) return false;
    const deletedAt = map.get('deletedAt');
    if (typeof deletedAt === 'number' && deletedAt > 0) return false;
    return map.get('parentId') === columnId;
  });
  if (kept.length === before.length) return 0;
  session.doc.transact(() => {
    setIds(array, kept);
  }, session.origin);
  return before.length - kept.length;
}

export function setColumnCollapsed(session: BoardSession, columnId: string, collapsed: boolean): void {
  session.doc.transact(() => {
    const map = getElementMap(session.doc, columnId);
    map?.set('collapsed', collapsed);
    map?.set('updatedAt', Date.now());
  }, session.origin);
}

export function setColumnTitle(session: BoardSession, columnId: string, title: string): void {
  session.doc.transact(() => {
    const map = getElementMap(session.doc, columnId);
    map?.set('title', title);
    map?.set('updatedAt', Date.now());
  }, session.origin);
}

export type CreateColumnOptions = {
  size?: { width: number; height?: number };
  title?: string;
};

/** Crea una columna vacía en el punto de mundo pedido. */
export function createColumnAt(session: BoardSession, world: Point, options: CreateColumnOptions = {}): string {
  const width = options.size?.width ?? DEFAULT_SIZES.column.width;
  const x = Math.round(world.x - width / 2);
  const y = Math.round(world.y - 24);
  return addElement(
    session.doc,
    'column',
    {
      x,
      y,
      width,
      title: options.title ?? '',
      createdBy: currentUserId(),
    } as unknown as CreateElementInit,
    session.origin,
  );
}

/**
 * Crea una tarjeta dentro de una columna (el «+» del encabezado y las pruebas de
 * kanban). Nace dentro de la columna: `parentId` + `childrenIds`.
 */
export function createChildInColumn(
  session: BoardSession,
  columnId: string,
  type: ElementType,
  init: Record<string, unknown> = {},
): string {
  const column = session.getElement(columnId);
  if (!column || column.type !== 'column') return '';
  if (type === 'column') return '';
  const size = DEFAULT_SIZES[type];
  let id = '';
  session.doc.transact(() => {
    id = addElement(
      session.doc,
      type,
      {
        x: column.x,
        y: column.y,
        width: size.width,
        parentId: columnId,
        createdBy: currentUserId(),
        ...init,
      } as unknown as CreateElementInit,
      session.origin,
    );
    const array = ensureChildArray(session, columnId);
    array?.push([id]);
    // Las tarjetas de texto nacen con su fragmento: el editor lo necesita ya.
    if (isRichTextType(type)) ensureTextFragment(session.doc, id, session.origin);
  }, session.origin);
  return id;
}

/** Tarjeta de tareas dentro de una columna (kanban), lista para escribir. */
export function createTaskCardInColumn(session: BoardSession, columnId: string, text = ''): string {
  return createChildInColumn(session, columnId, 'todo', {
    title: '',
    // Nace con una fila para poder escribir la tarea directamente.
    items: [createTodoItem(text)],
  });
}

/** Crea una columna con tarjetas de tareas ya dentro (kanban de un gesto). */
export function createKanbanColumn(session: BoardSession, world: Point, tasks: readonly string[] = []): string {
  const columnId = createColumnAt(session, world);
  if (tasks.length === 0) return columnId;
  for (const task of tasks) createTaskCardInColumn(session, columnId, task);
  return columnId;
}

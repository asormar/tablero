/**
 * Columnas y kanban sobre el documento real.
 *
 * Lo que se prueba acá es la relación columna ↔ hijos en el `Y.Doc`: alta,
 * reordenamiento, salida al lienzo, plegado y el caso que ya nos mordió una vez
 * (un hijo en papelera **no** puede dejar un hueco en el layout).
 */

import { beforeAll, describe, expect, it } from 'vitest';

/** El gestor de deshacer agrupa lo que pasa dentro de la ventana de captura. */
const UNDO_WINDOW_MS = 450;
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, UNDO_WINDOW_MS);
  });
}

import { addElement, getOrderedElements, localOrigin, trashElements } from '@tablero/shared';

import { BoardSession } from '@/collab/BoardSession';
import {
  addElementsToColumn,
  createColumnAt,
  createTaskCardInColumn,
  detachFromColumn,
  pruneColumnChildren,
  reorderInColumn,
  setColumnCollapsed,
} from '@/canvas/columnCommands';
import { columnChildren, rawChildIds } from '@/lib/columns';

beforeAll(() => {
  const storage = new Map<string, string>();
  const globals = globalThis as unknown as Record<string, unknown>;
  globals['localStorage'] = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
  globals['window'] = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
});

let counter = 0;
function makeSession(): BoardSession {
  counter += 1;
  return new BoardSession({ boardId: `kanban-test-${counter}`, connect: false });
}

function texts(session: BoardSession, columnId: string): string[] {
  // Las tarjetas de tareas del kanban se identifican por el texto de su primera
  // tarea (su `title` va vacío en las pruebas).
  return columnChildren(session, columnId).map((child) => {
    if (child.type === 'todo') return child.items?.[0]?.text ?? child.id;
    return child.type === 'column' ? child.title : child.id;
  });
}

describe('columnas · alta de hijos', () => {
  it('crea la columna con su lista de hijos vacía', () => {
    const session = makeSession();
    const columnId = createColumnAt(session, { x: 100, y: 100 }, { title: 'Por hacer' });
    const column = session.getElement(columnId);
    expect(column?.type).toBe('column');
    expect(rawChildIds(session.doc, columnId)).toEqual([]);
    expect(columnChildren(session, columnId)).toEqual([]);
    session.destroy();
  });

  it('las tarjetas nacen dentro, en orden, y con `parentId`', () => {
    const session = makeSession();
    const columnId = createColumnAt(session, { x: 0, y: 0 });
    const first = createTaskCardInColumn(session, columnId, 'Primera');
    const second = createTaskCardInColumn(session, columnId, 'Segunda');

    expect(rawChildIds(session.doc, columnId)).toEqual([first, second]);
    expect(session.getElement(first)?.parentId).toBe(columnId);
    expect(columnChildren(session, columnId)).toHaveLength(2);
    // Los hijos no entran al layout absoluto: los coloca la columna.
    expect(session.getLayout().map((item) => item.id)).toEqual([columnId]);
    session.destroy();
  });

  it('el contador del layout no incluye los hijos pero el documento sí', () => {
    const session = makeSession();
    const columnId = createColumnAt(session, { x: 0, y: 0 });
    createTaskCardInColumn(session, columnId, 'Una');
    expect(session.getLayout()).toHaveLength(1);
    expect(getOrderedElements(session.doc)).toHaveLength(2);
    session.destroy();
  });
});

describe('columnas · mover tarjetas entre columnas (kanban)', () => {
  it('sacar de una columna y meter en otra conserva el orden relativo', () => {
    const session = makeSession();
    const todo = createColumnAt(session, { x: 0, y: 0 }, { title: 'Por hacer' });
    const doing = createColumnAt(session, { x: 320, y: 0 }, { title: 'Haciendo' });
    const a = createTaskCardInColumn(session, todo, 'A');
    const b = createTaskCardInColumn(session, todo, 'B');

    addElementsToColumn(session, doing, [a, b], 0);

    expect(rawChildIds(session.doc, todo)).toEqual([]);
    expect(rawChildIds(session.doc, doing)).toEqual([a, b]);
    expect(texts(session, doing)).toEqual(['A', 'B']);
    expect(session.getElement(a)?.parentId).toBe(doing);
    session.destroy();
  });

  it('insertar en medio respeta el índice pedido', () => {
    const session = makeSession();
    const column = createColumnAt(session, { x: 0, y: 0 });
    const a = createTaskCardInColumn(session, column, 'A');
    const b = createTaskCardInColumn(session, column, 'B');
    const c = createTaskCardInColumn(session, column, 'C');

    reorderInColumn(session, column, c, 0);
    expect(rawChildIds(session.doc, column)).toEqual([c, a, b]);

    addElementsToColumn(session, column, [b], 2);
    expect(rawChildIds(session.doc, column)).toEqual([c, a, b]);
    session.destroy();
  });

  it('reordena sin salir de la columna y se deshace de un paso', async () => {
    const session = makeSession();
    const column = createColumnAt(session, { x: 0, y: 0 });
    const a = createTaskCardInColumn(session, column, 'A');
    const b = createTaskCardInColumn(session, column, 'B');

    await settle();
    reorderInColumn(session, column, b, 0);
    expect(rawChildIds(session.doc, column)).toEqual([b, a]);

    session.undo();
    expect(rawChildIds(session.doc, column)).toEqual([a, b]);
    session.destroy();
  });

  it('no admite una columna dentro de otra', () => {
    const session = makeSession();
    const outer = createColumnAt(session, { x: 0, y: 0 });
    const inner = createColumnAt(session, { x: 400, y: 0 });
    addElementsToColumn(session, outer, [inner], 0);
    expect(rawChildIds(session.doc, outer)).toEqual([]);
    session.destroy();
  });
});

describe('columnas · salir al lienzo', () => {
  it('sacar una tarjeta la deja suelta en el punto de soltado', () => {
    const session = makeSession();
    const column = createColumnAt(session, { x: 0, y: 0 });
    const child = createTaskCardInColumn(session, column, 'Sale');

    detachFromColumn(session, [child], { x: 600, y: 400 });

    expect(rawChildIds(session.doc, column)).toEqual([]);
    const element = session.getElement(child);
    expect(element?.parentId).toBeUndefined();
    // Centrada en el punto de soltado (menos medio ancho, hasta 240).
    expect(element?.x).toBe(600 - Math.min(element?.width ?? 240, 240) / 2);
    expect(element?.y).toBe(376);
    // Ya está en el layout absoluto.
    expect(session.getLayout().some((item) => item.id === child)).toBe(true);
    session.destroy();
  });

  it('una tarjeta sin columna no se toca', () => {
    const session = makeSession();
    const free = addElement(session.doc, 'note', { x: 10, y: 10, createdBy: 'test' }, localOrigin);
    detachFromColumn(session, [free], { x: 0, y: 0 });
    expect(session.getElement(free)?.x).toBe(10);
    session.destroy();
  });
});

describe('columnas · papelera y limpieza', () => {
  it('un hijo en la papelera no cuenta ni deja hueco, y se limpia de la lista', () => {
    const session = makeSession();
    const column = createColumnAt(session, { x: 0, y: 0 });
    const a = createTaskCardInColumn(session, column, 'A');
    const b = createTaskCardInColumn(session, column, 'B');

    trashElements(session.doc, [a], localOrigin, { deletedBy: 'test' });
    expect(columnChildren(session, column).map((child) => child.id)).toEqual([b]);
    // El id sigue en el documento hasta que se limpia.
    expect(rawChildIds(session.doc, column)).toEqual([a, b]);
    expect(pruneColumnChildren(session, column)).toBe(1);
    expect(rawChildIds(session.doc, column)).toEqual([b]);
    session.destroy();
  });

  it('un hijo borrado del todo también se limpia', () => {
    const session = makeSession();
    const column = createColumnAt(session, { x: 0, y: 0 });
    const a = createTaskCardInColumn(session, column, 'A');
    const b = createTaskCardInColumn(session, column, 'B');
    session.doc.getMap('elements').delete(a);
    expect(columnChildren(session, column).map((child) => child.id)).toEqual([b]);
    expect(pruneColumnChildren(session, column)).toBe(1);
    session.destroy();
  });
});

describe('columnas · plegado', () => {
  it('plegar es un dato del elemento y se deshace', () => {
    const session = makeSession();
    const column = createColumnAt(session, { x: 0, y: 0 });
    setColumnCollapsed(session, column, true);
    const collapsed = session.getElement(column);
    expect(collapsed !== null && collapsed.type === 'column' ? collapsed.collapsed === true : false).toBe(true);
    session.undo();
    const restored = session.getElement(column);
    expect(restored !== null && restored.type === 'column' ? restored.collapsed === true : false).toBe(false);
    session.destroy();
  });
});

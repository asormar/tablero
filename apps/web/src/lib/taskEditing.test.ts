/**
 * Edición de listas de tareas: insertar después de una subtarea, arrastrar
 * entre listas y decidir dónde cae una fila soltada.
 */

import { describe, expect, it } from 'vitest';

import { type TodoItem, addTask, createTodoItem, findTask, indentTask } from '@tablero/shared';

import {
  insertTask,
  insertTaskAfter,
  lastTaskId,
  previousTaskId,
  taskDropTarget,
  taskRows,
  tasksToMarkdown,
  topLevelIndexOf,
} from './taskEditing';

function list(): TodoItem[] {
  const second = createTodoItem('segunda');
  return [createTodoItem('primera'), { ...second, children: [createTodoItem('sub', { checked: true })] }, createTodoItem('tercera')];
}

describe('insertTaskAfter', () => {
  it('sin referencia agrega al final', () => {
    const { items, id } = insertTaskAfter(list(), null, 'nueva');
    expect(items[items.length - 1]?.id).toBe(id);
    expect(items).toHaveLength(4);
  });

  it('después de una tarea de primer nivel entra en esa posición', () => {
    const items = list();
    const { items: next, id } = insertTaskAfter(items, items[0]!.id, 'nueva');
    expect(next.map((item) => item.text)).toEqual(['primera', 'nueva', 'segunda', 'tercera']);
    expect(next[1]?.id).toBe(id);
  });

  it('después de una subtarea entra como su hermana', () => {
    const items = list();
    const childId = items[1]!.children[0]!.id;
    const { items: next, id } = insertTaskAfter(items, childId, 'otra sub');
    const parent = next[1]!;
    expect(parent.children.map((item) => item.text)).toEqual(['sub', 'otra sub']);
    expect(findTask(next, id)?.parent?.id).toBe(parent.id);
  });

  it('con una referencia inexistente agrega al final', () => {
    const { items } = insertTaskAfter(list(), 'no-existe');
    expect(items).toHaveLength(4);
  });
});

describe('previousTaskId / lastTaskId', () => {
  it('encuentra la anterior en orden de lectura, también entre subtareas', () => {
    const items = list();
    const childId = items[1]!.children[0]!.id;
    expect(previousTaskId(items, childId)).toBe(items[1]!.id);
    expect(previousTaskId(items, items[0]!.id)).toBeNull();
  });

  it('la última es la última del recorrido de lectura', () => {
    const items = list();
    // El recorrido es primera → segunda → sub → tercera.
    expect(lastTaskId(items)).toBe(items[2]!.id);
    expect(lastTaskId([])).toBeNull();
  });
});

describe('taskRows', () => {
  it('aplana con nivel, madre e índice de primer nivel', () => {
    const rows = taskRows(list());
    expect(rows.map((row) => [row.item.text, row.depth, row.topIndex])).toEqual([
      ['primera', 0, 0],
      ['segunda', 0, 1],
      ['sub', 1, 2],
      ['tercera', 0, 2],
    ]);
    expect(rows[2]?.parentId).toBe(rows[1]?.item.id);
  });
});

describe('insertTask (arrastrar entre listas)', () => {
  it('en el primer nivel respeta el índice y conserva las subtareas', () => {
    const source = list();
    const task = source[1]!;
    const target = [createTodoItem('otra lista')];
    const next = insertTask(target, task, null, 0);
    expect(next[0]?.id).toBe(task.id);
    expect(next[0]?.children).toHaveLength(1);
  });

  it('como subtarea se agrega al final de la madre', () => {
    const source = list();
    const task = createTodoItem('suelta');
    const target = list();
    const parentId = target[0]!.id;
    const next = insertTask(target, task, parentId, 0);
    expect(findTask(next, parentId)?.item.children.map((item) => item.text)).toEqual(['suelta']);
  });
});

describe('taskDropTarget', () => {
  it('en la zona sangrada de una tarea de primer nivel la vuelve subtarea', () => {
    // Puntero 40 px a la derecha del borde de la fila: zona sangrada.
    expect(taskDropTarget({ id: 'a', depth: 0, topIndex: 0 }, 140, 100, 100, 90, 32)).toEqual({
      parentId: 'a',
      index: 0,
    });
    expect(taskDropTarget({ id: 'a', depth: 0, topIndex: 0 }, 120, 100, 100, 90, 32)).toEqual({
      parentId: null,
      index: 1,
    });
  });

  it('en la mitad inferior de una tarea de primer nivel cae después', () => {
    expect(taskDropTarget({ id: 'a', depth: 0, topIndex: 1 }, 100, 100, 100, 90, 32)).toEqual({
      parentId: null,
      index: 2,
    });
  });

  it('sobre una subtarea cae al final del bloque de su madre', () => {
    expect(taskDropTarget({ id: 'sub', depth: 1, topIndex: 2 }, 100, 100, 100, 90, 32)).toEqual({
      parentId: null,
      index: 2,
    });
  });
});

describe('topLevelIndexOf', () => {
  it('una tarea de primer nivel devuelve su posición', () => {
    const items = list();
    expect(topLevelIndexOf(items, items[2]!.id)).toBe(2);
  });

  it('una subtarea devuelve la posición siguiente a su madre', () => {
    const items = list();
    expect(topLevelIndexOf(items, items[1]!.children[0]!.id)).toBe(2);
  });
});

describe('tasksToMarkdown', () => {
  it('exporta casillas y subtareas', () => {
    const text = tasksToMarkdown(list());
    expect(text).toContain('- [ ] primera');
    expect(text).toContain('  - [x] sub');
  });
});

describe('compatibilidad con el contrato compartido', () => {
  it('lo que inserta el editor es lo que sangra `indentTask`', () => {
    const items = addTask(list(), 'cuarta');
    const { items: withNew } = insertTaskAfter(items, null, 'quinta');
    const indented = indentTask(withNew, withNew[withNew.length - 1]!.id);
    const parent = indented[indented.length - 1];
    expect(parent?.children.map((item) => item.text)).toContain('quinta');
  });
});

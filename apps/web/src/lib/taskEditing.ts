/**
 * Edición de listas de tareas.
 *
 * El contrato compartido (`@tablero/shared/todos`) trae las operaciones de
 * dominio (agregar, alternar, sangrar…), pero está pensado para mutaciones
 * simples. Acá están las que necesita el editor de la tarjeta y que no tienen
 * equivalente: insertar después de una subtarea, saber cuál es la tarea
 * anterior, y mover una tarea de una lista a otra.
 */

import { type TodoItem, createTodoItem, findTask, flattenTasks, updateTask } from '@tablero/shared';

export type InsertResult = { items: TodoItem[]; id: string };

/**
 * Inserta una tarea vacía justo después de `afterId`, al mismo nivel. Sin
 * `afterId` la agrega al final (primera tarea de la lista).
 */
export function insertTaskAfter(items: TodoItem[], afterId: string | null, text = ''): InsertResult {
  const item = createTodoItem(text);
  if (!afterId) return { items: [...items, item], id: item.id };
  const found = findTask(items, afterId);
  if (!found) return { items: [...items, item], id: item.id };

  if (!found.parent) {
    const index = items.findIndex((candidate) => candidate.id === afterId);
    return { items: [...items.slice(0, index + 1), item, ...items.slice(index + 1)], id: item.id };
  }

  const parent = found.parent;
  const children = [...parent.children];
  const childIndex = children.findIndex((candidate) => candidate.id === afterId);
  children.splice(childIndex + 1, 0, item);
  return { items: updateTask(items, parent.id, { children }), id: item.id };
}

/** Id de la tarea anterior en orden de lectura (para `Retroceso` con la tarea vacía). */
export function previousTaskId(items: TodoItem[], itemId: string): string | null {
  let previous: string | null = null;
  for (const task of flattenTasks('', items)) {
    if (task.itemId === itemId) return previous;
    previous = task.itemId;
  }
  return previous;
}

/** Última tarea de la lista (para el «+» del pie y para `Enter` en la última). */
export function lastTaskId(items: TodoItem[]): string | null {
  const flat = flattenTasks('', items);
  return flat.length > 0 ? flat[flat.length - 1]!.itemId : null;
}

/**
 * Inserta una tarea ya existente en otra lista (arrastrar entre tarjetas). Con
 * `parentId` queda como subtarea al final de esa madre; si no, entra en la
 * posición pedida del primer nivel conservando sus subtareas.
 */
export function insertTask(
  items: TodoItem[],
  task: TodoItem,
  parentId: string | null,
  index: number,
): TodoItem[] {
  if (parentId) {
    return updateTask(items, parentId, {
      children: [...(findTask(items, parentId)?.item.children ?? []), task],
    });
  }
  const target = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, target), task, ...items.slice(target)];
}

export type TaskDropParent = { parentId: string | null; index: number };

/** Fila de la lista lista para pintar (nivel 0 y sus hijas de nivel 1). */
export type TaskRowView = {
  item: TodoItem;
  depth: 0 | 1;
  parentId: string | null;
  /** Índice que ocuparía en el primer nivel (para insertar antes/después). */
  topIndex: number;
  /** Posición en el recorrido de lectura. */
  rowIndex: number;
};

export function taskRows(items: TodoItem[]): TaskRowView[] {
  const rows: TaskRowView[] = [];
  items.forEach((item, index) => {
    rows.push({ item, depth: 0, parentId: null, topIndex: index, rowIndex: rows.length });
    for (const child of item.children) {
      rows.push({ item: child, depth: 1, parentId: item.id, topIndex: index + 1, rowIndex: rows.length });
    }
  });
  return rows;
}

/**
 * Decide dónde cae una fila soltada a partir de la fila que hay debajo del
 * puntero: en la zona sangrada de una tarea de primer nivel se convierte en su
 * subtarea; en el resto, va al primer nivel antes o después de esa fila.
 */
export function taskDropTarget(
  row: { id: string; depth: 0 | 1; topIndex: number },
  pointerX: number,
  rowLeft: number,
  pointerY: number,
  rowMidY: number,
  indentZone = 32,
): TaskDropParent {
  const indented = pointerX - rowLeft >= indentZone;
  if (row.depth === 0 && indented) return { parentId: row.id, index: 0 };
  const after = pointerY > rowMidY;
  if (row.depth === 0) return { parentId: null, index: row.topIndex + (after ? 1 : 0) };
  return { parentId: null, index: row.topIndex };
}

/** Índice de primer nivel de una tarea (para soltar antes/después de una subtarea). */
export function topLevelIndexOf(items: TodoItem[], itemId: string): number {
  const found = findTask(items, itemId);
  if (!found) return 0;
  if (!found.parent) return Math.max(0, items.findIndex((candidate) => candidate.id === itemId));
  const parentIndex = items.findIndex((candidate) => candidate.id === found.parent!.id);
  return Math.max(0, parentIndex + 1);
}

/** Texto de la lista en formato Markdown de casillas (copiar/exportar). */
export function tasksToMarkdown(items: TodoItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`- [${item.checked ? 'x' : ' '}] ${item.text}`);
    for (const child of item.children) {
      lines.push(`  - [${child.checked ? 'x' : ' '}] ${child.text}`);
    }
  }
  return lines.join('\n');
}

/** Resumen para la vista previa cuando la tarjeta está en modo simplificado. */
export function firstOpenTaskText(items: TodoItem[]): string {
  for (const task of flattenTasks('', items)) {
    if (!task.checked && task.text.trim().length > 0) return task.text;
  }
  return items[0]?.text ?? '';
}

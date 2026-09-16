/**
 * Listas de tareas: operaciones de dominio.
 *
 * Todo lo de acá es puro e inmutable (recibe la lista de ítems y devuelve una
 * nueva): así la UI puede comparar por identidad y los tests no necesitan Yjs.
 * La persistencia es responsabilidad del elemento del lienzo, que guarda el
 * resultado en su clave `items`.
 *
 * El anidamiento es de un solo nivel, como en Milanote: una subtarea no tiene
 * hijas.
 */

import { createElementId } from './ids.js';
import type { TaskPriority, TodoItem } from './elements.js';

export type TodoProgress = { total: number; done: number; ratio: number };

export type FlatTask = {
  /** Id del elemento (lista) que contiene la tarea. */
  listId: string;
  /** Id de la tarea dentro de la lista. */
  itemId: string;
  /** Id de la lista padre, si es una subtarea. */
  parentId: string | null;
  text: string;
  checked: boolean;
  dueDate: string | null;
  priority: TaskPriority;
  assigneeId: string | null;
  /** 0 para las tareas de primer nivel, 1 para las subtareas. */
  depth: number;
  /** Posición global en el recorrido de la lista (orden de lectura). */
  order: number;
};

export type TaskBucket = 'done' | 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'someday';

/** Estados del filtro de la vista global de tareas (sección 6.3 del plan). */
export type TaskFilter = 'all' | 'overdue' | 'today' | 'upcoming' | 'done';

/** Fecha de hoy en formato ISO corto (`YYYY-MM-DD`), en hora local. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Suma días a una fecha ISO corta. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return todayIso(date);
}

/** Diferencia en días entre dos fechas ISO cortas (b - a). */
export function daysBetween(a: string, b: string): number {
  const toDate = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
  };
  return Math.round((toDate(b) - toDate(a)) / 86_400_000);
}

export function createTodoItem(text = '', init: Partial<TodoItem> = {}): TodoItem {
  return {
    id: init.id ?? createElementId(),
    text,
    checked: init.checked ?? false,
    children: init.children ?? [],
    dueDate: init.dueDate ?? null,
    assigneeId: init.assigneeId ?? null,
    priority: init.priority ?? 'none',
    completedAt: init.completedAt ?? null,
  };
}

export function countTasks(items: TodoItem[]): TodoProgress {
  let total = 0;
  let done = 0;
  for (const item of items) {
    total += 1;
    if (item.checked) done += 1;
    for (const child of item.children) {
      total += 1;
      if (child.checked) done += 1;
    }
  }
  return { total, done, ratio: total === 0 ? 0 : done / total };
}

/** «3 de 7» para la barra de progreso de la tarjeta. */
export function progressLabel(items: TodoItem[]): string {
  const { done, total } = countTasks(items);
  return `${done} de ${total}`;
}

function mapItems(items: TodoItem[], fn: (item: TodoItem) => TodoItem | null): TodoItem[] {
  const result: TodoItem[] = [];
  for (const item of items) {
    const mapped = fn(item);
    if (mapped) result.push(mapped);
  }
  return result;
}

/** Aplica un cambio a la tarea con ese id, en cualquier nivel. */
export function updateTask(items: TodoItem[], itemId: string, patch: Partial<TodoItem>): TodoItem[] {
  return mapItems(items, (item) => {
    if (item.id === itemId) return { ...item, ...patch, id: item.id };
    const children = item.children.length > 0 ? updateTask(item.children, itemId, patch) : item.children;
    return children === item.children ? item : { ...item, children };
  });
}

export function toggleTask(items: TodoItem[], itemId: string, now = Date.now()): TodoItem[] {
  const found = findTask(items, itemId);
  if (!found) return items;
  const checked = !found.item.checked;
  return updateTask(items, itemId, { checked, completedAt: checked ? now : null });
}

export function findTask(items: TodoItem[], itemId: string): { item: TodoItem; parent: TodoItem | null } | null {
  for (const item of items) {
    if (item.id === itemId) return { item, parent: null };
    for (const child of item.children) {
      if (child.id === itemId) return { item: child, parent: item };
    }
  }
  return null;
}

/** Agrega una tarea de primer nivel. Con `afterId`, justo después de esa. */
export function addTask(items: TodoItem[], text = '', afterId?: string): TodoItem[] {
  const item = createTodoItem(text);
  if (!afterId) return [...items, item];
  const index = items.findIndex((candidate) => candidate.id === afterId);
  if (index < 0) return [...items, item];
  return [...items.slice(0, index + 1), item, ...items.slice(index + 1)];
}

/** Elimina la tarea y, si era madre, también sus subtareas. */
export function removeTask(items: TodoItem[], itemId: string): TodoItem[] {
  return mapItems(items, (item) => {
    if (item.id === itemId) return null;
    const children = item.children.some((child) => child.id === itemId)
      ? item.children.filter((child) => child.id !== itemId)
      : removeTask(item.children, itemId);
    return { ...item, children };
  });
}

/**
 * Mete la tarea dentro de la anterior (un solo nivel). Si ya es subtarea, la
 * mueve al final de las subtareas de su madre.
 */
export function indentTask(items: TodoItem[], itemId: string): TodoItem[] {
  const topIndex = items.findIndex((item) => item.id === itemId);
  if (topIndex > 0) {
    const parent = items[topIndex - 1]!;
    const moved = { ...items[topIndex]!, children: [] };
    const next = [...items];
    next.splice(topIndex, 1);
    next[topIndex - 1] = { ...parent, children: [...parent.children, moved] };
    return next;
  }
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const childIndex = item.children.findIndex((child) => child.id === itemId);
    if (childIndex <= 0) continue; // ya está en el primer lugar del nivel
    const children = [...item.children];
    const [moved] = children.splice(childIndex, 1);
    children.splice(childIndex - 1, 0, { ...moved!, children: [...children[childIndex - 1]!.children, moved!] });
    return [...items.slice(0, i), { ...item, children }, ...items.slice(i + 1)];
  }
  return items;
}

/** Saca la tarea de su madre y la pone como tarea de primer nivel. */
export function outdentTask(items: TodoItem[], itemId: string): TodoItem[] {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const index = item.children.findIndex((child) => child.id === itemId);
    if (index < 0) continue;
    const children = [...item.children];
    const [moved] = children.splice(index, 1);
    const promoted: TodoItem = { ...moved!, children: [] };
    return [
      ...items.slice(0, i),
      { ...item, children },
      promoted,
      ...items.slice(i + 1),
    ];
  }
  return items;
}

/**
 * Reordena: mueve `itemId` a la posición `targetIndex` de la lista de primer
 * nivel (`parentId` null) o al final de las subtareas de `parentId`.
 */
export function moveTask(
  items: TodoItem[],
  itemId: string,
  targetIndex: number,
  parentId: string | null = null,
): TodoItem[] {
  const found = findTask(items, itemId);
  if (!found) return items;
  // No se puede meter una tarea dentro de sí misma ni de sus hijas.
  if (parentId && (parentId === itemId || found.item.children.some((child) => child.id === parentId))) return items;

  const without = removeTask(items, itemId);
  const moved: TodoItem = { ...found.item, children: parentId ? [] : found.item.children };
  if (!parentId) {
    const index = Math.max(0, Math.min(targetIndex, without.length));
    return [...without.slice(0, index), moved, ...without.slice(index)];
  }
  return mapItems(without, (item) =>
    item.id === parentId ? { ...item, children: [...item.children, moved] } : item,
  );
}

/** Lista plana en orden de lectura, con el contexto que necesita la vista global. */
export function flattenTasks(listId: string, items: TodoItem[]): FlatTask[] {
  const flat: FlatTask[] = [];
  let order = 0;
  for (const item of items) {
    flat.push({
      listId,
      itemId: item.id,
      parentId: null,
      text: item.text,
      checked: item.checked,
      dueDate: item.dueDate ?? null,
      priority: item.priority ?? 'none',
      assigneeId: item.assigneeId ?? null,
      depth: 0,
      order: order++,
    });
    for (const child of item.children) {
      flat.push({
        listId,
        itemId: child.id,
        parentId: item.id,
        text: child.text,
        checked: child.checked,
        dueDate: child.dueDate ?? null,
        priority: child.priority ?? 'none',
        assigneeId: child.assigneeId ?? null,
        depth: 1,
        order: order++,
      });
    }
  }
  return flat;
}

export function isOverdue(dueDate: string | null | undefined, today = todayIso()): boolean {
  return typeof dueDate === 'string' && dueDate.length > 0 && daysBetween(today, dueDate) < 0;
}

/** Clasificación por vencimiento, base de la vista «Tareas». */
export function bucketOf(task: FlatTask, today = todayIso()): TaskBucket {
  if (task.checked) return 'done';
  const due = task.dueDate;
  if (!due) return 'someday';
  const diff = daysBetween(today, due);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return 'upcoming';
}

export function filterTasks(tasks: FlatTask[], filter: TaskFilter, today = todayIso()): FlatTask[] {
  switch (filter) {
    case 'all':
      return tasks.filter((task) => !task.checked);
    case 'done':
      return tasks.filter((task) => task.checked);
    case 'overdue':
      return tasks.filter((task) => bucketOf(task, today) === 'overdue');
    case 'today':
      return tasks.filter((task) => {
        const bucket = bucketOf(task, today);
        return bucket === 'today' || bucket === 'overdue';
      });
    case 'upcoming':
      return tasks.filter((task) => {
        const bucket = bucketOf(task, today);
        return bucket === 'today' || bucket === 'tomorrow' || bucket === 'upcoming' || bucket === 'overdue';
      });
    default:
      return tasks;
  }
}

/** Orden de la vista global: vencidas primero, después por fecha y orden. */
export function sortTasks(tasks: FlatTask[]): FlatTask[] {
  return [...tasks].sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    const dueA = a.dueDate ?? '9999-12-31';
    const dueB = b.dueDate ?? '9999-12-31';
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    return a.order - b.order;
  });
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function parseIsoLocal(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Acepta lo que la gente escribe: `hoy`, `mañana`, `ayer`, un día de la semana
 * (`viernes`), `25/12`, `12-3`, `+7` (días) o `2026-12-25`.
 */
export function parseDueDate(input: string, now = new Date()): string | null {
  const value = input.trim().toLowerCase();
  if (value.length === 0) return null;
  const today = todayIso(now);

  if (value === 'hoy') return today;
  if (value === 'mañana' || value === 'manana') return addDays(today, 1);
  if (value === 'ayer') return addDays(today, -1);
  if (value === '+1') return addDays(today, 1);

  const relative = /^\+(\d{1,3})$/.exec(value);
  if (relative) return addDays(today, Number(relative[1]));

  const weekday = WEEKDAYS.findIndex((day) => day.startsWith(value) && value.length >= 3);
  if (weekday >= 0) {
    const current = now.getDay();
    let diff = (weekday - current + 7) % 7;
    if (diff === 0) diff = 7; // «viernes» dicho un viernes es el próximo
    return addDays(today, diff);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseIsoLocal(value) ? value : null;

  const short = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(value);
  if (short) {
    const day = Number(short[1]);
    const month = Number(short[2]);
    let year = short[3] ? Number(short[3]) : now.getFullYear();
    if (short[3] && short[3].length === 2) year += 2000;
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!parseIsoLocal(iso)) return null;
    // Sin año y ya pasó: se entiende el año que viene.
    if (!short[3] && daysBetween(today, iso) < 0) return `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return iso;
  }
  return null;
}

/** Etiqueta corta para mostrar en la tarea: «hoy», «mañana», «venció hace 2 días». */
export function dueDateLabel(dueDate: string | null | undefined, today = todayIso()): string {
  if (!dueDate) return '';
  const date = parseIsoLocal(dueDate);
  if (!date) return dueDate;
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  if (diff < -1) return `venció hace ${Math.abs(diff)} días`;
  if (diff > 1 && diff < 7) return WEEKDAYS[date.getDay()] ?? '';
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`;
}

/** ¿Esa fecha cae en la semana en curso? (para «próximas»). */
export function isThisWeek(dueDate: string | null | undefined, today = todayIso()): boolean {
  if (!dueDate) return false;
  const diff = daysBetween(today, dueDate);
  return diff >= 0 && diff < 7;
}

/** Texto plano de todas las tareas, para el índice de búsqueda y la exportación. */
export function todoPlainText(items: TodoItem[]): string {
  return flattenTasks('', items)
    .map((task) => `${task.checked ? '[x]' : '[ ]'} ${task.text}`)
    .join('\n');
}

/**
 * Tareas (`/api/tasks`).
 *
 * Las tareas no viven en Postgres: son los ítems de los elementos `todo` del
 * documento Yjs de cada tablero. Acá se recorren los documentos accesibles y se
 * derivan los cubos que usa la vista de tareas.
 */

import type { TodoItem } from '@tablero/shared';
import { getOrderedElements } from '@tablero/shared';

import { loadBoardDoc } from './documents.js';

export const TASK_BUCKETS = ['overdue', 'today', 'upcoming', 'open', 'done'] as const;
export type TaskBucket = (typeof TASK_BUCKETS)[number];
export type TaskFilter = 'all' | 'overdue' | 'today' | 'upcoming' | 'done';

export type TaskEntry = {
  boardId: string;
  boardTitle: string;
  elementId: string;
  elementTitle: string | null;
  itemId: string;
  parentItemId: string | null;
  text: string;
  checked: boolean;
  dueDate: string | null;
  priority: string | null;
  assigneeId: string | null;
  completedAt: number | null;
  bucket: TaskBucket;
};

function localDay(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Cubo derivado: las fechas ISO (yyyy-mm-dd) se comparan como texto. */
export function bucketOf(item: TodoItem, today = localDay()): TaskBucket {
  if (item.checked) return 'done';
  const due = typeof item.dueDate === 'string' && item.dueDate.length >= 10 ? item.dueDate.slice(0, 10) : null;
  if (!due) return 'open';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'upcoming';
}

function matchesFilter(bucket: TaskBucket, filter: TaskFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'done':
      return bucket === 'done';
    case 'overdue':
    case 'today':
    case 'upcoming':
      return bucket === filter;
    default:
      return true;
  }
}

function entryFor(input: {
  boardId: string;
  boardTitle: string;
  elementId: string;
  elementTitle?: string | null;
  item: TodoItem;
  parentItemId: string | null;
  today: string;
}): TaskEntry {
  return {
    boardId: input.boardId,
    boardTitle: input.boardTitle,
    elementId: input.elementId,
    elementTitle: input.elementTitle ?? null,
    itemId: input.item.id,
    parentItemId: input.parentItemId,
    text: input.item.text,
    checked: input.item.checked,
    dueDate: input.item.dueDate ?? null,
    priority: input.item.priority ?? null,
    assigneeId: input.item.assigneeId ?? null,
    completedAt: input.item.completedAt ?? null,
    bucket: bucketOf(input.item, input.today),
  };
}

/**
 * Recorre los documentos de los tableros indicados y devuelve las tareas.
 * Los tableros sin documento o con bytes ilegibles se omiten en silencio.
 */
export async function collectTasks(
  boards: { id: string; title: string }[],
  filter: TaskFilter,
  limit: number,
): Promise<TaskEntry[]> {
  const today = localDay();
  const tasks: TaskEntry[] = [];
  for (const board of boards) {
    if (tasks.length >= limit) break;
    let doc;
    try {
      doc = await loadBoardDoc(board.id);
    } catch {
      continue;
    }
    if (!doc) continue;
    for (const element of getOrderedElements(doc)) {
      if (element.type !== 'todo') continue;
      const items = Array.isArray(element.items) ? element.items : [];
      for (const item of items) {
        const bucket = bucketOf(item, today);
        if (item.text.trim().length === 0) continue;
        if (matchesFilter(bucket, filter)) {
          tasks.push(
            entryFor({
              boardId: board.id,
              boardTitle: board.title,
              elementId: element.id,
              elementTitle: element.title ?? null,
              item,
              parentItemId: null,
              today,
            }),
          );
        }
        for (const child of Array.isArray(item.children) ? item.children : []) {
          if (child.text.trim().length === 0) continue;
          if (!matchesFilter(bucketOf(child, today), filter)) continue;
          tasks.push(
            entryFor({
              boardId: board.id,
              boardTitle: board.title,
              elementId: element.id,
              elementTitle: element.title ?? null,
              item: child,
              parentItemId: item.id,
              today,
            }),
          );
        }
      }
    }
  }
  return tasks.slice(0, limit);
}

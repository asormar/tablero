/**
 * Cliente de la vista global de tareas (`GET /api/tasks`).
 *
 * Las tareas no viven en Postgres: el API recorre el documento Yjs de cada
 * tablero accesible y devuelve las filas aplanadas y ordenadas con el mismo
 * dominio que usa la web (`flattenTasks`/`filterTasks`/`sortTasks` de
 * `@tablero/shared`). Acá se tipa esa respuesta y se descartan las filas que no
 * tengan la forma esperada: la vista no puede caerse por una fila rara.
 */

import type { TaskBucket, TaskFilter, TaskPriority } from '@tablero/shared';

import { apiRequest } from './client';

/** Fila de tarea tal como la publica el API (`taskEntrySchema`). */
export type TaskRow = {
  boardId: string;
  boardTitle: string;
  /** Elemento `todo` del lienzo que contiene la tarea (la tarjeta de lista). */
  elementId: string;
  elementTitle: string | null;
  /** Id de la lista dentro del documento. */
  listId: string;
  itemId: string;
  /** Lista madre cuando la tarea es una subtarea. */
  parentId: string | null;
  text: string;
  checked: boolean;
  dueDate: string | null;
  priority: TaskPriority;
  assigneeId: string | null;
  depth: number;
  /** Posición en el recorrido de lectura de la lista. */
  order: number;
  bucket: TaskBucket;
};

const BUCKETS: readonly TaskBucket[] = ['done', 'overdue', 'today', 'tomorrow', 'upcoming', 'someday'];

function toTaskRow(raw: unknown): TaskRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const boardId = record['boardId'];
  const elementId = record['elementId'];
  const itemId = record['itemId'];
  const listId = record['listId'];
  const text = record['text'];
  if (typeof boardId !== 'string' || typeof elementId !== 'string') return null;
  if (typeof itemId !== 'string' || typeof listId !== 'string' || typeof text !== 'string') return null;
  const bucket = record['bucket'];
  return {
    boardId,
    boardTitle: typeof record['boardTitle'] === 'string' ? record['boardTitle'] : 'Tablero',
    elementId,
    elementTitle: typeof record['elementTitle'] === 'string' ? record['elementTitle'] : null,
    listId,
    itemId,
    parentId: typeof record['parentId'] === 'string' ? record['parentId'] : null,
    text,
    checked: record['checked'] === true,
    dueDate: typeof record['dueDate'] === 'string' ? record['dueDate'] : null,
    priority: (record['priority'] as TaskPriority) ?? 'none',
    assigneeId: typeof record['assigneeId'] === 'string' ? record['assigneeId'] : null,
    depth: typeof record['depth'] === 'number' ? record['depth'] : 0,
    order: typeof record['order'] === 'number' ? record['order'] : 0,
    bucket: BUCKETS.includes(bucket as TaskBucket) ? (bucket as TaskBucket) : 'someday',
  };
}

/** Tareas del usuario (o de un tablero concreto), filtradas y ordenadas. */
export async function fetchTasks(
  filter: TaskFilter,
  options: { boardId?: string; limit?: number } = {},
): Promise<TaskRow[]> {
  const payload = await apiRequest<unknown>('/tasks', {
    query: { filter, boardId: options.boardId, limit: options.limit },
    timeoutMs: 15000,
  });
  if (!payload || typeof payload !== 'object') return [];
  const rows = (payload as Record<string, unknown>)['tasks'];
  if (!Array.isArray(rows)) return [];
  return rows.map(toTaskRow).filter((row): row is TaskRow => row !== null);
}

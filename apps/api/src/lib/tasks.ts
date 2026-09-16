/**
 * Tareas (`/api/tasks`).
 *
 * Las tareas no viven en Postgres: son los ítems de los elementos `todo` del
 * documento Yjs de cada tablero. Acá se recorre cada documento accesible, se
 * aplanan los ítems con `flattenTasks`, se filtran con `filterTasks` y se
 * ordenan con `sortTasks` (la misma lógica que usa la web, en
 * `@tablero/shared`): el API no reimplementa el dominio de listas.
 *
 * La respuesta (una fila por tarea y subtarea) se valida con Zod antes de
 * salir, así el contrato que consume la vista global de tareas (§6.3) queda
 * explícito en el código.
 */

import type { FlatTask, TaskFilter, TodoItem } from '@tablero/shared';
import {
  bucketOf,
  filterTasks,
  flattenTasks,
  getOrderedElements,
  sortTasks,
  taskFilterSchema,
  todayIso,
} from '@tablero/shared';
import { z } from 'zod';

import { loadBoardDoc } from './documents.js';

/** Cubo de una tarea según su vencimiento (mismos valores que `shared`). */
export const taskBucketSchema = z.enum(['done', 'overdue', 'today', 'tomorrow', 'upcoming', 'someday']);

export const taskPrioritySchema = z.enum(['none', 'low', 'medium', 'high']);

/** Tarea aplanada: el elemento (lista) al que pertenece y su posición en ella. */
export const taskEntrySchema = z.object({
  boardId: z.string(),
  boardTitle: z.string(),
  /** Elemento `todo` (lista) del lienzo que contiene la tarea. */
  elementId: z.string(),
  elementTitle: z.string().nullable(),
  /** Id de la lista dentro del documento (lo pinta el enlace a la tarjeta). */
  listId: z.string(),
  itemId: z.string(),
  /** Lista madre, si la tarea es una subtarea. */
  parentId: z.string().nullable(),
  text: z.string(),
  checked: z.boolean(),
  dueDate: z.string().nullable(),
  priority: taskPrioritySchema,
  assigneeId: z.string().nullable(),
  /** 0 en tareas de primer nivel, 1 en subtareas. */
  depth: z.number().int().min(0).max(1),
  /** Posición global en el recorrido de la lista (orden de lectura). */
  order: z.number().int().min(0),
  bucket: taskBucketSchema,
});

export const tasksResponseSchema = z.object({
  filter: taskFilterSchema,
  tasks: z.array(taskEntrySchema),
});

export type TaskEntry = z.infer<typeof taskEntrySchema>;
export type TaskBoard = { id: string; title: string };

export const TASK_LIMIT_MAX = 500;

/**
 * Recorre los documentos de los tableros indicados y devuelve las tareas
 * aplanadas y ordenadas. Los tableros sin documento o con bytes ilegibles se
 * omiten en silencio: una vista de tareas no debe caerse por un documento roto.
 */
export async function collectTasks(boards: TaskBoard[], filter: TaskFilter, limit: number): Promise<TaskEntry[]> {
  const today = todayIso();
  const collected: { flat: FlatTask; entry: TaskEntry }[] = [];

  for (const board of boards) {
    let doc;
    try {
      doc = await loadBoardDoc(board.id);
    } catch {
      continue;
    }
    if (!doc) continue;

    for (const element of getOrderedElements(doc)) {
      if (element.type !== 'todo') continue;
      const items: TodoItem[] = Array.isArray(element.items) ? element.items : [];
      for (const flat of filterTasks(flattenTasks(element.id, items), filter, today)) {
        // Las casillas de texto vacío no son tareas (mismo criterio que la tarjeta).
        if (flat.text.trim().length === 0) continue;
        collected.push({
          flat,
          entry: {
            boardId: board.id,
            boardTitle: board.title,
            elementId: element.id,
            elementTitle: element.title ?? null,
            listId: flat.listId,
            itemId: flat.itemId,
            parentId: flat.parentId,
            text: flat.text,
            checked: flat.checked,
            dueDate: flat.dueDate,
            priority: flat.priority,
            assigneeId: flat.assigneeId,
            depth: flat.depth,
            order: flat.order,
            bucket: bucketOf(flat, today),
          },
        });
      }
    }
  }

  // `sortTasks` deja las vencidas primero y, a igualdad de fecha, por orden de
  // lectura; se reasocian las entradas por identidad del objeto aplanado.
  const byFlat = new Map<FlatTask, TaskEntry>(collected.map((item) => [item.flat, item.entry]));
  return sortTasks(collected.map((item) => item.flat))
    .slice(0, limit)
    .map((flat) => byFlat.get(flat)!);
}

/**
 * Vista de lista — partes puras (punto 8 de la fase 4).
 *
 * El tablero se aplana a filas en orden de lectura: primero las tarjetas de
 * primer nivel, y debajo de cada columna, sus tarjetas indentadas. Cada fila
 * trae un texto principal y un secundario para que la lista se entienda sin
 * abrir la tarjeta. Todo lo que se puede probar sin DOM vive acá.
 */

import { type CanvasElement, type ElementType, type TodoItem } from '@tablero/shared';

export type ListRow = {
  id: string;
  type: ElementType;
  /** Texto principal de la fila. */
  primary: string;
  /** Texto secundario (fragmento, nombre de archivo, URL…). */
  secondary: string;
  /** Profundidad: 1 dentro de una columna. */
  depth: number;
  /** Progreso de la lista de tareas, si la tarjeta es una tarea. */
  progress: { done: number; total: number } | null;
};

/** Tipos que no aparecen en la lista (igual que el modo presentación). */
const SKIPPED_TYPES: ElementType[] = ['comment-pin', 'line'];

const MAX_TEXT = 140;

function truncate(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean;
}

function firstLine(text: string): string {
  const line = text.split('\n').map((part) => part.trim()).find((part) => part.length > 0);
  return line ? truncate(line) : '';
}

function todoProgress(items: TodoItem[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const item of items) {
    total += 1;
    if (item.checked) done += 1;
    const nested = todoProgress(item.children);
    done += nested.done;
    total += nested.total;
  }
  return { done, total };
}

/**
 * Construye las filas. `plainTextOf` es el mismo extractor que usa la búsqueda
 * local (bloques de texto enriquecido + campos JSON) y `labelOf` cae al nombre
 * del tipo cuando la tarjeta no tiene texto propio.
 */
export function buildListRows(
  elements: CanvasElement[],
  plainTextOf: (element: CanvasElement) => string,
  labelOf: (type: ElementType) => string,
): ListRow[] {
  const rows: ListRow[] = [];
  const childrenOf = new Map<string, CanvasElement[]>();
  for (const element of elements) {
    if (!element.parentId) continue;
    const list = childrenOf.get(element.parentId) ?? [];
    list.push(element);
    childrenOf.set(element.parentId, list);
  }

  const pushRow = (element: CanvasElement, depth: number): void => {
    if (SKIPPED_TYPES.includes(element.type)) return;
    const text = plainTextOf(element);
    const label = labelOf(element.type);
    let primary = firstLine(text);
    let secondary = '';
    let progress: ListRow['progress'] = null;

    switch (element.type) {
      case 'column':
        primary = element.title.trim() || label;
        break;
      case 'todo': {
        const items = element.items ?? [];
        progress = todoProgress(items);
        primary = element.title?.trim() || firstLine(text) || label;
        if (progress.total > 0) secondary = `${progress.done}/${progress.total}`;
        break;
      }
      case 'swatch':
        primary = element.name?.trim() || element.hex;
        secondary = element.hex;
        break;
      case 'link':
        primary = element.preview?.title?.trim() || element.url;
        secondary = element.url;
        break;
      case 'file':
      case 'image':
      case 'video':
      case 'audio':
        primary = element.caption?.trim() || label;
        break;
      case 'board':
        primary = label;
        break;
      default:
        primary = primary || label;
        secondary = text.length > primary.length ? truncate(text.slice(primary.length)) : '';
        break;
    }

    rows.push({ id: element.id, type: element.type, primary, secondary, depth, progress });

    for (const child of childrenOf.get(element.id) ?? []) pushRow(child, depth + 1);
  };

  for (const element of elements) {
    if (element.parentId) continue;
    pushRow(element, 0);
  }
  return rows;
}

/** Etiqueta de cuenta: «12 tarjetas · 4 tareas». */
export function listSummary(rows: readonly ListRow[]): { cards: number; todos: number; done: number } {
  let todos = 0;
  let done = 0;
  for (const row of rows) {
    if (!row.progress) continue;
    todos += row.progress.total;
    done += row.progress.done;
  }
  return { cards: rows.length, todos, done };
}

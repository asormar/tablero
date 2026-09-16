/**
 * Conversión entre tipos de tarjeta de texto (§6.3).
 *
 * Milanote deja convertir una nota en documento, en lista de tareas o en
 * encabezado (y volver). El texto se copia —instantánea del `Y.XmlFragment`— y
 * el elemento original se borra en la misma transacción, así que se deshace de
 * un paso.
 */

import {
  type CanvasElement,
  type ElementType,
  addElement,
  elementsOf,
  ensureTextFragment,
  getTextFragment,
  removeElements,
  todoItemsFromDelimited,
  createTodoItem,
  DEFAULT_SIZES,
} from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { childIdArray } from '@/lib/columns';
import { blocksToPlainText } from '@/lib/textBlocks';
import { writePlainText } from '@/lib/xmlFragment';
import { restoreFragment, snapshotFragment } from '@/lib/xmlFragment';
import { tasksToMarkdown } from '@/lib/taskEditing';
import { useAppStore } from '@/state/appStore';

export type ConvertTarget = { type: ElementType; label: string };

const to = (type: ElementType, label: string): ConvertTarget => ({ type, label });

/** Tipos a los que se puede convertir una tarjeta (vacío = no se convierte). */
export function convertTargets(type: ElementType): ConvertTarget[] {
  switch (type) {
    case 'note':
      return [to('document', 'Documento'), to('todo', 'Lista de tareas'), to('heading', 'Encabezado')];
    case 'document':
      return [to('note', 'Nota'), to('todo', 'Lista de tareas'), to('heading', 'Encabezado')];
    case 'heading':
      return [to('note', 'Nota'), to('document', 'Documento')];
    case 'todo':
      return [to('note', 'Nota'), to('document', 'Documento')];
    default:
      return [];
  }
}

export function canConvert(type: ElementType): boolean {
  return convertTargets(type).length > 0;
}

/** Texto plano del elemento, para pasarlo al tipo nuevo. */
function plainTextOf(session: BoardSession, element: CanvasElement): string {
  if (element.type === 'todo') {
    const items = element.items ?? [];
    return items.length > 0 ? tasksToMarkdown(items) : '';
  }
  return blocksToPlainText(session.getTextBlocks(element.id));
}

/** Ítems de tarea a partir del texto (una tarea por línea). */
function itemsFromText(text: string): ReturnType<typeof createTodoItem>[] {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const parsed = todoItemsFromDelimited(lines.join('\n'));
  return parsed.length > 0 ? parsed : lines.map((line) => createTodoItem(line));
}

/**
 * Convierte una tarjeta en otro tipo de texto, conservando posición, tamaño,
 * color y contenido. Devuelve el id nuevo (o null si no se pudo).
 */
export function convertElement(session: BoardSession, id: string, target: ElementType): string | null {
  const source = session.getElement(id);
  if (!source || source.type === target) return null;
  if (!convertTargets(source.type).some((option) => option.type === target)) return null;

  const fragment = getTextFragment(session.doc, id);
  const snapshot = fragment ? snapshotFragment(fragment) : [];
  const text = plainTextOf(session, source);
  const createdBy = useAppStore.getState().user.id;
  const size = DEFAULT_SIZES[target];
  let created = '';

  session.doc.transact(() => {
    const init: Record<string, unknown> = {
      x: source.x,
      y: source.y,
      width: source.width,
      createdBy,
    };
    if (source.height !== undefined) init['height'] = source.height;
    if (source.color !== undefined) init['color'] = source.color;
    if (source.hex !== undefined) init['hex'] = source.hex;
    if (source.locked !== undefined) init['locked'] = source.locked;
    if (source.parentId !== undefined) init['parentId'] = source.parentId;
    if (target === 'heading') init['size'] = 'M';
    if (target === 'todo') {
      const items = source.type === 'todo' ? source.items ?? [] : itemsFromText(text);
      init['title'] = source.type === 'todo' ? source.title ?? '' : '';
      init['items'] = items;
      init['width'] = Math.max(size.width, source.width);
    }
    if (target === 'document') {
      init['width'] = Math.max(size.width, source.width);
      if (source.type === 'document' && source.height === undefined) delete init['height'];
    }

    created = addElement(session.doc, target, init as never, session.origin);

    // Texto: instantánea si había formato, si no el texto plano equivalente.
    if (target === 'note' || target === 'document' || target === 'heading') {
      const destination = ensureTextFragment(session.doc, created, session.origin);
      if (destination) {
        if (snapshot.length > 0) restoreFragment(destination, snapshot);
        else if (text.length > 0) writePlainText(destination, text, session.origin);
      }
    }

    // Reemplaza el hijo en la columna (mantiene la posición en el kanban).
    if (typeof source.parentId === 'string') {
      const array = childIdArray(session.doc, source.parentId);
      if (array) {
        const ids = array.toArray().map((value) => (value === id ? created : String(value)));
        array.delete(0, array.length);
        array.push(ids);
      }
    }

    removeElements(session.doc, [id], session.origin);
  }, session.origin);

  if (created) useAppStore.getState().setNotice(`Convertido en ${target}.`);
  return created || null;
}

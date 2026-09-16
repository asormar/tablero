/**
 * Conversión entre tipos de texto: nota ↔ documento ↔ encabezado ↔ tareas.
 *
 * La conversión no puede perder contenido: el texto viaja como instantánea del
 * `Y.XmlFragment` y, cuando el destino es una lista de tareas, el texto se
 * convierte en una tarea por línea. Todo en una transacción (un paso de
 * deshacer) y conservando posición, color y pertenencia a la columna.
 */

import { beforeAll, describe, expect, it } from 'vitest';

/** El deshacer agrupa lo que ocurre dentro de la ventana de captura (400 ms). */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 450);
  });
}

import { addElement, localOrigin, patchElement } from '@tablero/shared';

import { BoardSession } from '@/collab/BoardSession';
import { createColumnAt, createTaskCardInColumn } from '@/canvas/columnCommands';
import { columnChildren, rawChildIds } from '@/lib/columns';
import { writePlainText } from '@/lib/xmlFragment';
import { convertElement, convertTargets, canConvert } from './convert';

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
  return new BoardSession({ boardId: `convert-test-${counter}`, connect: false });
}

function noteWithText(session: BoardSession, text: string): string {
  const id = addElement(session.doc, 'note', { x: 40, y: 60, width: 240, createdBy: 'test' }, localOrigin);
  const fragment = session.ensureTextFragment(id);
  if (fragment) writePlainText(fragment, text);
  return id;
}

describe('convertTargets', () => {
  it('una nota puede volverse documento, tareas o encabezado', () => {
    expect(convertTargets('note').map((option) => option.type)).toEqual(['document', 'todo', 'heading']);
  });

  it('una lista de tareas vuelve a nota o pasa a documento', () => {
    expect(convertTargets('todo').map((option) => option.type)).toEqual(['note', 'document']);
  });

  it('las tarjetas que no son de texto no se convierten', () => {
    expect(convertTargets('image')).toEqual([]);
    expect(canConvert('image')).toBe(false);
    expect(canConvert('heading')).toBe(true);
  });
});

describe('convertElement', () => {
  it('nota → documento conserva el texto y la posición', () => {
    const session = makeSession();
    const noteId = noteWithText(session, 'Contenido de la nota');
    const text = session.getTextBlocks(noteId);

    const created = convertElement(session, noteId, 'document');
    expect(created).toBeTruthy();
    const element = session.getElement(created!);
    expect(element?.type).toBe('document');
    expect(element?.x).toBe(40);
    expect(element?.y).toBe(60);
    expect(session.getTextBlocks(created!).map((block) => block.runs[0]?.text)).toEqual(
      text.map((block) => block.runs[0]?.text),
    );
    expect(session.getElement(noteId)).toBeNull();
    session.destroy();
  });

  it('nota → tareas: una tarea por línea', () => {
    const session = makeSession();
    const noteId = noteWithText(session, 'Comprar pan\nLlamar al banco\n- Pagar la luz');

    const created = convertElement(session, noteId, 'todo');
    const element = session.getElement(created!);
    const items = element?.type === 'todo' ? element.items ?? [] : [];
    expect(items.map((item) => item.text)).toEqual(['Comprar pan', 'Llamar al banco', 'Pagar la luz']);
    expect(items.every((item) => item.checked === false)).toBe(true);
    session.destroy();
  });

  it('tareas → documento: el texto viaja con casillas', () => {
    const session = makeSession();
    const todoId = addElement(
      session.doc,
      'todo',
      {
        x: 0,
        y: 0,
        createdBy: 'test',
        items: [{ id: 't1', text: 'Hecha', checked: true, children: [] }],
      },
      localOrigin,
    );

    const created = convertElement(session, todoId, 'document');
    const text = session
      .getTextBlocks(created!)
      .map((block) => block.runs.map((run) => run.text).join(''))
      .join('\n');
    expect(text).toContain('[x] Hecha');
    session.destroy();
  });

  it('conserva el color', () => {
    const session = makeSession();
    const noteId = noteWithText(session, 'Con color');
    patchElement(session.doc, noteId, { color: 'blue' }, localOrigin);
    const created = convertElement(session, noteId, 'heading');
    expect(session.getElement(created!)?.color).toBe('blue');
    session.destroy();
  });

  it('un hijo de columna sigue dentro de la columna, en la misma posición', () => {
    const session = makeSession();
    const column = createColumnAt(session, { x: 0, y: 0 });
    const first = createTaskCardInColumn(session, column, 'Primera');
    const card = createTaskCardInColumn(session, column, 'Segunda');

    const created = convertElement(session, card, 'note');
    expect(created).toBeTruthy();
    expect(rawChildIds(session.doc, column)).toEqual([first, created]);
    expect(columnChildren(session, column).map((child) => child.id)).toEqual([first, created]);
    expect(session.getElement(created!)?.parentId).toBe(column);
    session.destroy();
  });

  it('conversiones no permitidas no tocan nada', () => {
    const session = makeSession();
    const noteId = noteWithText(session, 'X');
    expect(convertElement(session, noteId, 'image')).toBeNull();
    expect(convertElement(session, noteId, 'note')).toBeNull();
    expect(session.getElement(noteId)).not.toBeNull();
    session.destroy();
  });

  it('se deshace de un paso (vuelve la nota original)', async () => {
    const session = makeSession();
    const noteId = noteWithText(session, 'Vuelve');
    await settle();
    const created = convertElement(session, noteId, 'document');
    expect(session.getElement(created!)).not.toBeNull();

    session.undo();
    expect(session.getElement(created!)).toBeNull();
    expect(session.getElement(noteId)).not.toBeNull();
    session.destroy();
  });
});

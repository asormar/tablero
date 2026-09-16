/**
 * Suscripciones de la sesión: es la base del rendimiento de la fase 1.
 *
 * Se prueba sin navegador (stubs mínimos de `localStorage` y `window`) y sin
 * servidor: la sesión arranca en modo local, que es justo el camino que tiene
 * que funcionar aunque la API no esté.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { addElement, localOrigin, moveElements, patchElement } from '@tablero/shared';

import { writePlainText } from '@/lib/xmlFragment';

import { BoardSession } from './BoardSession';

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

let boardCounter = 0;

/** Cada test usa un tablero distinto para no compartir la persistencia local. */
function makeSession(): BoardSession {
  boardCounter += 1;
  return new BoardSession({ boardId: `board-test-${boardCounter}`, connect: false });
}

describe('BoardSession · suscripciones', () => {
  it('sin servidor queda en modo local y no rompe', async () => {
    const session = makeSession();
    await session.init();
    expect(session.getSyncState()).toBe('offline');
    expect(session.provider).toBeNull();
    session.destroy();
  });

  it('avisa solo a los suscriptores del elemento que cambió', () => {
    const session = makeSession();
    const a = addElement(session.doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    const b = addElement(session.doc, 'note', { x: 300, y: 0, createdBy: 'test' }, localOrigin);

    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const offA = session.subscribeElement(a, listenerA);
    const offB = session.subscribeElement(b, listenerB);

    moveElements(session.doc, [{ id: a, x: 8, y: 8 }], localOrigin);

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();

    offA();
    moveElements(session.doc, [{ id: a, x: 16, y: 16 }], localOrigin);
    expect(listenerA).toHaveBeenCalledTimes(1);
    session.destroy();
  });

  it('devuelve la misma referencia mientras el elemento no cambia', () => {
    const session = makeSession();
    const id = addElement(session.doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    const first = session.getElement(id);
    expect(session.getElement(id)).toBe(first);

    patchElement(session.doc, id, { color: 'blue' }, localOrigin);
    const second = session.getElement(id);
    expect(second).not.toBe(first);
    expect(second?.color).toBe('blue');
    expect(session.getElement(id)).toBe(second);
    session.destroy();
  });

  it('el layout se invalida al mover y se mantiene estable si no hay cambios', () => {
    const session = makeSession();
    const id = addElement(session.doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    const listener = vi.fn();
    const off = session.subscribeLayout(listener);

    const before = session.getLayout();
    expect(session.getLayout()).toBe(before);

    moveElements(session.doc, [{ id, x: 64, y: 32 }], localOrigin);
    expect(listener).toHaveBeenCalledTimes(1);
    const after = session.getLayout();
    expect(after).not.toBe(before);
    expect(after[0]).toMatchObject({ id, x: 64, y: 32 });
    expect(session.getLayout()).toBe(after);
    off();
    session.destroy();
  });

  it('los cambios de texto avisan al suscriptor del elemento', () => {
    const session = makeSession();
    const id = addElement(session.doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    const fragment = session.ensureTextFragment(id);
    if (!fragment) throw new Error('sin fragmento');

    const listener = vi.fn();
    const off = session.subscribeElement(id, listener);
    writePlainText(fragment, 'hola');

    expect(listener).toHaveBeenCalled();
    expect(session.getTextBlocks(id)[0]?.runs[0]?.text).toBe('hola');
    expect(session.getTextBlocks(id)).toBe(session.getTextBlocks(id));
    off();
    session.destroy();
  });
});

describe('BoardSession · deshacer', () => {
  it('deshace solo los cambios propios', () => {
    const session = makeSession();
    const mine = addElement(session.doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    // Cambio ajeno (llega de otro cliente con el origen del proveedor).
    const foreign = addElement(session.doc, 'note', { x: 500, y: 0, createdBy: 'otro' }, 'remote');

    expect(session.canUndo()).toBe(true);
    session.undo();

    const layout = session.getLayout();
    expect(layout.some((item) => item.id === mine)).toBe(false);
    expect(layout.some((item) => item.id === foreign)).toBe(true);
    session.destroy();
  });

  it('rehace lo deshecho', () => {
    const session = makeSession();
    const id = addElement(session.doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    session.undo();
    expect(session.getLayout()).toHaveLength(0);
    expect(session.canRedo()).toBe(true);
    session.redo();
    expect(session.getLayout().some((item) => item.id === id)).toBe(true);
    session.destroy();
  });
});

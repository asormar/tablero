/**
 * Suscripciones de la sesión: es la base del rendimiento de la fase 1.
 *
 * Se prueba sin navegador (stubs mínimos de `localStorage` y `window`) y sin
 * servidor: la sesión arranca en modo local, que es justo el camino que tiene
 * que funcionar aunque la API no esté.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as Y from 'yjs';

import { addElement, getOrderedElements, localOrigin, moveElements, patchElement } from '@tablero/shared';

import { writePlainText } from '@/lib/xmlFragment';

import { BoardSession } from './BoardSession';
import { bytesToBase64, loadLocalDocument, saveLocalDocument } from './localPersistence';

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

describe('BoardSession · restauración de versiones', () => {
  let resetCounter = 0;

  /** Deja correr la recuperación (compara con el remoto antes de decidir). */
  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function nextBoardId(): string {
    resetCounter += 1;
    return `board-restore-${resetCounter}`;
  }

  /** Copia local con una nota: lo que el cliente tenía antes de restaurar. */
  function seedLocalCopy(boardId: string): void {
    const doc = new Y.Doc();
    addElement(doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    saveLocalDocument(boardId, doc);
    doc.destroy();
  }

  /** Cierre del socket con el código que manda el servidor (como el proveedor). */
  function closeSocket(session: BoardSession, code: number, reason: string): void {
    const internals = session as unknown as {
      handleSocketClose(code: number, reason: string): void;
    };
    internals.handleSocketClose(code, reason);
  }

  /**
   * La decisión que cierra el hallazgo ALTO: el servidor restauró una versión y
   * cerró las conexiones (4205). La copia local no puede fusionarse con el
   * estado restaurado (la unión de CRDTs solo agrega: revive lo que la
   * restauración quitó), así que se descarta antes de reconstruir el documento.
   */
  it('un cierre 4205 descarta la copia local, corta la persistencia y pide reconstruir', async () => {
    const boardId = nextBoardId();
    seedLocalCopy(boardId);

    const session = new BoardSession({ boardId, connect: false });
    await session.init();
    // Arranca fusionando la copia local (el camino que el 4205 debe cortar).
    expect(session.getLayout()).toHaveLength(1);

    const resets = vi.fn();
    const off = session.subscribeReset(resets);
    closeSocket(session, 4205, 'Reset Connection');
    await settle();

    expect(resets).toHaveBeenCalledTimes(1);
    expect(loadLocalDocument(boardId)).toBeNull();

    // La persistencia quedó cortada: un cambio local posterior no reescribe la
    // copia descartada (ni siquiera al vencer el retardo de guardado).
    vi.useFakeTimers();
    addElement(session.doc, 'note', { x: 10, y: 10, createdBy: 'test' }, localOrigin);
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
    expect(loadLocalDocument(boardId)).toBeNull();

    // Sin fusión: una sesión nueva para el mismo tablero arranca vacía, porque
    // el documento se arma solo con lo que devuelva el servidor.
    const rebuilt = new BoardSession({ boardId, connect: false });
    await rebuilt.init();
    expect(rebuilt.getLayout()).toHaveLength(0);

    off();
    rebuilt.destroy();
    session.destroy();
  });

  it('sin descartar la copia local, una sesión nueva la fusiona (control del arreglo)', async () => {
    const boardId = nextBoardId();
    seedLocalCopy(boardId);

    const rebuilt = new BoardSession({ boardId, connect: false });
    await rebuilt.init();
    expect(rebuilt.getLayout()).toHaveLength(1);
    rebuilt.destroy();
  });

  it('descarta la copia local que el propio restaurante guarda antes de recargar', async () => {
    const boardId = nextBoardId();
    seedLocalCopy(boardId);

    const session = new BoardSession({ boardId, connect: false });
    await session.init();
    expect(session.getLayout()).toHaveLength(1);

    // Es lo que hace el panel de historial antes de `location.reload()`.
    session.discardLocalDocument();
    expect(loadLocalDocument(boardId)).toBeNull();

    const rebuilt = new BoardSession({ boardId, connect: false });
    await rebuilt.init();
    expect(rebuilt.getLayout()).toHaveLength(0);
    rebuilt.destroy();
    session.destroy();
  });

  it('un cierre 4205 sin contenido propio no descarta ni reconstruye: solo reconecta', async () => {
    const boardId = nextBoardId();
    // Documento remoto (lo que el servidor ya restauró) con una nota.
    const remote = new Y.Doc();
    addElement(remote, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    const state = bytesToBase64(Y.encodeStateAsUpdate(remote));
    remote.destroy();

    const session = new BoardSession({
      boardId,
      connect: false,
      readOnly: true,
      documentSource: async () => ({ state, updatedAt: Date.now() }),
    });
    await session.init();
    expect(session.getLayout()).toHaveLength(1);

    const resets = vi.fn();
    const off = session.subscribeReset(resets);
    closeSocket(session, 4205, 'Reset Connection');
    await settle();

    // Nada que descartar (el documento es el remoto): no se reconstruye la
    // sesión y la copia local queda rearmada con el estado actual. Sin esta
    // rama, la guardia del servidor encadenaría reconstrucciones en bucle.
    expect(resets).not.toHaveBeenCalled();
    const copy = loadLocalDocument(boardId);
    expect(copy).not.toBeNull();
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, copy as Uint8Array);
    expect(getOrderedElements(decoded)).toHaveLength(1);
    decoded.destroy();

    off();
    session.destroy();
  });

  it('un cierre normal no descarta nada ni pide reconstruir', async () => {
    const boardId = nextBoardId();
    seedLocalCopy(boardId);

    const session = new BoardSession({ boardId, connect: false });
    await session.init();

    const resets = vi.fn();
    const off = session.subscribeReset(resets);
    closeSocket(session, 1000, '');
    await settle();

    expect(resets).not.toHaveBeenCalled();
    expect(loadLocalDocument(boardId)).not.toBeNull();
    expect(session.getLayout()).toHaveLength(1);

    off();
    session.destroy();
  });
});

describe('BoardSession · tablero local', () => {
  it('un tablero local (bd_…) no toca la red y queda editable', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const session = new BoardSession({ boardId: 'bd_localnet1', connect: true, role: 'owner' });
      await session.init();

      // Sin servidor al que llamar: el documento vive en localStorage y el rol
      // dueño deja la interfaz en editable (el 4401 de antes la bloqueaba).
      expect(session.getSyncState()).toBe('offline');
      expect(session.provider).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(session.getPermission().readOnly).toBe(false);

      session.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

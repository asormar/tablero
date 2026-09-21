/**
 * Selección y borrado de conectores (fase 7).
 *
 * Cubre la lógica que sostienen los gestos del lienzo: el acierto por geometría
 * (`connectorAtPoint`, con tolerancia ancha para poder hacer clic en una flecha
 * fina) y el borrado con `Supr`, que tiene que caer en **una sola** transacción
 * de deshacer: un `Deshacer` devuelve la flecha entera.
 *
 * La tarjeta se arma sin navegador (stubs mínimos de `localStorage` y `window`),
 * como en `collab/BoardSession.test.ts`: la sesión arranca en modo local.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { addElement, localOrigin, pointOnPath } from '@tablero/shared';

import { connectorAtPoint, resolveConnectors } from '@/canvas/connectorGeometry';
import { deleteSelectedConnector } from '@/canvas/connectorCommands';
import { BoardSession } from '@/collab/BoardSession';
import { addConnector } from '@/lib/connectors';
import { useUiStore } from '@/state/uiStore';

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

/** Dos notas separadas y una flecha de la primera a la segunda. */
async function boardWithConnector(): Promise<{ session: BoardSession; from: string; to: string; connectorId: string }> {
  boardCounter += 1;
  const session = new BoardSession({ boardId: `board-conn-${boardCounter}`, connect: false });
  await session.init();
  const from = addElement(session.doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
  const to = addElement(session.doc, 'note', { x: 640, y: 320, createdBy: 'test' }, localOrigin);
  const connectorId = addConnector(session.doc, { elementId: from }, { elementId: to }, session.origin);
  return { session, from, to, connectorId };
}

beforeEach(() => {
  useUiStore.getState().setSelectedConnector(null);
});

describe('selección de conectores', () => {
  it('acierta sobre el trazo y devuelve la flecha más cercana', async () => {
    const { session, connectorId } = await boardWithConnector();
    const [resolved] = resolveConnectors(session, session.getLayout());
    expect(resolved).toBeDefined();
    const middle = pointOnPath(resolved!.geometry, 0.5);
    expect(connectorAtPoint(session, middle)?.id).toBe(connectorId);
    session.destroy();
  });

  it('deja una tolerancia de unos pocos píxeles alrededor del trazo', async () => {
    const { session, connectorId } = await boardWithConnector();
    const [resolved] = resolveConnectors(session, session.getLayout());
    const middle = pointOnPath(resolved!.geometry, 0.5);
    // 4 px de desvío: sigue acertando (la flecha se puede clicar sin puntería).
    expect(connectorAtPoint(session, { x: middle.x, y: middle.y - 4 })?.id).toBe(connectorId);
    // Muy lejos: no hay nada que seleccionar, y el clic sigue siendo del lienzo.
    expect(connectorAtPoint(session, { x: middle.x + 240, y: middle.y + 240 })).toBeNull();
    session.destroy();
  });

  it('sin conectores no hay nada que seleccionar', async () => {
    boardCounter += 1;
    const session = new BoardSession({ boardId: `board-conn-vacio-${boardCounter}`, connect: false });
    await session.init();
    expect(connectorAtPoint(session, { x: 10, y: 10 })).toBeNull();
    session.destroy();
  });
});

describe('borrado del conector seleccionado', () => {
  it('sin selección no borra nada (y no se come el borrado de tarjetas)', async () => {
    const { session } = await boardWithConnector();
    expect(deleteSelectedConnector(session)).toBe(false);
    expect(session.getConnectors()).toHaveLength(1);
    session.destroy();
  });

  it('borra la flecha seleccionada, limpia la selección y deshace en un solo paso', async () => {
    const { session, connectorId } = await boardWithConnector();
    // Se corta el agrupado de transacciones: lo que sigue (el borrado) es un
    // paso de deshacer propio, como cuando se borra a mano con `Supr`.
    session.undoManager.stopCapturing();
    useUiStore.getState().setSelectedConnector(connectorId);
    expect(deleteSelectedConnector(session)).toBe(true);
    expect(session.getConnectors()).toHaveLength(0);
    expect(useUiStore.getState().selectedConnectorId).toBeNull();

    // Una sola transacción: un `Deshacer` devuelve la flecha completa y no
    // toca las tarjetas que unía.
    session.undo();
    const restored = session.getConnectors();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(connectorId);
    expect(restored[0]!.from.elementId).not.toBeNull();
    expect(restored[0]!.to.elementId).not.toBeNull();
    expect(session.getLayout()).toHaveLength(2);

    // Y rehacer la vuelve a quitar (una transacción, no dos).
    session.redo();
    expect(session.getConnectors()).toHaveLength(0);
    session.destroy();
  });

  it('no toca las tarjetas que la flecha unía', async () => {
    const { session, from, to, connectorId } = await boardWithConnector();
    useUiStore.getState().setSelectedConnector(connectorId);
    deleteSelectedConnector(session);
    expect(session.getElement(from)).not.toBeNull();
    expect(session.getElement(to)).not.toBeNull();
    expect(session.getLayout()).toHaveLength(2);
    session.destroy();
  });
});

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

import { addElement, boundsOf, localOrigin, MIN_CONNECTOR_BODY, pointOnPath } from '@tablero/shared';

import { connectorsInRect, connectorAtPoint, resolveConnectors } from '@/canvas/connectorGeometry';
import { deleteSelection } from '@/canvas/commands';
import { deleteSelectedConnector } from '@/canvas/connectorCommands';
import { BoardSession } from '@/collab/BoardSession';
import { rectOf } from '@/lib/layout';
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
async function boardWithConnector(role: 'owner' | null = null): Promise<{ session: BoardSession; from: string; to: string; connectorId: string }> {
  boardCounter += 1;
  const session = new BoardSession({ boardId: `board-conn-${boardCounter}`, connect: false, role });
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

describe('lazo de selección con conectores', () => {
  it('el lazo sobre dos tarjetas también abarca la flecha que las une', async () => {
    const { session, from, to, connectorId } = await boardWithConnector();
    const boxes = session.getLayout().map((item) => rectOf(item));
    const rect = boundsOf(boxes);
    expect(rect).not.toBeNull();
    // El lazo que envuelve las dos tarjetas abarca el trazo que las une.
    expect(connectorsInRect(session, rect!).map((connector) => connector.id)).toEqual([connectorId]);
    // Un lazo lejos (o entre las tarjetas pero sin tocar el trazo que pasó por
    // ahí) no la incluye.
    expect(connectorsInRect(session, { x: rect!.x - 900, y: rect!.y, width: 120, height: 120 })).toEqual([]);
    expect(from).not.toBe(to);
    session.destroy();
  });

  it('Supr borra tarjetas y conector en UNA transacción y Ctrl+Z devuelve todo', async () => {
    const { session, from, to, connectorId } = await boardWithConnector('owner');
    const rect = boundsOf(session.getLayout().map((item) => rectOf(item)));
    expect(rect).not.toBeNull();
    const ui = useUiStore.getState();
    // El lazo deja las dos tarjetas y la flecha dentro de la selección.
    ui.select([from, to]);
    ui.setSelectedConnectors(connectorsInRect(session, rect!).map((connector) => connector.id));
    expect(useUiStore.getState().selection).toHaveLength(2);
    expect(useUiStore.getState().selectedConnectorIds).toEqual([connectorId]);

    // Se corta el agrupado: el borrado es un paso de deshacer propio.
    session.undoManager.stopCapturing();
    deleteSelection(session);
    expect(session.getLayout()).toHaveLength(0);
    expect(session.getConnectors()).toHaveLength(0);
    expect(useUiStore.getState().selection).toEqual([]);
    expect(useUiStore.getState().selectedConnectorIds).toEqual([]);

    // Un solo `Deshacer` devuelve las dos tarjetas y la flecha entera.
    session.undo();
    expect(session.getLayout().map((item) => item.id).sort()).toEqual([from, to].sort());
    const restored = session.getConnectors();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(connectorId);
    expect(restored[0]!.from.elementId).toBe(from);
    expect(restored[0]!.to.elementId).toBe(to);
    session.destroy();
  });
});

describe('conector entre dos tarjetas pegadas', () => {
  /** Dos notas seguidas: la segunda empieza donde termina la primera. */
  async function peggedPair(): Promise<{ session: BoardSession; connectorId: string; seam: { x: number; y: number } }> {
    boardCounter += 1;
    const session = new BoardSession({ boardId: `board-pegado-${boardCounter}`, connect: false });
    await session.init();
    const from = addElement(session.doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    const first = session.getLayout().find((item) => item.id === from);
    expect(first).toBeDefined();
    const to = addElement(
      session.doc,
      'note',
      { x: first!.x + first!.width, y: first!.y, createdBy: 'test' },
      localOrigin,
    );
    const connectorId = addConnector(session.doc, { elementId: from }, { elementId: to }, session.origin);
    const [resolved] = resolveConnectors(session, session.getLayout());
    expect(resolved).toBeDefined();
    // La costura: el punto donde se tocan las dos tarjetas, que además es el
    // ancla de destino (donde queda la punta).
    expect(resolved!.geometry.end.x).toBeCloseTo(first!.x + first!.width, 6);
    return { session, connectorId, seam: resolved!.geometry.end };
  }

  it('el cuerpo tiene el mínimo visible (antes era solo la punta de flecha)', async () => {
    const { session, connectorId, seam } = await peggedPair();
    const [resolved] = resolveConnectors(session, session.getLayout());
    const { geometry } = resolved!;
    expect(resolved!.connector.id).toBe(connectorId);
    expect(geometry.end).toEqual(seam);
    expect(geometry.endDirection).toEqual({ x: 1, y: 0 });
    expect(Math.hypot(geometry.end.x - geometry.start.x, geometry.end.y - geometry.start.y)).toBeGreaterThanOrEqual(
      MIN_CONNECTOR_BODY - 1e-6,
    );
    session.destroy();
  });

  it('el clic sobre la costura lo encuentra y Supr lo borra en una sola transacción', async () => {
    const { session, connectorId, seam } = await peggedPair();
    // El hit-test de siempre pasa por la costura: ahí hace clic el usuario.
    expect(connectorAtPoint(session, seam)?.id).toBe(connectorId);
    expect(connectorAtPoint(session, { x: seam.x, y: seam.y - 4 })?.id).toBe(connectorId);
    // Lejos del trazo no hay nada que seleccionar.
    expect(connectorAtPoint(session, { x: seam.x, y: seam.y - 40 })).toBeNull();

    session.undoManager.stopCapturing();
    useUiStore.getState().setSelectedConnector(connectorId);
    expect(deleteSelectedConnector(session)).toBe(true);
    expect(session.getConnectors()).toHaveLength(0);
    // Una sola transacción: un `Deshacer` la devuelve entera.
    session.undo();
    const restored = session.getConnectors();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(connectorId);
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

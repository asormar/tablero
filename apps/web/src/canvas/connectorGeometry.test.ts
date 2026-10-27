/**
 * Resolución de rectángulos de los conectores: modo estático (capa) frente a
 * modo vivo (gestos).
 *
 * El modo estático sale solo del layout en coordenadas de mundo, así que no
 * depende del viewport; el DOM solo cubre los hijos de columna, que el layout
 * absoluto no trae. Se prueba con nodos del DOM simulados (el entorno de test no
 * tiene navegador).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { addElement, createConnector, localOrigin } from '@tablero/shared';

import { setCanvasRoot } from '@/canvas/canvasRef';
import { createRectResolver, geometryOf, hasColumnChildEndpoints } from '@/canvas/connectorGeometry';
import { registerNode } from '@/canvas/nodeRegistry';
import { BoardSession } from '@/collab/BoardSession';
import { addConnector } from '@/lib/connectors';
import { type ElementLayout } from '@/lib/layout';
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

function fakeNode(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  return { getBoundingClientRect: () => rect } as unknown as HTMLElement;
}

function layoutItem(id: string, x: number, y: number, width: number, height: number, autoHeight = false): ElementLayout {
  return { id, type: 'note', x, y, width, height, autoHeight, parentId: null, locked: false };
}

const mounted: string[] = [];

function mount(id: string, node: HTMLElement): void {
  registerNode(id, node);
  mounted.push(id);
}

beforeEach(() => {
  setCanvasRoot({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as HTMLElement);
  useUiStore.getState().setViewport({ x: 0, y: 0, scale: 1 });
});

afterEach(() => {
  for (const id of mounted.splice(0)) registerNode(id, null);
  setCanvasRoot(null);
});

describe('createRectResolver · modo estático', () => {
  it('resuelve por layout con la altura medida y no lee el DOM de las tarjetas del layout', () => {
    const layout = [layoutItem('a', 100, 50, 200, 80, true)];
    // El DOM dice otra cosa (por ejemplo, un transform de arrastre en curso).
    mount('a', fakeNode({ left: 999, top: 999, width: 10, height: 10 }));
    const resolve = createRectResolver(layout, new Map([['a', 120]]), { live: false });
    expect(resolve('a')).toEqual({ x: 100, y: 50, width: 200, height: 120 });
  });

  it('el resultado no cambia al desplazar ni al hacer zoom', () => {
    const layout = [layoutItem('a', 100, 50, 200, 80), layoutItem('b', 500, 300, 200, 80)];
    const connector = createConnector('c', { elementId: 'a' }, { elementId: 'b' });
    const geometryAt = (viewport: { x: number; y: number; scale: number }) => {
      useUiStore.getState().setViewport(viewport);
      const resolve = createRectResolver(layout, undefined, { live: false });
      return geometryOf(connector, resolve);
    };
    const base = geometryAt({ x: 0, y: 0, scale: 1 });
    expect(geometryAt({ x: 640, y: -200, scale: 0.35 })).toEqual(base);
    expect(geometryAt({ x: -90, y: 40, scale: 2.4 })).toEqual(base);
  });

  it('un id fuera del layout (hijo de columna) se lee del DOM, en coordenadas de mundo', () => {
    useUiStore.getState().setViewport({ x: 100, y: 40, scale: 2 });
    // En pantalla: 400,200 con 2x de zoom → mundo: 100 + 400/2, 40 + 200/2.
    mount('child', fakeNode({ left: 400, top: 200, width: 360, height: 100 }));
    const resolve = createRectResolver([], undefined, { live: false });
    expect(resolve('child')).toEqual({ x: 300, y: 140, width: 180, height: 50 });
    expect(resolve('desconocido')).toBeNull();
  });
});

describe('createRectResolver · modo vivo', () => {
  it('prefiere el DOM sobre el layout (sigue al arrastre en curso)', () => {
    const layout = [layoutItem('a', 100, 50, 200, 80)];
    mount('a', fakeNode({ left: 130, top: 70, width: 200, height: 80 }));
    const resolve = createRectResolver(layout);
    expect(resolve('a')).toEqual({ x: 130, y: 70, width: 200, height: 80 });
  });

  it('sin nodo montado usa el layout', () => {
    const resolve = createRectResolver([layoutItem('a', 100, 50, 200, 80)]);
    expect(resolve('a')).toEqual({ x: 100, y: 50, width: 200, height: 80 });
  });
});

describe('hasColumnChildEndpoints', () => {
  let counter = 0;

  async function board(): Promise<BoardSession> {
    counter += 1;
    const session = new BoardSession({ boardId: `board-geom-${counter}`, connect: false });
    await session.init();
    return session;
  }

  it('es falso cuando todos los extremos están en el layout o libres', async () => {
    const session = await board();
    const a = addElement(session.doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    const b = addElement(session.doc, 'note', { x: 400, y: 0, createdBy: 'test' }, localOrigin);
    addConnector(session.doc, { elementId: a }, { elementId: b }, session.origin);
    addConnector(session.doc, { elementId: a }, { elementId: null, point: { x: 10, y: 10 } }, session.origin);
    expect(hasColumnChildEndpoints(session, session.getConnectors(), session.getLayout())).toBe(false);
    session.destroy();
  });

  it('es verdadero cuando un extremo es hijo de una columna', async () => {
    const session = await board();
    const a = addElement(session.doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    const column = addElement(session.doc, 'column', { x: 400, y: 0, createdBy: 'test' }, localOrigin);
    const child = addElement(session.doc, 'note', { x: 0, y: 0, parentId: column, createdBy: 'test' }, localOrigin);
    addConnector(session.doc, { elementId: a }, { elementId: child }, session.origin);
    expect(session.getLayout().some((item) => item.id === child)).toBe(false);
    expect(hasColumnChildEndpoints(session, session.getConnectors(), session.getLayout())).toBe(true);
    session.destroy();
  });
});

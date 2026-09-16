/**
 * Mover elementos entre tableros: plan de colocación y expansión de columnas.
 *
 * El movimiento en sí necesita servidor (abre una sesión del tablero destino y
 * espera el `synced`), así que acá se prueba lo que decide *qué* se copia y
 * *dónde* cae, que es donde se puede perder contenido.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { addElement, localOrigin, type Rect } from '@tablero/shared';

import { BoardSession } from '@/collab/BoardSession';
import { createColumnAt, createTaskCardInColumn } from '@/canvas/columnCommands';
import { expandWithColumnChildren, transferFailureMessage, transferOffset } from './boardTransfer';

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
  return new BoardSession({ boardId: `transfer-test-${counter}`, connect: false });
}

const rect = (x: number, y: number, width = 100, height = 100): Rect => ({ x, y, width, height });

describe('transferOffset', () => {
  it('sin elementos en el destino, cae en su sitio original', () => {
    expect(transferOffset([], rect(10, 20))).toEqual({ dx: 0, dy: 0 });
  });

  it('con contenido, se coloca a la derecha de lo que ya hay', () => {
    const existing = [rect(0, 0), rect(200, 0, 100, 100)];
    const offset = transferOffset(existing, rect(500, 500));
    expect(offset.dx).toBe(300 + 64 - 500);
    expect(offset.dy).toBe(-500);
  });

  it('sin grupo que mover no hay desplazamiento', () => {
    expect(transferOffset([rect(0, 0)], null)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('expandWithColumnChildren', () => {
  it('una columna viaja con sus hijos', () => {
    const session = makeSession();
    const column = createColumnAt(session, { x: 0, y: 0 });
    const child = createTaskCardInColumn(session, column, 'Dentro');
    const ids = expandWithColumnChildren(session, [column]);
    expect(ids).toEqual([column, child]);
    session.destroy();
  });

  it('una tarjeta suelta viaja sola y no se duplica', () => {
    const session = makeSession();
    const note = addElement(session.doc, 'note', { x: 0, y: 0, createdBy: 'test' }, localOrigin);
    expect(expandWithColumnChildren(session, [note, note])).toEqual([note]);
    session.destroy();
  });

  it('un id que ya no existe se ignora', () => {
    const session = makeSession();
    expect(expandWithColumnChildren(session, ['fantasma'])).toEqual([]);
    session.destroy();
  });
});

describe('transferFailureMessage', () => {
  it('cada fallo tiene un mensaje claro', () => {
    expect(transferFailureMessage('offline')).toContain('conexión');
    expect(transferFailureMessage('sync')).toContain('no se movió nada');
    expect(transferFailureMessage('local-target')).toContain('servidor');
    expect(transferFailureMessage('same-board')).toContain('ya están');
    expect(transferFailureMessage('nothing')).toContain('nada');
  });
});

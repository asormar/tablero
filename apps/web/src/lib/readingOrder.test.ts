/**
 * Pruebas del orden de lectura (fase 4, punto 8).
 */

import { describe, expect, it } from 'vitest';

import type { CanvasElement } from '@tablero/shared';

import { readingOrder } from './readingOrder';

function element(id: string, x: number, y: number, extra: Partial<CanvasElement> = {}): CanvasElement {
  return { id, type: 'note', x, y, width: 200, createdBy: 't', createdAt: 1, updatedAt: 1, ...extra } as CanvasElement;
}

describe('readingOrder', () => {
  it('ordena de arriba hacia abajo y, a igual altura, de izquierda a derecha', () => {
    const ordered = readingOrder([element('b', 300, 0), element('a', 0, 0), element('c', 0, 500)]);
    expect(ordered.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('tolera diferencias de altura menores a 24 px al comparar filas', () => {
    const ordered = readingOrder([element('b', 300, 10), element('a', 0, 0)]);
    expect(ordered.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('con la misma posición usa el orden de creación', () => {
    const older = { ...element('viejo', 0, 0), createdAt: 1 };
    const newer = { ...element('nuevo', 0, 0), createdAt: 2 };
    expect(readingOrder([newer, older]).map((item) => item.id)).toEqual(['viejo', 'nuevo']);
  });

  it('pone los hijos de una columna justo debajo de su columna', () => {
    const column = element('col', 0, 0, { type: 'column' });
    const child = element('hijo', 0, 400, { parentId: 'col' });
    const other = element('otro', 0, 200);
    const ordered = readingOrder([other, child, column]);
    expect(ordered.map((item) => item.id)).toEqual(['col', 'hijo', 'otro']);
  });

  it('deja los huérfanos al final', () => {
    const orphan = element('huerfano', 0, 0, { parentId: 'fantasma' });
    expect(readingOrder([orphan]).map((item) => item.id)).toEqual(['huerfano']);
  });

  it('no pierde ni duplica elementos', () => {
    const items = [
      element('a', 0, 0),
      element('b', 0, 10, { parentId: 'a' }),
      element('c', 500, 0),
    ];
    const ordered = readingOrder(items);
    expect(ordered).toHaveLength(items.length);
    expect(new Set(ordered.map((item) => item.id)).size).toBe(items.length);
  });
});

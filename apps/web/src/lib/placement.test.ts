/** Colocación de elementos nuevos: centrado, rejilla y hueco libre. */

import { describe, expect, it } from 'vitest';

import { centeredTopLeft, placementForNewElement } from './placement';

const size = { width: 240, height: 120 };

describe('placementForNewElement', () => {
  it('centra el elemento en el punto pedido y lo ajusta a la rejilla', () => {
    const point = placementForNewElement({ existing: [], size, world: { x: 100, y: 100 } });
    expect(point.x % 8 === 0).toBe(true);
    expect(point.y % 8 === 0).toBe(true);
    expect(point).toEqual({ x: -16, y: 40 });
  });

  it('baja hasta encontrar un hueco libre cuando el punto está ocupado', () => {
    const occupied = [{ x: -16, y: 40, width: 240, height: 120 }];
    const point = placementForNewElement({
      existing: occupied,
      size,
      world: { x: 100, y: 100 },
    });
    expect(point.y).toBeGreaterThanOrEqual(40 + 120);
    expect(point.x).toBe(-16);
  });

  it('no se mueve si el hueco está libre', () => {
    const point = placementForNewElement({
      existing: [{ x: 2000, y: 2000, width: 240, height: 120 }],
      size,
      world: { x: 100, y: 100 },
    });
    expect(point).toEqual({ x: -16, y: 40 });
  });

  it('sin ajuste a rejilla respeta el punto exacto', () => {
    const point = placementForNewElement({
      existing: [],
      size,
      world: { x: 100, y: 100 },
      snap: false,
    });
    expect(point).toEqual({ x: -20, y: 40 });
  });
});

describe('centeredTopLeft', () => {
  it('devuelve la esquina superior izquierda', () => {
    expect(centeredTopLeft({ x: 500, y: 500 }, size)).toEqual({ x: 380, y: 440 });
  });
});

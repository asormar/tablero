/**
 * Virtualización: solo se montan las tarjetas que intersectan el viewport
 * ampliado. Es el criterio que sostiene los 60 fps con 300 notas.
 */

import { describe, expect, it } from 'vitest';

import type { CanvasElement } from '@tablero/shared';

import {
  LAYOUT_PADDING,
  effectiveHeight,
  layoutOf,
  layoutRects,
  rectOf,
  targetRects,
  visibleIds,
  visibleLayout,
} from './layout';

function note(id: string, x: number, y: number, width = 240): CanvasElement {
  return {
    id,
    type: 'note',
    x,
    y,
    width,
    createdBy: 'test',
    createdAt: 1,
    updatedAt: 1,
  };
}

function grid(count: number, columns: number, gap = 48): CanvasElement[] {
  const elements: CanvasElement[] = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    elements.push(note(`el-${index}`, column * (240 + gap), row * 160));
  }
  return elements;
}

describe('layoutOf', () => {
  it('marca autoHeight cuando el elemento no fija altura', () => {
    const [first] = layoutOf([note('a', 0, 0)]);
    expect(first?.autoHeight).toBe(true);
  });

  it('usa la altura fijada por el usuario', () => {
    const element: CanvasElement = { ...note('a', 0, 0), height: 300 };
    const [item] = layoutOf([element]);
    expect(item?.height).toBe(300);
    expect(item?.autoHeight).toBe(false);
  });
});

describe('effectiveHeight', () => {
  it('prefiere la altura medida sobre la de reserva', () => {
    const [item] = layoutOf([note('a', 0, 0)]);
    expect(item).toBeTruthy();
    if (!item) return;
    expect(effectiveHeight(item, new Map([['a', 180]]))).toBe(180);
    expect(effectiveHeight(item, undefined)).toBe(48);
  });

  it('ignora medidas absurdas', () => {
    const [item] = layoutOf([note('a', 0, 0)]);
    if (!item) throw new Error('sin layout');
    expect(effectiveHeight(item, new Map([['a', 0]]))).toBe(48);
  });
});

describe('visibleLayout (virtualización)', () => {
  const layout = layoutOf(grid(300, 20));

  it('con 300 notas y la vista completa monta las 300', () => {
    const view = { x: -LAYOUT_PADDING, y: -LAYOUT_PADDING, width: 7000, height: 6000 };
    expect(visibleLayout(layout, view).length).toBe(300);
  });

  it('con la vista acotada monta solo unas pocas', () => {
    const view = { x: 0, y: 0, width: 1000, height: 700 };
    const visible = visibleLayout(layout, view);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(40);
  });

  it('mantiene el orden de apilado original', () => {
    const view = { x: 0, y: 0, width: 1000, height: 700 };
    const ids = visibleIds(layout, view);
    const sorted = [...ids].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
    expect(ids).toEqual(sorted);
  });

  it('aplica el margen: una tarjeta fuera del viewport pero dentro del margen se monta', () => {
    const view = { x: 1000, y: 0, width: 500, height: 400 };
    const ids = visibleIds(layoutOf([note('cerca', 1000 - LAYOUT_PADDING - 100, 0)]), view);
    expect(ids).toEqual(['cerca']);
  });

  it('no monta lo que queda fuera del margen', () => {
    const view = { x: 5000, y: 5000, width: 500, height: 400 };
    expect(visibleIds(layout, view)).toEqual([]);
  });
});

describe('layoutRects y targetRects', () => {
  it('aplica alturas medidas a los rectángulos', () => {
    const layout = layoutOf([note('a', 0, 0)], );
    const rects = layoutRects(layout, new Map([['a', 120]]));
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 240, height: 120 });
  });

  it('excluye los elementos que se están arrastrando', () => {
    const layout = layoutOf([note('a', 0, 0), note('b', 300, 0)]);
    const targets = targetRects(
      layout,
      undefined,
      new Set(['a']),
      { x: 0, y: 0, width: 800, height: 600 },
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]?.x).toBe(300);
  });

  it('ignora lo que está lejos de la vista', () => {
    const layout = layoutOf([note('lejos', 100000, 100000)]);
    const targets = targetRects(layout, undefined, new Set(), {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    expect(targets).toEqual([]);
  });
});

describe('rectOf', () => {
  it('devuelve el rectángulo de mundo con la altura efectiva', () => {
    const [item] = layoutOf([note('a', 12, 24)]);
    if (!item) throw new Error('sin layout');
    expect(rectOf(item, new Map([['a', 90]]))).toEqual({ x: 12, y: 24, width: 240, height: 90 });
  });
});

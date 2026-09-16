/**
 * Arrastre con guías y rejilla, y redimensión de ancho.
 * Son las cuentas que decide el gesto, así que se prueban sin DOM.
 */

import { describe, expect, it } from 'vitest';

import { GRID_SIZE } from '@tablero/shared';

import { appliedDrag, appliedWidthResize, nudgeDelta, nudgeMoves } from './dragMath';

const rect = (x: number, y: number, width = 240, height = 100) => ({ x, y, width, height });

describe('appliedDrag', () => {
  it('sin elementos de referencia ajusta a la rejilla de 8 px', () => {
    const result = appliedDrag({ rects: [rect(0, 0)], dx: 5, dy: 3, targets: [] });
    expect(result.dx).toBe(GRID_SIZE);
    expect(result.dy).toBe(0);
    expect(result.rects[0]).toMatchObject({ x: 8, y: 0 });
    expect(result.guides).toEqual([]);
  });

  it('pega el borde derecho al borde izquierdo de un vecino y devuelve la guía', () => {
    const result = appliedDrag({
      rects: [rect(0, 0)],
      dx: 8,
      dy: 0,
      targets: [rect(250, 0)],
    });
    expect(result.rects[0]).toMatchObject({ x: 10, y: 0 });
    const vertical = result.guides.find((guide) => guide.axis === 'x');
    expect(vertical).toMatchObject({ position: 250, kind: 'edge' });
    // El eje Y también coincide (los dos rectángulos comparten y = 0).
    expect(result.guides.some((guide) => guide.axis === 'y')).toBe(true);
  });

  it('marca la guía aunque el vecino no comparta la altura', () => {
    const result = appliedDrag({
      rects: [rect(0, 0)],
      dx: 8,
      dy: 0,
      targets: [rect(250, 500)],
    });
    expect(result.rects[0]).toMatchObject({ x: 10, y: 0 });
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]).toMatchObject({ axis: 'x', position: 250 });
  });

  it('el desplazamiento final es crudo + ajuste', () => {
    const result = appliedDrag({ rects: [rect(0, 0)], dx: 8, dy: 0, targets: [rect(250, 0)] });
    expect(result.dx).toBe(10);
  });

  it('mueve el grupo completo manteniendo las distancias internas', () => {
    const moving = [rect(0, 0), rect(300, 0)];
    const result = appliedDrag({ rects: moving, dx: 16, dy: 24, targets: [] });
    const first = result.rects[0];
    const second = result.rects[1];
    expect(first && second).toBeTruthy();
    expect((second?.x ?? 0) - (first?.x ?? 0)).toBe(300);
    expect((second?.y ?? 0) - (first?.y ?? 0)).toBe(0);
  });

  it('respeta la desactivación de guías', () => {
    const result = appliedDrag({
      rects: [rect(0, 0)],
      dx: 8,
      dy: 0,
      targets: [rect(250, 0)],
      guides: false,
      gridSnap: false,
    });
    expect(result.guides).toEqual([]);
    expect(result.rects[0]).toMatchObject({ x: 8 });
  });
});

describe('appliedWidthResize', () => {
  it('desde el este suma el desplazamiento y no mueve la x', () => {
    const result = appliedWidthResize({ x: 40, width: 240 }, 13, 'e');
    expect(result.width).toBe(GRID_SIZE * 32);
    expect(result.x).toBe(40);
  });

  it('desde el oeste mantiene fijo el borde derecho', () => {
    const result = appliedWidthResize({ x: 40, width: 240 }, -16, 'w');
    expect(result.width).toBe(256);
    expect(result.x).toBe(24);
    expect(result.x + result.width).toBe(280);
  });

  it('nunca baja del ancho mínimo', () => {
    const result = appliedWidthResize({ x: 0, width: 240 }, -500, 'e');
    expect(result.width).toBe(80);
  });
});

describe('nudge', () => {
  it('1 px, 10 px con Shift', () => {
    expect(nudgeDelta(false)).toBe(1);
    expect(nudgeDelta(true)).toBe(10);
  });

  it('desplaza todos los elementos seleccionados', () => {
    const moves = nudgeMoves(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 10 },
      ],
      1,
      -1,
    );
    expect(moves).toEqual([
      { id: 'a', x: 1, y: -1 },
      { id: 'b', x: 11, y: 9 },
    ]);
  });
});

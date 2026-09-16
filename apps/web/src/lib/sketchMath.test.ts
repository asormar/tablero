/**
 * Dibujo: conversión de trazos a SVG y ayudas de las figuras.
 *
 * Lo que se prueba acá es lo que hace que la tarjeta se vea: el contorno con
 * presión de `perfect-freehand`, las figuras de dos puntos y la lectura de
 * muestras del puntero (con presión o simulada).
 */

import { describe, expect, it } from 'vitest';

import { createStroke, pointsOf } from '@tablero/shared';

import {
  finishStroke,
  isShapeTool,
  outlineToPath,
  previewPath,
  renderOf,
  samplesToPoints,
  shapeRect,
} from './sketchMath';

describe('shapeRect', () => {
  it('normaliza el rectángulo sin importar la dirección del trazo', () => {
    expect(shapeRect({ x: 100, y: 100 }, { x: 40, y: 20 })).toEqual({ x: 40, y: 20, width: 60, height: 80 });
  });
});

describe('outlineToPath', () => {
  it('cierra el contorno con un camino válido', () => {
    const path = outlineToPath([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(path.startsWith('M 0,0')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(path).toContain('Q');
  });

  it('sin puntos no hay camino', () => {
    expect(outlineToPath([])).toBe('');
  });
});

describe('renderOf', () => {
  it('una línea se pinta como figura de dos extremos', () => {
    const stroke = { ...createStroke('line', '#000', 4), points: [0, 0, 0.5, 50, 25, 0.5] };
    const render = renderOf(stroke);
    expect(render.kind).toBe('shape');
    if (render.kind !== 'shape') throw new Error('se esperaba una figura');
    expect(render.shape).toBe('line');
    expect(render.from.x).toBe(0);
    expect(render.to.x).toBe(50);
  });

  it('el lápiz genera un camino cerrado con relleno', () => {
    const stroke = {
      ...createStroke('pen', '#000', 4),
      points: [0, 0, 0.5, 10, 10, 0.5, 20, 0, 0.5, 30, 12, 0.5],
    };
    const render = renderOf(stroke);
    expect(render.kind).toBe('freehand');
    if (render.kind !== 'freehand') throw new Error('se esperaba mano alzada');
    expect(render.path.length).toBeGreaterThan(10);
    expect(render.opacity).toBe(1);
  });

  it('el subrayador deja ver lo de abajo', () => {
    const stroke = { ...createStroke('highlighter', '#ff0', 8), points: [0, 0, 0.5, 20, 0, 0.5] };
    expect(renderOf(stroke).opacity).toBeCloseTo(0.4);
  });

  it('en modo simplificado no usa perfect-freehand', () => {
    const stroke = { ...createStroke('pen', '#000', 4), points: [0, 0, 0.5, 30, 10, 0.5, 60, 0, 0.5] };
    const render = renderOf(stroke, true);
    expect(render.kind).toBe('freehand');
    if (render.kind !== 'freehand') throw new Error('se esperaba mano alzada');
    expect(render.path.startsWith('M ')).toBe(true);
  });
});

describe('samplesToPoints', () => {
  it('usa la presión del lápiz cuando existe', () => {
    const points = samplesToPoints([
      { x: 1, y: 2, pressure: 0.8 },
      { x: 3, y: 4, pressure: 0 },
    ]);
    expect(points[0]?.pressure).toBe(0.8);
    // Un ratón (o un toque) reporta 0: se simula presión media.
    expect(points[1]?.pressure).toBe(0.5);
  });
});

describe('previewPath', () => {
  it('arma un trazo sin id fijo y con los puntos aplanados', () => {
    const stroke = previewPath([{ x: 5, y: 6, pressure: 0.4 }], 'pen', 4, '#123456');
    expect(stroke.tool).toBe('pen');
    expect(pointsOf(stroke)[0]?.x).toBe(5);
  });
});

describe('finishStroke', () => {
  it('simplifica los trazos largos de mano alzada', () => {
    const points: number[] = [];
    for (let index = 0; index < 60; index += 1) points.push(index, 0, 0.5);
    const stroke = { ...createStroke('pen', '#000', 4), points };
    const simplified = finishStroke(stroke);
    expect(pointsOf(simplified).length).toBeLessThan(pointsOf(stroke).length);
  });

  it('no toca las figuras', () => {
    const stroke = { ...createStroke('rect', '#000', 4), points: [0, 0, 0.5, 10, 10, 0.5] };
    expect(finishStroke(stroke)).toBe(stroke);
  });

  it('isShapeTool reconoce línea, rectángulo y elipse', () => {
    expect(isShapeTool('line')).toBe(true);
    expect(isShapeTool('rect')).toBe(true);
    expect(isShapeTool('ellipse')).toBe(true);
    expect(isShapeTool('pen')).toBe(false);
    expect(isShapeTool('eraser')).toBe(false);
  });
});

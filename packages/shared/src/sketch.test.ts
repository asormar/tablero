import { describe, expect, it } from 'vitest';

import {
  appendPoints,
  createStroke,
  effectiveSize,
  eraserRadius,
  eraseStrokes,
  flattenPoints,
  isDrawable,
  pointsOf,
  scaleStroke,
  segmentCircleRange,
  simplifyStroke,
  strokeBounds,
  strokeHitsCircle,
  strokeLength,
  strokeToPathD,
  strokesBounds,
  toolOpacity,
  translateStroke,
} from './sketch.js';
import type { SketchPoint } from './sketch.js';

const line = (points: [number, number][], size = 4) => {
  const stroke = createStroke('pen', 'gray', size);
  return appendPoints(stroke, points.map(([x, y]) => ({ x, y, pressure: 0.5 })));
};

const point = (x: number, y: number, pressure = 0.5): SketchPoint => ({ x, y, pressure });

describe('trazos', () => {
  it('crea un trazo vacío con la herramienta pedida', () => {
    const stroke = createStroke('marker', 'red', 8);
    expect(stroke).toMatchObject({ tool: 'marker', color: 'red', size: 8, points: [] });
    expect(stroke.id.length).toBeGreaterThan(4);
    expect(isDrawable(stroke)).toBe(false);
  });

  it('guarda y devuelve los puntos', () => {
    const stroke = appendPoints(createStroke(), [point(1.25, 2.5, 0.7), point(3, 4, 0.3)]);
    expect(stroke.points).toEqual([1.3, 2.5, 0.7, 3, 4, 0.3]);
    expect(pointsOf(stroke)).toEqual([
      { x: 1.3, y: 2.5, pressure: 0.7 },
      { x: 3, y: 4, pressure: 0.3 },
    ]);
    expect(flattenPoints(pointsOf(stroke))).toEqual(stroke.points);
  });

  it('un solo punto no se puede dibujar', () => {
    const stroke = appendPoints(createStroke(), [point(1, 1)]);
    expect(isDrawable(stroke)).toBe(false);
    expect(strokeToPathD(stroke)).toBe('M 1 1 l 0.01 0');
    expect(strokeToPathD(createStroke())).toBe('');
  });

  it('mide el largo', () => {
    expect(strokeLength(line([[0, 0], [3, 0], [3, 4]]))).toBeCloseTo(7);
  });
});

describe('cajas', () => {
  it('la caja del trazo incluye el grosor del pincel', () => {
    expect(strokeBounds(line([[10, 10], [30, 20]], 8))).toEqual({ x: 6, y: 6, width: 28, height: 18 });
    expect(strokeBounds(createStroke())).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('la caja de todos los trazos los contiene a todos', () => {
    const boxes = strokesBounds([line([[0, 0], [10, 0]], 2), line([[20, 20], [30, 30]], 2)]);
    expect(boxes).toEqual({ x: -1, y: -1, width: 32, height: 32 });
    expect(strokesBounds([])).toBeNull();
    expect(strokesBounds([createStroke()])).toBeNull();
  });
});

describe('transformaciones', () => {
  it('mueve el trazo', () => {
    const moved = translateStroke(line([[0, 0], [10, 0]]), 5, -3);
    expect(pointsOf(moved).map((p) => [p.x, p.y])).toEqual([[5, -3], [15, -3]]);
  });

  it('escala el trazo y su grosor', () => {
    const scaled = scaleStroke(line([[0, 0], [10, 0]], 4), 2);
    expect(pointsOf(scaled).map((p) => p.x)).toEqual([0, 20]);
    expect(scaled.size).toBe(8);
    const squeezed = scaleStroke(line([[0, 0], [10, 0]], 4), 1, 0.5);
    expect(squeezed.size).toBe(3);
    expect(pointsOf(squeezed).map((p) => p.y)).toEqual([0, 0]);
  });
});

describe('goma', () => {
  it('detecta el trazo por cualquier punto del segmento, no solo por los extremos', () => {
    const stroke = line([[0, 0], [100, 0]]);
    expect(strokeHitsCircle(stroke, { x: 50, y: 1 }, 4)).toBe(true);
    expect(strokeHitsCircle(stroke, { x: 50, y: 30 }, 4)).toBe(false);
    expect(strokeHitsCircle(stroke, { x: 50, y: 30 }, 40)).toBe(true);
  });

  it('recorta el trazo y deja los trozos de fuera', () => {
    const stroke = line([[0, 0], [10, 0], [20, 0], [30, 0], [40, 0], [50, 0]], 2);
    const result = eraseStrokes([stroke], { x: 25, y: 0 }, 6);
    expect(result).toHaveLength(2);
    // El corte es geométrico: el círculo tapa la x de 19 a 31.
    expect(pointsOf(result[0]!).map((p) => p.x)).toEqual([0, 10, 19]);
    expect(pointsOf(result[1]!).map((p) => p.x)).toEqual([31, 40, 50]);
    expect(result[0]!.id).not.toBe(result[1]!.id);
    expect(result[0]!.tool).toBe('pen');
  });

  it('calcula el tramo del segmento que cae dentro del círculo', () => {
    expect(segmentCircleRange({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 0 }, 6)).toEqual({ t0: 0.38, t1: 0.62 });
    expect(segmentCircleRange({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 0 }, 5)).toBeNull();
    expect(segmentCircleRange({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }, 5)).toEqual({ t0: 0, t1: 1 });
    expect(segmentCircleRange({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 0 }, 5)).toBeNull();
  });

  it('sin tocar nada devuelve el mismo trazo', () => {
    const stroke = line([[0, 0], [10, 0]]);
    expect(eraseStrokes([stroke], { x: 200, y: 200 }, 5)).toEqual([stroke]);
  });

  it('modo «whole» borra el trazo entero', () => {
    const strokes = [line([[0, 0], [10, 0]]), line([[100, 0], [110, 0]])];
    expect(eraseStrokes(strokes, { x: 5, y: 0 }, 8, 'whole')).toEqual([strokes[1]]);
    expect(eraseStrokes(strokes, { x: 5, y: 0 }, 8, 'whole')).toHaveLength(1);
  });

  it('la cola fuera de la goma se conserva y lo que queda suelto se descarta', () => {
    const result = eraseStrokes([line([[0, 0], [10, 0], [20, 0]], 2)], { x: 0, y: 0 }, 11);
    expect(result).toHaveLength(1);
    expect(pointsOf(result[0]!).map((p) => p.x)).toEqual([11, 20]);

    // Un trazo que queda entero dentro de la goma desaparece.
    expect(eraseStrokes([line([[0, 0], [5, 0]])], { x: 2, y: 0 }, 10)).toEqual([]);
  });

  it('el radio de la goma crece con el grosor', () => {
    expect(eraserRadius(2)).toBe(4);
    expect(eraserRadius(16)).toBe(24);
  });
});

describe('simplificación', () => {
  it('colapsa los puntos que siguen una recta', () => {
    const stroke = line([[0, 0], [5, 0], [10, 0], [15, 0], [20, 0]]);
    const simplified = simplifyStroke(stroke, 0.5);
    expect(pointsOf(simplified).map((p) => p.x)).toEqual([0, 20]);
  });

  it('conserva las esquinas', () => {
    const stroke = line([[0, 0], [10, 0], [10, 10]], 2);
    expect(pointsOf(simplifyStroke(stroke, 0.5)).map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it('conserva la presión de los puntos que quedan', () => {
    const stroke = appendPoints(createStroke(), [point(0, 0, 0.9), point(5, 0.1, 0.5), point(10, 0, 0.1)]);
    const simplified = pointsOf(simplifyStroke(stroke, 1));
    expect(simplified[0]!.pressure).toBe(0.9);
    expect(simplified.at(-1)!.pressure).toBe(0.1);
  });

  it('un trazo de dos puntos no se toca', () => {
    const stroke = line([[0, 0], [10, 10]]);
    expect(simplifyStroke(stroke)).toBe(stroke);
  });
});

describe('camino SVG', () => {
  it('recto con dos puntos', () => {
    expect(strokeToPathD(line([[0, 0], [10, 20]]))).toBe('M 0 0 L 10 20');
  });

  it('suavizado con más puntos, sin suavizar si se pide', () => {
    const stroke = line([[0, 0], [10, 10], [20, 0]]);
    expect(strokeToPathD(stroke)).toBe('M 0 0 Q 10 10 15 5 L 20 0');
    expect(strokeToPathD(stroke, false)).toBe('M 0 0 L 10 10 L 20 0');
  });
});

describe('herramientas', () => {
  it('cada herramienta tiene su grosor', () => {
    expect(effectiveSize('pen', 4)).toBe(3);
    expect(effectiveSize('marker', 4)).toBe(6);
    expect(effectiveSize('highlighter', 4)).toBe(12);
    expect(effectiveSize('line', 4)).toBe(4);
    expect(effectiveSize('pen', 0.5)).toBe(1);
  });

  it('el subrayador es semitransparente', () => {
    expect(toolOpacity('highlighter')).toBe(0.4);
    expect(toolOpacity('pen')).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';

import {
  centerOn,
  clampScale,
  DEFAULT_VIEWPORT,
  fitRect,
  formatZoom,
  isSimplified,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomAt,
  zoomBy,
  zoomToStep,
} from './viewport.js';

describe('clampScale', () => {
  it('limita al rango 10 %–400 %', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(9)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });
});

describe('conversión mundo ↔ pantalla', () => {
  const vp = { x: 100, y: 50, scale: 2 };

  it('lleva un punto de mundo a pantalla', () => {
    expect(worldToScreen(vp, { x: 150, y: 100 })).toEqual({ x: 100, y: 100 });
  });

  it('es reversible', () => {
    const roundTrip = screenToWorld(vp, worldToScreen(vp, { x: 1234.5, y: -678.25 }));
    expect(roundTrip.x).toBeCloseTo(1234.5);
    expect(roundTrip.y).toBeCloseTo(-678.25);
  });

  it('el rectángulo visible sale del viewport y del tamaño de pantalla', () => {
    expect(visibleWorldRect(vp, { width: 800, height: 600 })).toEqual({
      x: 100,
      y: 50,
      width: 400,
      height: 300,
    });
  });
});

describe('zoomAt', () => {
  it('mantiene fijo el punto de mundo bajo el cursor', () => {
    const vp = { x: 0, y: 0, scale: 1 };
    const anchor = { x: 400, y: 300 };
    const before = screenToWorld(vp, anchor);
    const zoomed = zoomAt(vp, anchor, 2);
    const after = screenToWorld(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomed.scale).toBe(2);
  });

  it('no se pasa de los límites', () => {
    expect(zoomAt(DEFAULT_VIEWPORT, { x: 0, y: 0 }, 100).scale).toBe(MAX_SCALE);
    expect(zoomBy(DEFAULT_VIEWPORT, { x: 0, y: 0 }, 0.001).scale).toBe(MIN_SCALE);
  });

  it('sube y baja por los escalones de zoom', () => {
    expect(zoomToStep({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 1).scale).toBe(1.25);
    expect(zoomToStep({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, -1).scale).toBe(0.75);
  });
});

describe('panBy', () => {
  it('desplaza el viewport en sentido contrario al arrastre', () => {
    const vp = panBy({ x: 0, y: 0, scale: 2 }, 100, 50);
    expect(vp.x).toBe(-50);
    expect(vp.y).toBe(-25);
  });
});

describe('fitRect', () => {
  it('encaja un contenido lejano con margen', () => {
    const content = { x: 1000, y: 1000, width: 800, height: 600 };
    const screen = { width: 1200, height: 800 };
    const vp = fitRect(content, screen, { padding: 64 });
    const visible = visibleWorldRect(vp, screen);
    expect(visible.x).toBeLessThanOrEqual(content.x);
    expect(visible.y).toBeLessThanOrEqual(content.y);
    expect(visible.x + visible.width).toBeGreaterThanOrEqual(content.x + content.width);
    expect(vp.scale).toBeLessThanOrEqual(1);
  });

  it('devuelve 100 % sin contenido', () => {
    expect(fitRect(null, { width: 800, height: 600 })).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('no amplía por encima de 100 % de forma predeterminada', () => {
    const vp = fitRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: 1000 });
    expect(vp.scale).toBe(1);
  });
});

describe('centerOn / modo simplificado / formato', () => {
  it('centra el contenido sin cambiar el zoom', () => {
    const vp = centerOn({ x: 0, y: 0, width: 100, height: 100 }, { width: 800, height: 600 }, 1);
    expect(vp.scale).toBe(1);
    expect(worldToScreen(vp, { x: 50, y: 50 })).toEqual({ x: 400, y: 300 });
  });

  it('activa el modo simplificado por debajo del 35 %', () => {
    expect(isSimplified({ x: 0, y: 0, scale: 0.3 })).toBe(true);
    expect(isSimplified({ x: 0, y: 0, scale: 0.5 })).toBe(false);
  });

  it('formatea el porcentaje', () => {
    expect(formatZoom(0.5)).toBe('50%');
    expect(formatZoom(1.234)).toBe('123%');
  });
});

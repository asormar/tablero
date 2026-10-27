/**
 * Pruebas de la curva cubic-bezier (cámara del lienzo).
 */

import { describe, expect, it } from 'vitest';

import { cubicBezier } from './cubicBezier';

describe('cubicBezier', () => {
  it('fija los extremos en 0 y 1', () => {
    const ease = cubicBezier(0.77, 0, 0.175, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-0.5)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it('con puntos de control alineados es lineal', () => {
    const linear = cubicBezier(0.25, 0.25, 0.75, 0.75);
    for (const x of [0.1, 0.4, 0.5, 0.9]) expect(linear(x)).toBeCloseTo(x, 4);
  });

  it('coincide con valores de referencia de CSS ease-in-out (0.42, 0, 0.58, 1)', () => {
    const ease = cubicBezier(0.42, 0, 0.58, 1);
    expect(ease(0.5)).toBeCloseTo(0.5, 4);
    expect(ease(0.25)).toBeCloseTo(0.1291, 3);
    expect(ease(0.75)).toBeCloseTo(0.8709, 3);
  });

  it('la curva de cámara (0.77, 0, 0.175, 1) arranca lenta, acelera y frena', () => {
    const ease = cubicBezier(0.77, 0, 0.175, 1);
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.5)).toBeGreaterThan(0.45);
    expect(ease(0.5)).toBeLessThan(0.75);
    expect(ease(0.9)).toBeGreaterThan(0.9);
  });

  it('es monótona y se queda dentro de [0, 1]', () => {
    const ease = cubicBezier(0.77, 0, 0.175, 1);
    let previous = 0;
    for (let step = 0; step <= 200; step += 1) {
      const value = ease(step / 200);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it('resuelve por bisección cuando la derivada es casi plana', () => {
    const ease = cubicBezier(0, 0, 1, 1);
    expect(ease(0.5)).toBeCloseTo(0.5, 3);
    expect(ease(0.001)).toBeGreaterThanOrEqual(0);
    expect(ease(0.999)).toBeLessThanOrEqual(1);
  });

  it('rechaza abscisas fuera de [0, 1]', () => {
    expect(() => cubicBezier(-0.1, 0, 0.5, 1)).toThrow(RangeError);
    expect(() => cubicBezier(0.5, 0, 1.2, 1)).toThrow(RangeError);
  });
});

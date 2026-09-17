/**
 * Pruebas de los gestos táctiles (fase 4, punto 8).
 */

import { describe, expect, it } from 'vitest';

import { canPinch, distanceBetween, midpointOf, pinchPair, pinchScaleFor } from './touchNav';

describe('distanceBetween', () => {
  it('calcula la distancia', () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('con un punto faltante devuelve 0', () => {
    expect(distanceBetween({ x: 0, y: 0 }, undefined)).toBe(0);
  });
});

describe('midpointOf', () => {
  it('devuelve el punto medio', () => {
    expect(midpointOf({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });
});

describe('pinchScaleFor', () => {
  it('los dedos que se separan acercan (factor > 1)', () => {
    expect(pinchScaleFor(100, 150)).toBeCloseTo(1.5, 5);
  });

  it('los dedos que se juntan alejan (factor < 1)', () => {
    expect(pinchScaleFor(100, 50)).toBeCloseTo(0.5, 5);
  });

  it('acota los extremos', () => {
    expect(pinchScaleFor(10, 1000)).toBe(4);
    expect(pinchScaleFor(1000, 10)).toBe(0.25);
  });

  it('con distancias inválidas no cambia el zoom', () => {
    expect(pinchScaleFor(0, 100)).toBe(1);
    expect(pinchScaleFor(100, 0)).toBe(1);
  });
});

describe('canPinch / pinchPair', () => {
  it('hacen falta dos dedos', () => {
    expect(canPinch([{ x: 0, y: 0 }])).toBe(false);
    expect(canPinch([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(true);
  });

  it('devuelve los dos primeros dedos', () => {
    const pair = pinchPair([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(pair).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(pinchPair([{ x: 0, y: 0 }])).toBeNull();
  });
});

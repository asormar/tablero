/**
 * Redimensión desde la esquina: el alto de una tarjeta de imagen sale del ancho
 * (y del aspecto de su recorte), así que la esquina mueve el ancho y el alto
 * sigue solo, sin deformar.
 */

import { describe, expect, it } from 'vitest';

import { appliedAspectResize, appliedWidthResize } from './dragMath';

const start = { x: 100, y: 200, width: 320, height: 240 };

describe('appliedAspectResize', () => {
  it('arrastrar en diagonal hacia fuera agranda la tarjeta', () => {
    const result = appliedAspectResize(start, 40, 30);
    expect(result.width).toBeGreaterThan(start.width);
    expect(result.x).toBe(start.x);
  });

  it('arrastrar hacia dentro la encoge', () => {
    const result = appliedAspectResize(start, -120, -40);
    expect(result.width).toBeLessThan(start.width);
  });

  it('no baja del ancho mínimo', () => {
    const result = appliedAspectResize(start, -900, -900);
    expect(result.width).toBe(80);
  });

  it('la esquina SW mueve el origen y conserva el borde derecho', () => {
    const result = appliedAspectResize(start, -80, 40, 'sw');
    expect(result.width).toBeGreaterThan(start.width);
    expect(result.x).toBe(start.x + (start.width - result.width));
    expect(result.x + result.width).toBe(start.x + start.width);
  });

  it('el desplazamiento vertical pesa según el aspecto', () => {
    // Cuanto más apaisada (mayor aspecto), más crece el ancho al bajar el puntero.
    const cuadrado = appliedAspectResize({ x: 0, y: 0, width: 200, height: 200 }, 0, 50);
    const panoramica = appliedAspectResize({ x: 0, y: 0, width: 400, height: 100 }, 0, 50);
    expect(panoramica.width - 400).toBeGreaterThan(cuadrado.width - 200);
  });

  it('convive con la redimensión lateral de la fase 1', () => {
    expect(appliedWidthResize({ x: 10, width: 200 }, 40, 'e')).toEqual({ x: 10, width: 240 });
  });
});

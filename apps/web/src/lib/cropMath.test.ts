/**
 * Recorte no destructivo: fracciones del original, guías de aspecto y el alto
 * que le corresponde a la tarjeta sin deformar la imagen.
 */

import { describe, expect, it } from 'vitest';

import { cropSourceRect } from '@tablero/shared';

import {
  applyAspect,
  clampRectToBox,
  centeredCrop,
  cropFromViewRect,
  cropViewRect,
  croppedHeight,
  isUsableCrop,
  rectFromDrag,
  resizeCropRect,
} from './cropMath';

const view = { width: 400, height: 200 };

describe('cropFromViewRect / cropViewRect', () => {
  it('la mitad derecha de la vista son fracciones del original', () => {
    const crop = cropFromViewRect({ x: 200, y: 0, width: 200, height: 200 }, view);
    expect(crop).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
  });

  it('vuelve a la vista sin perder nada (ida y vuelta)', () => {
    const crop = cropFromViewRect({ x: 40, y: 20, width: 200, height: 100 }, view);
    const back = cropViewRect(crop, view);
    expect(Math.round(back.x)).toBe(40);
    expect(Math.round(back.y)).toBe(20);
    expect(Math.round(back.width)).toBe(200);
    expect(Math.round(back.height)).toBe(100);
  });

  it('recorta a la caja: no se sale de la imagen', () => {
    const crop = cropFromViewRect({ x: -50, y: -20, width: 900, height: 400 }, view);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
    expect(crop.width).toBeLessThanOrEqual(1);
    expect(crop.height).toBeLessThanOrEqual(1);
  });
});

describe('rectFromDrag', () => {
  it('normaliza el arrastre en cualquier dirección', () => {
    const downRight = rectFromDrag({ x: 10, y: 10 }, { x: 110, y: 60 }, view);
    const upLeft = rectFromDrag({ x: 110, y: 60 }, { x: 10, y: 10 }, view);
    expect(downRight).toEqual(upLeft);
    expect(downRight).toEqual({ x: 10, y: 10, width: 100, height: 50 });
  });

  it('deja un tamaño mínimo aunque el arrastre sea un clic', () => {
    const rect = rectFromDrag({ x: 50, y: 50 }, { x: 50, y: 50 }, view);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });

  it('no se sale de la caja', () => {
    const rect = rectFromDrag({ x: 300, y: 100 }, { x: 900, y: 900 }, view);
    expect(rect.x + rect.width).toBeLessThanOrEqual(view.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(view.height);
  });
});

describe('resizeCropRect', () => {
  const start = { x: 100, y: 50, width: 100, height: 50 };

  it('la esquina SE agranda sin mover el origen', () => {
    const rect = resizeCropRect(start, 'se', { x: 300, y: 200 }, view, null);
    expect(rect.x).toBe(100);
    expect(rect.y).toBe(50);
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(150);
  });

  it('la esquina NW mueve el origen y deja fijo el borde opuesto', () => {
    const rect = resizeCropRect(start, 'nw', { x: 50, y: 20 }, view, null);
    expect(rect.x).toBe(50);
    expect(rect.y).toBe(20);
    expect(rect.x + rect.width).toBe(200);
    expect(rect.y + rect.height).toBe(100);
  });

  it('con aspecto 1:1 el recorte queda cuadrado', () => {
    const rect = resizeCropRect({ x: 0, y: 0, width: 100, height: 100 }, 'se', { x: 260, y: 120 }, view, 1);
    expect(rect.width).toBeCloseTo(rect.height, 0);
  });

  it('con aspecto 16:9 respeta la proporción al arrastrar la esquina', () => {
    const rect = resizeCropRect({ x: 0, y: 0, width: 160, height: 90 }, 'se', { x: 320, y: 91 }, view, 16 / 9);
    expect(rect.width / rect.height).toBeCloseTo(16 / 9, 1);
  });

  it('nunca deja un recorte degenerado con el aspecto activo', () => {
    const rect = resizeCropRect({ x: 10, y: 10, width: 100, height: 100 }, 'se', { x: 12, y: 12 }, view, 1);
    expect(isUsableCrop(cropFromViewRect(rect, view))).toBe(true);
  });
});

describe('applyAspect', () => {
  it('recorta el cuadrado más grande centrado para 1:1', () => {
    const rect = applyAspect({ x: 0, y: 0, width: 400, height: 200 }, 1, view);
    expect(rect.width).toBeCloseTo(200, 5);
    expect(rect.height).toBeCloseTo(200, 5);
    expect(rect.x).toBeCloseTo(100, 5);
  });

  it('sin aspecto (libre) no cambia el rectángulo', () => {
    const rect = { x: 3, y: 4, width: 50, height: 20 };
    expect(applyAspect(rect, null, view)).toEqual(rect);
  });
});

describe('clampRectToBox', () => {
  it('mete el rectángulo dentro de la caja sin cambiar su tamaño', () => {
    const rect = clampRectToBox({ x: 380, y: 190, width: 100, height: 40 }, view);
    expect(rect.width).toBe(100);
    expect(rect.x).toBe(300);
    expect(rect.y).toBe(160);
  });
});

describe('croppedHeight / centeredCrop', () => {
  it('el alto de la tarjeta sale del aspecto del recorte', () => {
    // Mitad superior de una imagen 4:3 (800×600): el recorte queda 800×300 y a
    // 320 px de ancho le corresponden 120 px de alto (no 240, que sería deformar).
    const crop = { x: 0, y: 0, width: 1, height: 0.5 };
    const width = 320;
    const height = croppedHeight(width, crop, { width: 800, height: 600 });
    expect(height).toBe(120);
  });

  it('el recorte centrado 1:1 de una imagen apaisada usa la altura', () => {
    const crop = centeredCrop(1, { width: 800, height: 600 });
    expect(crop.width).toBeCloseTo(0.75, 3);
    expect(crop.height).toBeCloseTo(1, 3);
    expect(crop.x).toBeCloseTo(0.125, 3);
    const source = cropSourceRect(crop, 800, 600);
    expect(source.width).toBe(source.height);
  });

  it('sin aspecto, el recorte es el original completo', () => {
    expect(centeredCrop(null, { width: 800, height: 600 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

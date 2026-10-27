/**
 * Pruebas de la coalescencia de la rueda (un solo cambio de viewport por frame).
 */

import { describe, expect, it } from 'vitest';

import { WHEEL_ZOOM_SENSITIVITY, classifyWheel, createWheelAccumulator } from './wheelAccumulator';

const base = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false };

describe('classifyWheel', () => {
  it('sin modificadores desplaza en los dos ejes con el signo invertido', () => {
    expect(classifyWheel({ ...base, deltaX: 10, deltaY: 30 })).toEqual({ kind: 'pan', dx: -10, dy: -30 });
  });

  it('con Shift y sin delta horizontal, el vertical desplaza en horizontal', () => {
    expect(classifyWheel({ ...base, deltaY: 40, shiftKey: true })).toEqual({ kind: 'pan', dx: -40, dy: 0 });
  });

  it('con Shift y delta horizontal real desplaza normal', () => {
    expect(classifyWheel({ ...base, deltaX: 5, deltaY: 40, shiftKey: true })).toEqual({ kind: 'pan', dx: -5, dy: -40 });
  });

  it('Ctrl y Cmd hacen zoom con la sensibilidad de siempre', () => {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const intent = classifyWheel({ ...base, deltaY: 100, ...modifier });
      expect(intent.kind).toBe('zoom');
      if (intent.kind === 'zoom') expect(intent.factor).toBeCloseTo(Math.exp(-100 * WHEEL_ZOOM_SENSITIVITY), 10);
    }
  });

  it('escala los deltas por líneas y por páginas', () => {
    expect(classifyWheel({ ...base, deltaY: 3, deltaMode: 1 })).toEqual({ kind: 'pan', dx: -0, dy: -48 });
    expect(classifyWheel({ ...base, deltaY: 2, deltaMode: 2 })).toEqual({ kind: 'pan', dx: -0, dy: -200 });
  });
});

describe('createWheelAccumulator', () => {
  it('suma los paneos pendientes y se vacía al tomarlos', () => {
    const acc = createWheelAccumulator();
    expect(acc.hasPending()).toBe(false);
    expect(acc.addPan(-10, -20)).toBeNull();
    expect(acc.addPan(-5, 4)).toBeNull();
    expect(acc.hasPending()).toBe(true);
    expect(acc.take()).toEqual({ panX: -15, panY: -16, zoomFactor: 1, anchor: null });
    expect(acc.hasPending()).toBe(false);
    expect(acc.take()).toBeNull();
  });

  it('multiplica los factores de zoom y se queda con el último ancla', () => {
    const acc = createWheelAccumulator();
    acc.addZoom(1.1, { x: 10, y: 10 });
    acc.addZoom(1.1, { x: 12, y: 14 });
    acc.addZoom(0.5, { x: 20, y: 30 });
    const batch = acc.take();
    expect(batch?.zoomFactor).toBeCloseTo(1.1 * 1.1 * 0.5, 10);
    expect(batch?.anchor).toEqual({ x: 20, y: 30 });
    expect(batch?.panX).toBe(0);
  });

  it('zoom por pasos equivale al factor acumulado (exp de la suma)', () => {
    const acc = createWheelAccumulator();
    const deltas = [20, -5, 40, 12];
    for (const delta of deltas) acc.addZoom(Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY), { x: 1, y: 1 });
    const total = deltas.reduce((sum, delta) => sum + delta, 0);
    expect(acc.take()?.zoomFactor).toBeCloseTo(Math.exp(-total * WHEEL_ZOOM_SENSITIVITY), 10);
  });

  it('al cambiar de paneo a zoom devuelve el lote anterior para aplicarlo ya', () => {
    const acc = createWheelAccumulator();
    acc.addPan(-8, -8);
    const flushed = acc.addZoom(1.2, { x: 5, y: 5 });
    expect(flushed).toEqual({ panX: -8, panY: -8, zoomFactor: 1, anchor: null });
    expect(acc.take()).toEqual({ panX: 0, panY: 0, zoomFactor: 1.2, anchor: { x: 5, y: 5 } });
  });

  it('al cambiar de zoom a paneo devuelve el zoom pendiente', () => {
    const acc = createWheelAccumulator();
    acc.addZoom(0.9, { x: 1, y: 2 });
    const flushed = acc.addPan(3, 4);
    expect(flushed).toEqual({ panX: 0, panY: 0, zoomFactor: 0.9, anchor: { x: 1, y: 2 } });
    expect(acc.take()).toEqual({ panX: 3, panY: 4, zoomFactor: 1, anchor: null });
  });
});

/**
 * Pruebas de los gestos táctiles (fase 4, punto 8).
 */

import { describe, expect, it } from 'vitest';

import { canPinch, createLongPress, distanceBetween, midpointOf, pinchPair, pinchScaleFor } from './touchNav';

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

describe('createLongPress', () => {
  /** Reloj manual: `advance` dispara los temporizadores vencidos. */
  function setup() {
    let now = 0;
    let nextId = 1;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const fired: Array<{ point: { x: number; y: number }; payload: string | null }> = [];
    const press = createLongPress<string | null>({
      setTimer: (callback, delayMs) => {
        const id = nextId++;
        timers.set(id, { at: now + delayMs, callback });
        return id;
      },
      clearTimer: (handle) => {
        timers.delete(handle as number);
      },
      onFire: (point, payload) => fired.push({ point, payload }),
    });
    return {
      press,
      fired,
      get timers(): number {
        return timers.size;
      },
      advance(ms: number): void {
        now += ms;
        for (const [id, timer] of [...timers]) {
          if (timer.at > now) continue;
          timers.delete(id);
          timer.callback();
        }
      },
    };
  }

  it('se cumple a los 500 ms con el dedo quieto', () => {
    const t = setup();
    t.press.arm(1, { x: 100, y: 200 }, 'card-1');
    expect(t.press.isPending()).toBe(true);
    t.advance(499);
    expect(t.fired).toHaveLength(0);
    t.advance(1);
    expect(t.fired).toEqual([{ point: { x: 100, y: 200 }, payload: 'card-1' }]);
    expect(t.press.isPending()).toBe(false);
  });

  it('tolera un temblor de hasta 8 px', () => {
    const t = setup();
    t.press.arm(1, { x: 0, y: 0 }, null);
    t.press.move(1, { x: 5, y: 6 }); // distancia 7,8
    t.advance(500);
    expect(t.fired).toHaveLength(1);
  });

  it('se cancela al moverse más de 8 px', () => {
    const t = setup();
    t.press.arm(1, { x: 0, y: 0 }, null);
    t.press.move(1, { x: 9, y: 0 });
    expect(t.press.isPending()).toBe(false);
    expect(t.timers).toBe(0);
    t.advance(1000);
    expect(t.fired).toHaveLength(0);
  });

  it('ignora el movimiento de otros punteros', () => {
    const t = setup();
    t.press.arm(1, { x: 0, y: 0 }, null);
    t.press.move(2, { x: 500, y: 500 });
    t.advance(500);
    expect(t.fired).toHaveLength(1);
  });

  it('se cancela al levantar el dedo antes de tiempo', () => {
    const t = setup();
    t.press.arm(1, { x: 0, y: 0 }, null);
    t.advance(300);
    t.press.touchUp(1);
    t.advance(1000);
    expect(t.fired).toHaveLength(0);
    expect(t.press.consumeClick()).toBe(false);
  });

  it('un segundo dedo (pinza) cancela la pulsación', () => {
    const t = setup();
    t.press.arm(1, { x: 0, y: 0 }, null);
    t.advance(200);
    t.press.touchDown(2);
    expect(t.press.isPending()).toBe(false);
    t.advance(1000);
    expect(t.fired).toHaveLength(0);
  });

  it('no arma si ya hay otro dedo apoyado', () => {
    const t = setup();
    t.press.touchDown(1);
    t.press.arm(2, { x: 0, y: 0 }, null);
    expect(t.press.isPending()).toBe(false);
    t.advance(1000);
    expect(t.fired).toHaveLength(0);
  });

  it('tras cumplirse, el clic siguiente se suprime una sola vez', () => {
    const t = setup();
    t.press.arm(1, { x: 0, y: 0 }, null);
    t.advance(500);
    expect(t.press.consumeClick()).toBe(true);
    expect(t.press.consumeClick()).toBe(false);
  });

  it('un gesto nuevo descarta la supresión que quedó sin consumir', () => {
    const t = setup();
    t.press.arm(1, { x: 0, y: 0 }, null);
    t.advance(500);
    t.press.touchUp(1);
    t.press.touchDown(3);
    expect(t.press.consumeClick()).toBe(false);
  });

  it('resetSuppression descarta la supresión (gesto con ratón)', () => {
    const t = setup();
    t.press.arm(1, { x: 0, y: 0 }, null);
    t.advance(500);
    t.press.resetSuppression();
    expect(t.press.consumeClick()).toBe(false);
  });

  it('volver a armar reinicia la cuenta atrás', () => {
    const t = setup();
    t.press.arm(1, { x: 0, y: 0 }, 'a');
    t.advance(300);
    t.press.touchUp(1);
    t.press.arm(1, { x: 10, y: 10 }, 'b');
    t.advance(300);
    expect(t.fired).toHaveLength(0);
    t.advance(200);
    expect(t.fired).toEqual([{ point: { x: 10, y: 10 }, payload: 'b' }]);
  });
});

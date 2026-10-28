/**
 * Pruebas de la transición de cámara: interpolación, cancelación y cierre.
 */

import { type Viewport, screenToWorld } from '@tablero/shared';
import { describe, expect, it } from 'vitest';

import {
  type TweenDeps,
  CAMERA_EASE,
  createViewportTweener,
  interpolateViewport,
  keyCancelsCameraTween,
  pointerTargetsCameraControl,
} from './viewportTween';

const linear = (progress: number): number => progress;

/** Reloj y `requestAnimationFrame` falsos: un viewport en memoria y frames manuales. */
function harness(options: { reduced?: boolean; ease?: (p: number) => number } = {}) {
  let viewport: Viewport = { x: 0, y: 0, scale: 1 };
  let nextHandle = 1;
  const callbacks = new Map<number, (timestamp: number) => void>();
  const activity: boolean[] = [];
  const writes: Viewport[] = [];
  const deps: TweenDeps = {
    read: () => viewport,
    write: (next) => {
      viewport = next;
      writes.push(next);
    },
    size: () => ({ width: 800, height: 600 }),
    raf: (callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    caf: (handle) => {
      callbacks.delete(handle);
    },
    reducedMotion: () => options.reduced === true,
    onActiveChange: (active) => activity.push(active),
  };
  const tweener = createViewportTweener(deps, options.ease ?? linear);
  return {
    tweener,
    activity,
    writes,
    get viewport(): Viewport {
      return viewport;
    },
    set viewport(next: Viewport) {
      viewport = next;
    },
    get pending(): number {
      return callbacks.size;
    },
    /** Ejecuta los frames pendientes con ese timestamp. */
    frame(timestamp: number): void {
      const due = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of due) callback(timestamp);
    },
  };
}

describe('interpolateViewport', () => {
  const from: Viewport = { x: 0, y: 0, scale: 1 };
  const to: Viewport = { x: 400, y: 200, scale: 4 };
  const anchor = { x: 400, y: 300 };

  it('devuelve los extremos exactos', () => {
    expect(interpolateViewport(from, to, 0, anchor)).toEqual(from);
    expect(interpolateViewport(from, to, 1, anchor)).toEqual(to);
  });

  it('interpola el zoom en espacio logarítmico', () => {
    expect(interpolateViewport(from, to, 0.5, anchor).scale).toBeCloseTo(2, 6);
    expect(interpolateViewport(from, { ...to, scale: 0.25 }, 0.5, anchor).scale).toBeCloseTo(0.5, 6);
  });

  it('mantiene fijo el punto de mundo del ancla en un zoom puro', () => {
    const base: Viewport = { x: 100, y: 50, scale: 1 };
    const point = { x: 250, y: 120 };
    const world = screenToWorld(base, point);
    const target: Viewport = {
      scale: 2,
      x: world.x - point.x / 2,
      y: world.y - point.y / 2,
    };
    for (const t of [0.1, 0.33, 0.5, 0.8]) {
      const step = interpolateViewport(base, target, t, point);
      const under = screenToWorld(step, point);
      expect(under.x).toBeCloseTo(world.x, 6);
      expect(under.y).toBeCloseTo(world.y, 6);
    }
  });

  it('con escalas inválidas salta al destino', () => {
    expect(interpolateViewport({ x: 0, y: 0, scale: 0 }, to, 0.5, anchor)).toEqual(to);
  });
});

describe('createViewportTweener', () => {
  const target: Viewport = { x: 100, y: 0, scale: 1 };

  it('avanza con el reloj y termina exactamente en el destino', () => {
    const h = harness();
    h.tweener.animateTo(target, { duration: 300 });
    expect(h.tweener.isActive()).toBe(true);
    expect(h.activity).toEqual([true]);

    h.frame(1000); // el primer frame fija el inicio: sin salto
    expect(h.viewport.x).toBe(0);
    h.frame(1150);
    expect(h.viewport.x).toBeCloseTo(50, 6);
    h.frame(1300);
    expect(h.viewport).toEqual(target);
    expect(h.tweener.isActive()).toBe(false);
    expect(h.activity).toEqual([true, false]);
    expect(h.pending).toBe(0);
  });

  it('aplica la curva de suavizado', () => {
    const h = harness({ ease: CAMERA_EASE });
    h.tweener.animateTo(target, { duration: 300 });
    h.frame(0);
    h.frame(30);
    expect(h.viewport.x).toBeLessThan(10); // arranque lento
    h.frame(270);
    expect(h.viewport.x).toBeGreaterThan(90); // frenada
  });

  it('cancel deja el viewport donde esté y libera el frame', () => {
    const h = harness();
    h.tweener.animateTo(target, { duration: 300 });
    h.frame(0);
    h.frame(150);
    const stopped = h.viewport;
    h.tweener.cancel();
    expect(h.tweener.isActive()).toBe(false);
    expect(h.pending).toBe(0);
    h.frame(400);
    expect(h.viewport).toBe(stopped);
    expect(h.activity).toEqual([true, false]);
  });

  it('una transición nueva parte del viewport interpolado actual', () => {
    const h = harness();
    h.tweener.animateTo(target, { duration: 300 });
    h.frame(0);
    h.frame(150);
    expect(h.viewport.x).toBeCloseTo(50, 6);

    h.tweener.animateTo({ x: 0, y: 0, scale: 1 }, { duration: 100 });
    // Sigue activa: no se anuncia otro inicio ni un fin intermedio.
    expect(h.activity).toEqual([true]);
    expect(h.pending).toBe(1);
    h.frame(200);
    expect(h.viewport.x).toBeCloseTo(50, 6);
    h.frame(250);
    expect(h.viewport.x).toBeCloseTo(25, 6);
    h.frame(300);
    expect(h.viewport.x).toBe(0);
    expect(h.activity).toEqual([true, false]);
  });

  it('una escritura ajena al viewport corta la transición', () => {
    const h = harness();
    h.tweener.animateTo(target, { duration: 300 });
    h.frame(0);
    h.frame(100);
    h.viewport = { x: 7, y: 7, scale: 1 }; // paneo o cambio de tablero
    h.frame(150);
    expect(h.tweener.isActive()).toBe(false);
    expect(h.viewport).toEqual({ x: 7, y: 7, scale: 1 });
  });

  it('con reduced-motion salta al destino sin animar', () => {
    const h = harness({ reduced: true });
    h.tweener.animateTo(target);
    expect(h.viewport).toEqual(target);
    expect(h.tweener.isActive()).toBe(false);
    expect(h.activity).toEqual([]);
    expect(h.pending).toBe(0);
  });

  it('con duración 0 salta al destino', () => {
    const h = harness();
    h.tweener.animateTo(target, { duration: 0 });
    expect(h.viewport).toEqual(target);
    expect(h.tweener.isActive()).toBe(false);
  });

  it('si ya está en el destino no hace nada', () => {
    const h = harness();
    h.tweener.animateTo({ x: 0, y: 0, scale: 1 });
    expect(h.tweener.isActive()).toBe(false);
    expect(h.writes).toHaveLength(0);
  });

  it('expone el destino pendiente solo mientras anima', () => {
    const h = harness();
    expect(h.tweener.target()).toBeNull();
    h.tweener.animateTo(target, { duration: 300 });
    expect(h.tweener.target()).toEqual(target);
    h.tweener.cancel();
    expect(h.tweener.target()).toBeNull();
  });

  it('el zoom con ancla respeta el punto fijado durante todo el recorrido', () => {
    const h = harness();
    const anchor = { x: 200, y: 150 };
    const world = screenToWorld(h.viewport, anchor);
    const zoomed: Viewport = { scale: 2, x: world.x - anchor.x / 2, y: world.y - anchor.y / 2 };
    h.tweener.animateTo(zoomed, { duration: 300, anchor });
    h.frame(0);
    for (const time of [60, 120, 180, 240]) {
      h.frame(time);
      const under = screenToWorld(h.viewport, anchor);
      expect(under.x).toBeCloseTo(world.x, 6);
      expect(under.y).toBeCloseTo(world.y, 6);
    }
    h.frame(300);
    expect(h.viewport).toEqual(zoomed);
  });
});

describe('keyCancelsCameraTween', () => {
  it('las flechas, el espacio y el avance de página cortan', () => {
    for (const key of ['ArrowLeft', 'ArrowDown', ' ', 'PageDown', 'Home']) {
      expect(keyCancelsCameraTween(key)).toBe(true);
    }
  });

  it('las teclas de zoom no cortan: se sustituyen por la nueva transición', () => {
    for (const key of ['+', '=', '-', '0', '!']) expect(keyCancelsCameraTween(key)).toBe(false);
  });

  it('el resto del teclado no corta', () => {
    expect(keyCancelsCameraTween('a')).toBe(false);
    expect(keyCancelsCameraTween('Shift')).toBe(false);
  });
});

describe('pointerTargetsCameraControl', () => {
  it('reconoce el control de la cámara y sus botones', () => {
    const target = { closest: (selector: string) => (selector === '[data-camera-control]' ? {} : null) };
    expect(pointerTargetsCameraControl(target)).toBe(true);
  });

  it('no exime el pointerdown del lienzo', () => {
    expect(pointerTargetsCameraControl({ closest: () => null })).toBe(false);
  });

  it('tolera destinos sin closest (window, document, null)', () => {
    expect(pointerTargetsCameraControl({})).toBe(false);
    expect(pointerTargetsCameraControl(null)).toBe(false);
  });
});

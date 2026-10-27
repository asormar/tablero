/**
 * Transición de cámara del lienzo.
 *
 * Los saltos de vista que no nacen de un gesto directo (botones de zoom, encajar
 * a pantalla, restablecer al 100 %, diapositivas de la presentación) animan el
 * viewport en lugar de teletransportarlo. La animación corre con
 * `requestAnimationFrame`, es cancelable y nunca se aplica a la rueda ni a la
 * pinza: esas siguen siendo directas.
 *
 * - Posición y zoom se interpolan alrededor de un punto de referencia de la
 *   pantalla (por defecto el centro): el punto de mundo que hay bajo él se mueve
 *   en línea recta y el zoom se interpola en espacio logarítmico, de modo que
 *   duplicar el zoom cuesta lo mismo que reducirlo a la mitad.
 * - Cualquier escritura ajena al viewport (rueda, paneo, `setViewport`, cambio de
 *   tablero) o una entrada del usuario cancelan la transición en el acto.
 * - Con `prefers-reduced-motion: reduce` el salto es instantáneo.
 *
 * Mientras dura la transición el nodo del mundo lleva `data-interaction="camera"`
 * (la hoja de estilos lo usa para `will-change`).
 */

import { type Point, type Size, type Viewport, screenToWorld } from '@tablero/shared';

import { type EasingFn, cubicBezier } from '@/lib/cubicBezier';
import { useUiStore } from '@/state/uiStore';

import { canvasRoot } from './canvasRef';

export const CAMERA_TWEEN_MS = 300;
export const SLIDE_TWEEN_MS = 350;
/** Atributo que marca el nodo del mundo mientras la cámara se anima. */
export const CAMERA_INTERACTION_ATTRIBUTE = 'data-interaction';
export const CAMERA_INTERACTION_VALUE = 'camera';

/** `cubic-bezier(0.77, 0, 0.175, 1)`: arranque contenido y frenada larga. */
export const CAMERA_EASE: EasingFn = cubicBezier(0.77, 0, 0.175, 1);

export type TweenOptions = {
  /** Duración en milisegundos (por defecto 300). `0` salta directamente. */
  duration?: number;
  /** Punto de pantalla que se mantiene como referencia (por defecto, el centro). */
  anchor?: Point;
};

export type TweenDeps = {
  read(): Viewport;
  write(viewport: Viewport): void;
  size(): Size;
  raf(callback: (timestamp: number) => void): number;
  caf(handle: number): void;
  reducedMotion(): boolean;
  /** Avisa al empezar y al terminar (o cancelarse) la transición. */
  onActiveChange?(active: boolean): void;
};

export type Tweener = {
  animateTo(target: Viewport, options?: TweenOptions): void;
  cancel(): void;
  isActive(): boolean;
  /** Destino de la transición en curso (o `null` si no hay ninguna). */
  target(): Viewport | null;
};

function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale;
}

/**
 * Viewport intermedio para un progreso `t` ya suavizado (0..1) alrededor de
 * `anchor`. Con `t` en los extremos devuelve exactamente el origen o el destino.
 */
export function interpolateViewport(from: Viewport, to: Viewport, t: number, anchor: Point): Viewport {
  if (!(from.scale > 0) || !(to.scale > 0)) return to;
  if (t <= 0) return from;
  if (t >= 1) return to;
  const scale = from.scale * Math.pow(to.scale / from.scale, t);
  const start = screenToWorld(from, anchor);
  const end = screenToWorld(to, anchor);
  const worldX = start.x + (end.x - start.x) * t;
  const worldY = start.y + (end.y - start.y) * t;
  return { scale, x: worldX - anchor.x / scale, y: worldY - anchor.y / scale };
}

type Run = {
  from: Viewport;
  to: Viewport;
  /** Último viewport escrito por esta transición (para detectar escrituras ajenas). */
  last: Viewport;
  start: number | null;
  duration: number;
  anchor: Point;
  handle: number;
};

export function createViewportTweener(deps: TweenDeps, ease: EasingFn = CAMERA_EASE): Tweener {
  let run: Run | null = null;

  const stop = (): void => {
    if (!run) return;
    deps.caf(run.handle);
    run = null;
    deps.onActiveChange?.(false);
  };

  const frame = (timestamp: number): void => {
    const current = run;
    if (!current) return;
    // Otra escritura tocó el viewport (rueda, paneo, cambio de tablero): gana ella.
    if (!sameViewport(deps.read(), current.last)) {
      stop();
      return;
    }
    if (current.start === null) current.start = timestamp;
    const progress = Math.min(1, Math.max(0, (timestamp - current.start) / current.duration));
    const next = progress >= 1 ? current.to : interpolateViewport(current.from, current.to, ease(progress), current.anchor);
    current.last = next;
    deps.write(next);
    if (run !== current) return;
    if (progress >= 1) {
      stop();
      return;
    }
    current.handle = deps.raf(frame);
  };

  return {
    animateTo(target, options = {}) {
      const from = deps.read();
      const duration = options.duration ?? CAMERA_TWEEN_MS;
      if (sameViewport(from, target)) {
        stop();
        return;
      }
      if (duration <= 0 || deps.reducedMotion()) {
        stop();
        deps.write(target);
        return;
      }
      const wasActive = run !== null;
      if (run) deps.caf(run.handle);
      const size = deps.size();
      const next: Run = {
        from,
        to: target,
        last: from,
        start: null,
        duration,
        anchor: options.anchor ?? { x: size.width / 2, y: size.height / 2 },
        handle: 0,
      };
      run = next;
      if (!wasActive) deps.onActiveChange?.(true);
      next.handle = deps.raf(frame);
    },
    cancel: stop,
    isActive: () => run !== null,
    target: () => run?.to ?? null,
  };
}

// --- Entradas del usuario que cortan la transición ---------------------------

/** Teclas que ya desplazan o encuadran la vista: la transición las deja pasar. */
const ZOOM_KEYS = new Set(['+', '=', '-', '_', '0', '1', '!']);
const NAVIGATION_KEYS = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End']);

/**
 * ¿Esta tecla corta la transición? Las flechas, el espacio (paneo) y el avance
 * de página sí; las de zoom no, porque lanzan una transición nueva que la
 * sustituye partiendo del destino pendiente.
 */
export function keyCancelsCameraTween(key: string): boolean {
  if (ZOOM_KEYS.has(key)) return false;
  return key.startsWith('Arrow') || NAVIGATION_KEYS.has(key);
}

function bindInputCancel(cancel: () => void): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (keyCancelsCameraTween(event.key)) cancel();
  };
  const onInput = (): void => cancel();
  const options = { capture: true, passive: true } as const;
  window.addEventListener('wheel', onInput, options);
  window.addEventListener('pointerdown', onInput, options);
  window.addEventListener('touchstart', onInput, options);
  window.addEventListener('keydown', onKey, true);
  return () => {
    window.removeEventListener('wheel', onInput, options);
    window.removeEventListener('pointerdown', onInput, options);
    window.removeEventListener('touchstart', onInput, options);
    window.removeEventListener('keydown', onKey, true);
  };
}

// --- Instancia del lienzo ----------------------------------------------------

let shared: Tweener | null = null;
let unbindInput: (() => void) | null = null;

function worldNode(): Element | null {
  return canvasRoot()?.querySelector('.canvas__world') ?? null;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function sharedTweener(): Tweener {
  if (shared) return shared;
  const tweener: Tweener = createViewportTweener({
    read: () => useUiStore.getState().viewport,
    write: (viewport) => useUiStore.getState().setViewport(viewport),
    size: () => useUiStore.getState().canvasSize,
    raf: (callback) => window.requestAnimationFrame(callback),
    caf: (handle) => window.cancelAnimationFrame(handle),
    reducedMotion: prefersReducedMotion,
    onActiveChange: (active) => {
      const node = worldNode();
      if (active) {
        node?.setAttribute(CAMERA_INTERACTION_ATTRIBUTE, CAMERA_INTERACTION_VALUE);
        unbindInput?.();
        unbindInput = bindInputCancel(() => tweener.cancel());
        return;
      }
      // El nodo puede haber cambiado desde que empezó (otro tablero): se limpia
      // en el que esté montado ahora.
      node?.removeAttribute(CAMERA_INTERACTION_ATTRIBUTE);
      unbindInput?.();
      unbindInput = null;
    },
  });
  shared = tweener;
  return tweener;
}

/** Anima la cámara hasta `target` (cancela cualquier transición anterior). */
export function animateViewportTo(target: Viewport, options?: TweenOptions): void {
  sharedTweener().animateTo(target, options);
}

/** Detiene la transición en curso dejando el viewport donde esté. */
export function cancelViewportTween(): void {
  shared?.cancel();
}

export function isViewportTweening(): boolean {
  return shared?.isActive() ?? false;
}

/** Destino de la transición en curso, o el viewport actual si no hay ninguna. */
export function pendingViewport(): Viewport {
  return shared?.target() ?? useUiStore.getState().viewport;
}

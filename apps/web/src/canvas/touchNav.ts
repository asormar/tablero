/**
 * Gestos táctiles del lienzo (fase 4, punto 8: «gestos para navegar el lienzo»).
 *
 * Un dedo arrastra el lienzo (paneo) y dos dedos hacen pinza (zoom). La
 * aritmética vive acá para poder probarla sin navegador: el componente solo
 * conecta los eventos de puntero.
 */

import type { Point } from '@tablero/shared';

/** Distancia entre dos puntos (0 si falta alguno). */
export function distanceBetween(a: Point | undefined, b: Point | undefined): number {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Punto medio entre dos puntos. */
export function midpointOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Factor de zoom de una pinza: cuánto cambió la distancia entre los dedos.
 * Se acota a un rango razonable para que un salto de un dedo mal leído no
 * dispare el zoom a los extremos.
 */
export function pinchScaleFor(previousDistance: number, nextDistance: number, min = 0.25, max = 4): number {
  if (previousDistance <= 0 || nextDistance <= 0) return 1;
  const ratio = nextDistance / previousDistance;
  if (!Number.isFinite(ratio)) return 1;
  return Math.min(max, Math.max(min, ratio));
}

/** ¿El gesto tiene los dos dedos necesarios para la pinza? */
export function canPinch(points: readonly Point[]): boolean {
  return points.length >= 2;
}

/** Los dos primeros puntos activos (los que usa la pinza). */
export function pinchPair(points: readonly Point[]): [Point, Point] | null {
  if (points.length < 2) return null;
  const first = points[0];
  const second = points[1];
  if (!first || !second) return null;
  return [first, second];
}

// --- Pulsación larga ---------------------------------------------------------

/** Tiempo que hay que mantener el dedo quieto para abrir el menú contextual. */
export const LONG_PRESS_MS = 500;
/** Lo máximo que puede moverse el dedo (px de pantalla) sin cancelar la pulsación. */
export const LONG_PRESS_SLOP = 8;

export type LongPressDeps<T> = {
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
  /** La pulsación se cumplió: `point` es donde empezó y `payload` lo que se armó con ella. */
  onFire(point: Point, payload: T): void;
  delayMs?: number;
  slop?: number;
};

export type LongPress<T> = {
  /** Un dedo toca la pantalla. Con un segundo dedo (pinza) cancela la pulsación. */
  touchDown(pointerId: number): void;
  /** Arma la cuenta atrás para este dedo (solo si es el único apoyado). */
  arm(pointerId: number, point: Point, payload: T): void;
  /** Movimiento del dedo: pasar de `slop` cancela. */
  move(pointerId: number, point: Point): void;
  /** El dedo se levanta (o el navegador cancela el gesto). */
  touchUp(pointerId: number): void;
  cancel(): void;
  /** ¿Hay una cuenta atrás en marcha? */
  isPending(): boolean;
  /** `true` una sola vez tras cumplirse la pulsación: hay que tragarse el clic que sigue. */
  consumeClick(): boolean;
  /** Descarta la supresión pendiente (empieza un gesto que no es táctil). */
  resetSuppression(): void;
};

/**
 * Máquina de estados de la pulsación larga táctil: el reloj entra por
 * `setTimer`/`clearTimer` para poder probarla sin navegador.
 *
 * Se cumple tras `delayMs` con el dedo dentro de `slop`; se cancela al moverse
 * más, al levantar o cancelar el puntero y cuando aparece un segundo dedo. Al
 * cumplirse deja pendiente la supresión del clic que el navegador sintetiza al
 * soltar.
 */
export function createLongPress<T>(deps: LongPressDeps<T>): LongPress<T> {
  const delay = deps.delayMs ?? LONG_PRESS_MS;
  const slop = deps.slop ?? LONG_PRESS_SLOP;
  const down = new Set<number>();
  let pending: { id: number; origin: Point; payload: T; timer: unknown } | null = null;
  let suppressClick = false;

  const cancel = (): void => {
    if (!pending) return;
    deps.clearTimer(pending.timer);
    pending = null;
  };

  const touchDown = (pointerId: number): void => {
    if (down.size === 0) suppressClick = false;
    down.add(pointerId);
    if (down.size >= 2) cancel();
  };

  return {
    touchDown,
    arm(pointerId, point, payload) {
      touchDown(pointerId);
      if (down.size !== 1) return;
      cancel();
      const press = { id: pointerId, origin: point, payload, timer: undefined as unknown };
      press.timer = deps.setTimer(() => {
        if (pending !== press) return;
        pending = null;
        suppressClick = true;
        deps.onFire(press.origin, press.payload);
      }, delay);
      pending = press;
    },
    move(pointerId, point) {
      if (!pending || pending.id !== pointerId) return;
      if (distanceBetween(pending.origin, point) > slop) cancel();
    },
    touchUp(pointerId) {
      down.delete(pointerId);
      if (pending?.id === pointerId) cancel();
    },
    cancel,
    isPending: () => pending !== null,
    consumeClick() {
      if (!suppressClick) return false;
      suppressClick = false;
      return true;
    },
    resetSuppression() {
      suppressClick = false;
    },
  };
}

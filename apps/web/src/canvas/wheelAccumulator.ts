/**
 * Coalescencia de la rueda del lienzo.
 *
 * Un ratón de alta frecuencia o un trackpad emiten varios `wheel` por frame; cada
 * uno escribía en el store y re-renderizaba el lienzo. Aquí se acumulan los
 * deltas (paneo en píxeles de pantalla, zoom como factor multiplicativo con el
 * último punto de anclaje) y el componente los aplica una vez por frame.
 *
 * La semántica por evento es la de siempre y vive en `classifyWheel`: con
 * Ctrl/Cmd hay zoom centrado en el cursor, con Shift y sin delta horizontal el
 * delta vertical desplaza en horizontal, y en el resto se desplaza en ambos ejes.
 */

import type { Point } from '@tablero/shared';

/** Sensibilidad del zoom con la rueda (igual que antes de coalescer). */
export const WHEEL_ZOOM_SENSITIVITY = 0.002;

export type WheelLike = {
  deltaX: number;
  deltaY: number;
  /** 0 = píxeles, 1 = líneas, 2 = páginas. */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export type WheelIntent =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dx: number; dy: number };

/** Traduce un evento de rueda a su intención: zoom (factor) o paneo (píxeles de pantalla). */
export function classifyWheel(event: WheelLike): WheelIntent {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
  const dy = event.deltaY * unit;
  const dx = event.deltaX * unit;
  if (event.ctrlKey || event.metaKey) return { kind: 'zoom', factor: Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY) };
  if (event.shiftKey && dx === 0) return { kind: 'pan', dx: -dy, dy: 0 };
  return { kind: 'pan', dx: -dx, dy: -dy };
}

/** Lo acumulado desde el último vaciado. Solo uno de los dos efectos es distinto del neutro. */
export type WheelBatch = {
  /** Paneo en píxeles de pantalla (el argumento de `pan`). */
  panX: number;
  panY: number;
  /** Producto de los factores de zoom (1 = sin zoom). */
  zoomFactor: number;
  /** Último punto de anclaje del zoom, relativo al lienzo. */
  anchor: Point | null;
};

export type WheelAccumulator = {
  /**
   * Suma un paneo. Si lo pendiente era zoom, devuelve ese lote para aplicarlo ya
   * (así el orden entre paneo y zoom se conserva).
   */
  addPan(dx: number, dy: number): WheelBatch | null;
  /** Suma un zoom; si lo pendiente era paneo, devuelve ese lote para aplicarlo ya. */
  addZoom(factor: number, anchor: Point): WheelBatch | null;
  /** Vacía lo acumulado (o `null` si no había nada). */
  take(): WheelBatch | null;
  hasPending(): boolean;
};

export function createWheelAccumulator(): WheelAccumulator {
  let kind: 'pan' | 'zoom' | null = null;
  let panX = 0;
  let panY = 0;
  let zoomFactor = 1;
  let anchor: Point | null = null;

  const take = (): WheelBatch | null => {
    if (kind === null) return null;
    const batch: WheelBatch = { panX, panY, zoomFactor, anchor };
    kind = null;
    panX = 0;
    panY = 0;
    zoomFactor = 1;
    anchor = null;
    return batch;
  };

  return {
    addPan(dx, dy) {
      const flushed = kind === 'zoom' ? take() : null;
      kind = 'pan';
      panX += dx;
      panY += dy;
      return flushed;
    },
    addZoom(factor, point) {
      const flushed = kind === 'pan' ? take() : null;
      kind = 'zoom';
      zoomFactor *= factor;
      anchor = point;
      return flushed;
    },
    take,
    hasPending: () => kind !== null,
  };
}

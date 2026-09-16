/**
 * Viewport del lienzo infinito: conversión mundo ↔ pantalla, zoom centrado en
 * el cursor y encaje a pantalla.
 */

import type { Point, Rect, Size } from './geometry.js';

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
/** Por debajo de este zoom las tarjetas se renderizan en modo simplificado. */
export const SIMPLIFIED_SCALE = 0.35;
export const ZOOM_STEPS = [0.1, 0.25, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** `x`/`y` son las coordenadas de mundo que quedan en la esquina superior izquierda. */
export type Viewport = { x: number; y: number; scale: number };

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function worldToScreen(vp: Viewport, p: Point): Point {
  return { x: (p.x - vp.x) * vp.scale, y: (p.y - vp.y) * vp.scale };
}

export function screenToWorld(vp: Viewport, p: Point): Point {
  return { x: vp.x + p.x / vp.scale, y: vp.y + p.y / vp.scale };
}

/** Rectángulo de mundo visible en pantalla. */
export function visibleWorldRect(vp: Viewport, screen: Size): Rect {
  return { x: vp.x, y: vp.y, width: screen.width / vp.scale, height: screen.height / vp.scale };
}

export function isSimplified(vp: Viewport): boolean {
  return vp.scale < SIMPLIFIED_SCALE;
}

/** Zoom manteniendo fijo el punto de mundo que está bajo `anchor` (pantalla). */
export function zoomAt(vp: Viewport, anchor: Point, nextScale: number): Viewport {
  const scale = clampScale(nextScale);
  const world = screenToWorld(vp, anchor);
  return {
    scale,
    x: world.x - anchor.x / scale,
    y: world.y - anchor.y / scale,
  };
}

export function zoomBy(vp: Viewport, anchor: Point, factor: number): Viewport {
  return zoomAt(vp, anchor, vp.scale * factor);
}

export function zoomToStep(vp: Viewport, anchor: Point, direction: 1 | -1): Viewport {
  const current = vp.scale;
  if (direction > 0) {
    const next = ZOOM_STEPS.find((s) => s > current + 0.001);
    return zoomAt(vp, anchor, next ?? MAX_SCALE);
  }
  const previous = [...ZOOM_STEPS].reverse().find((s) => s < current - 0.001);
  return zoomAt(vp, anchor, previous ?? MIN_SCALE);
}

export function panBy(vp: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { ...vp, x: vp.x - dxScreen / vp.scale, y: vp.y - dyScreen / vp.scale };
}

export function panByWorld(vp: Viewport, dxWorld: number, dyWorld: number): Viewport {
  return { ...vp, x: vp.x + dxWorld, y: vp.y + dyWorld };
}

export type FitOptions = { padding?: number; animate?: boolean; maxScale?: number };

/** Encaje de un rectángulo de mundo dentro de la pantalla. */
export function fitRect(
  content: Rect | null,
  screen: Size,
  options: FitOptions = {},
): Viewport {
  const padding = options.padding ?? 64;
  if (!content || content.width <= 0 || content.height <= 0) {
    return { x: 0, y: 0, scale: 1 };
  }
  const availableWidth = Math.max(1, screen.width - padding * 2);
  const availableHeight = Math.max(1, screen.height - padding * 2);
  const scale = clampScale(
    Math.min(availableWidth / content.width, availableHeight / content.height, options.maxScale ?? 1),
  );
  return {
    scale,
    x: content.x + content.width / 2 - screen.width / 2 / scale,
    y: content.y + content.height / 2 - screen.height / 2 / scale,
  };
}

/** Centra un rectángulo de mundo sin cambiar el zoom. */
export function centerOn(content: Rect, screen: Size, scale: number, maxScale = MAX_SCALE): Viewport {
  const s = clampScale(scale);
  return {
    scale: s,
    x: content.x + content.width / 2 - screen.width / 2 / s,
    y: content.y + content.height / 2 - screen.height / 2 / s,
  };
}

/** Formatea el porcentaje de zoom para el control de la esquina. */
export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

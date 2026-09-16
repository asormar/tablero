/**
 * Navegación del visor a pantalla completa: qué imágenes se recorren, en qué
 * orden y con qué pasos de zoom.
 *
 * Puro a propósito: la lógica de "siguiente/anterior" es la que se prueba.
 */

import type { ElementType } from '@tablero/shared';

export type ViewerCandidate = { id: string; type: ElementType };

/** Zonas de zoom del visor (multiplicadores). */
export const VIEWER_ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

export const VIEWER_MIN_ZOOM = 0.1;
export const VIEWER_MAX_ZOOM = 8;

/** Ids de las imágenes del tablero, en el mismo orden que el apilado del lienzo. */
export function viewerSequence(items: readonly ViewerCandidate[], type: ElementType = 'image'): string[] {
  return items.filter((item) => item.type === type).map((item) => item.id);
}

/** Índice de `currentId` dentro de la secuencia (-1 si ya no está). */
export function viewerIndex(ids: readonly string[], currentId: string): number {
  return ids.indexOf(currentId);
}

/**
 * Id vecino en la dirección pedida. La navegación da la vuelta: después de la
 * última imagen se vuelve a la primera, que es lo que espera quien está viendo
 * un tablero como un pase de diapositivas.
 */
export function stepViewer(ids: readonly string[], currentId: string, direction: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const index = viewerIndex(ids, currentId);
  if (index < 0) return ids[0] ?? null;
  const next = (index + direction + ids.length) % ids.length;
  return ids[next] ?? null;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.max(VIEWER_MIN_ZOOM, Math.min(VIEWER_MAX_ZOOM, zoom));
}

/** Siguiente paso de zoom por encima o por debajo del actual. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const steps = VIEWER_ZOOM_STEPS as readonly number[];
  if (direction === 1) {
    for (const step of steps) if (step > zoom + 0.001) return step;
    return clampZoom(zoom * 1.5);
  }
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step !== undefined && step < zoom - 0.001) return step;
  }
  return clampZoom(zoom / 1.5);
}

/** Zoom que hace entrar la imagen completa en la caja disponible. */
export function fitZoom(natural: { width: number; height: number }, box: { width: number; height: number }): number {
  if (natural.width <= 0 || natural.height <= 0) return 1;
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  return clampZoom(Math.min(1, scale));
}

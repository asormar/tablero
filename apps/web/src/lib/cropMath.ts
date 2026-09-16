/**
 * Recorte no destructivo: conversión entre píxeles de pantalla y las fracciones
 * (`ImageCrop`) que se guardan en el elemento.
 *
 * El original nunca se toca: el editor trabaja sobre una caja de vista y guarda
 * fracciones 0..1 del original. Todo lo de aquí es puro para poder probarlo.
 */

import { type ImageCrop, type Rect, type Size, clampCrop, cropSourceRect, FULL_CROP } from '@tablero/shared';

export type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

/** Aspectos ofrecidos en las guías del editor (null = libre). */
export const CROP_ASPECTS: { label: string; value: number | null }[] = [
  { label: 'Libre', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

const MIN_SIZE = 8;

/** Rectángulo de vista (píxeles mostrados) que corresponde a un recorte. */
export function cropViewRect(crop: ImageCrop, view: Size): Rect {
  return {
    x: crop.x * view.width,
    y: crop.y * view.height,
    width: crop.width * view.width,
    height: crop.height * view.height,
  };
}

/** Lleva un rectángulo de vista a fracciones del original (recortado a la caja). */
export function cropFromViewRect(rect: Rect, view: Size): ImageCrop {
  if (view.width <= 0 || view.height <= 0) return { ...FULL_CROP };
  return clampCrop({
    x: rect.x / view.width,
    y: rect.y / view.height,
    width: rect.width / view.width,
    height: rect.height / view.height,
  });
}

type Box = { width: number; height: number };

/** Ajusta un rectángulo al aspecto pedido conservando su centro. */
export function applyAspect(rect: Rect, aspect: number | null, box: Box): Rect {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return rect;
  let width = rect.width;
  let height = width / aspect;
  if (height > box.height) {
    height = box.height;
    width = height * aspect;
  }
  if (width > box.width) {
    width = box.width;
    height = width / aspect;
  }
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width: Math.max(MIN_SIZE, width),
    height: Math.max(MIN_SIZE, height),
  };
}

/** Mete el rectángulo dentro de la caja sin cambiar su tamaño. */
export function clampRectToBox(rect: Rect, box: Box): Rect {
  const width = Math.min(rect.width, box.width);
  const height = Math.min(rect.height, box.height);
  return {
    x: Math.max(0, Math.min(rect.x, box.width - width)),
    y: Math.max(0, Math.min(rect.y, box.height - height)),
    width,
    height,
  };
}

/** Rectángulo a partir de dos puntos (arrastre para crear el recorte). */
export function rectFromDrag(start: { x: number; y: number }, end: { x: number; y: number }, box: Box): Rect {
  const x = Math.max(0, Math.min(start.x, end.x));
  const y = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(box.width, Math.max(start.x, end.x));
  const bottom = Math.min(box.height, Math.max(start.y, end.y));
  return clampRectToBox(
    { x, y, width: Math.max(MIN_SIZE, right - x), height: Math.max(MIN_SIZE, bottom - y) },
    box,
  );
}

/**
 * Arrastre de un tirador del recorte. El tirador opuesto queda fijo; con
 * `aspect` el rectángulo mantiene la proporción (el alto lo manda el ancho).
 */
export function resizeCropRect(
  rect: Rect,
  handle: CropHandle,
  pointer: { x: number; y: number },
  box: Box,
  aspect: number | null,
): Rect {
  if (handle === 'move') {
    return clampRectToBox({ ...rect, x: pointer.x - rect.width / 2, y: pointer.y - rect.height / 2 }, box);
  }

  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  let nextLeft = left;
  let nextTop = top;
  let nextRight = right;
  let nextBottom = bottom;

  if (handle === 'nw' || handle === 'sw') nextLeft = Math.min(pointer.x, right - MIN_SIZE);
  if (handle === 'ne' || handle === 'se') nextRight = Math.max(pointer.x, left + MIN_SIZE);
  if (handle === 'nw' || handle === 'ne') nextTop = Math.min(pointer.y, bottom - MIN_SIZE);
  if (handle === 'sw' || handle === 'se') nextBottom = Math.max(pointer.y, top + MIN_SIZE);

  let result: Rect = {
    x: nextLeft,
    y: nextTop,
    width: Math.max(MIN_SIZE, nextRight - nextLeft),
    height: Math.max(MIN_SIZE, nextBottom - nextTop),
  };

  if (aspect && Number.isFinite(aspect) && aspect > 0) {
    if (handle === 'nw' || handle === 'ne') {
      // El tirador es de la mitad superior: el alto manda y el ancho lo sigue.
      const height = result.height;
      const width = height * aspect;
      result = {
        ...result,
        x: handle === 'nw' ? right - width : left,
        width: Math.max(MIN_SIZE, width),
      };
    } else {
      // Tirador inferior: el ancho manda.
      const width = result.width;
      const height = width / aspect;
      result = {
        ...result,
        y: bottom - height,
        height: Math.max(MIN_SIZE, height),
      };
    }
    result = clampRectToBox(result, box);
    // Con aspecto el recorte puede haberse quedado corto: se reajusta a la caja.
    result = applyAspect(result, aspect, box);
  }

  return clampRectToBox(result, box);
}

/** ¿El recorte es válido (no degenerado)? */
export function isUsableCrop(crop: ImageCrop): boolean {
  return crop.width >= 0.01 && crop.height >= 0.01;
}

/** Alto que le corresponde a la tarjeta con el recorte activo (sin deformar). */
export function croppedHeight(width: number, crop: ImageCrop, natural: Size): number {
  const rect = cropSourceRect(crop, natural.width, natural.height);
  if (rect.height <= 0) return width;
  return Math.max(1, Math.round((width * rect.height) / rect.width));
}

/** Coloca el recorte por defecto centrado con un aspecto dado. */
export function centeredCrop(aspect: number | null, natural: Size): ImageCrop {
  if (!aspect || natural.width <= 0 || natural.height <= 0) return { ...FULL_CROP };
  const box = { width: natural.width, height: natural.height };
  const full: Rect = { x: 0, y: 0, width: natural.width, height: natural.height };
  return cropFromViewRect(clampRectToBox(applyAspect(full, aspect, box), box), natural);
}

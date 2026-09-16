/**
 * Dibujo a mano alzada: modelo y geometría de los trazos.
 *
 * El trazo se guarda como una lista plana de números en el elemento del lienzo
 * (`SketchStroke.points`: x, y, presión, x, y, presión…) para que ocupe poco en
 * el documento de Yjs. Acá están las operaciones puras: agregar puntos, medir,
 * borrar con goma (recortando el trazo, no solo tirándolo entero), simplificar
 * para que un trazo largo no infle el documento, y el camino SVG que usa la
 * miniatura.
 */

import { createElementId } from './ids.js';
import type { SketchStroke } from './elements.js';
import type { Point, Rect } from './geometry.js';

export const SKETCH_TOOLS = ['pen', 'marker', 'highlighter', 'eraser', 'line', 'rect', 'ellipse'] as const;
export type SketchTool = (typeof SKETCH_TOOLS)[number];
export type DrawTool = Exclude<SketchTool, 'eraser'>;

export const SKETCH_SIZES = [1, 2, 4, 8, 16, 32] as const;
export const DEFAULT_SKETCH_SIZE = 4;
/** Cada cuántos puntos se simplifica mientras se dibuja (evita documentos enormes). */
export const SIMPLIFY_TOLERANCE = 0.6;

export type SketchPoint = { x: number; y: number; pressure: number };

export function createStroke(
  tool: DrawTool = 'pen',
  color = 'gray',
  size = DEFAULT_SKETCH_SIZE,
  init: Partial<SketchStroke> = {},
): SketchStroke {
  return {
    id: init.id ?? createElementId(),
    tool,
    color,
    size,
    points: init.points ?? [],
  };
}

/** Lista plana de números → puntos con presión. */
export function pointsOf(stroke: SketchStroke): SketchPoint[] {
  const points: SketchPoint[] = [];
  for (let i = 0; i + 1 < stroke.points.length; i += 3) {
    points.push({
      x: stroke.points[i]!,
      y: stroke.points[i + 1]!,
      pressure: stroke.points[i + 2] ?? 0.5,
    });
  }
  return points;
}

/** Puntos → lista plana, redondeando para no guardar decimales de más. */
export function flattenPoints(points: SketchPoint[]): number[] {
  const flat: number[] = [];
  for (const point of points) {
    flat.push(round(point.x), round(point.y), round(point.pressure, 2));
  }
  return flat;
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Agrega puntos al final del trazo (lo que hace el lápiz mientras se dibuja). */
export function appendPoints(stroke: SketchStroke, points: SketchPoint[]): SketchStroke {
  if (points.length === 0) return stroke;
  return { ...stroke, points: [...stroke.points, ...flattenPoints(points)] };
}

export function isDrawable(stroke: SketchStroke): boolean {
  return pointsOf(stroke).length >= 2 && stroke.size > 0;
}

/** Largo del trazo en píxeles de la tarjeta (para estadísticas y tests). */
export function strokeLength(stroke: SketchStroke): number {
  const points = pointsOf(stroke);
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

/** Caja del trazo, engordada por la mitad del grosor del pincel. */
export function strokeBounds(stroke: SketchStroke): Rect {
  const points = pointsOf(stroke);
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const pad = stroke.size / 2;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

/** Caja de todos los trazos (para que la tarjeta se ajuste al contenido). */
export function strokesBounds(strokes: SketchStroke[]): Rect | null {
  const boxes = strokes.filter(isDrawable).map(strokeBounds);
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function translateStroke(stroke: SketchStroke, dx: number, dy: number): SketchStroke {
  const points = pointsOf(stroke).map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
  return { ...stroke, points: flattenPoints(points) };
}

/** Escala el trazo (al redimensionar la tarjeta). El grosor también escala. */
export function scaleStroke(stroke: SketchStroke, scaleX: number, scaleY = scaleX): SketchStroke {
  const points = pointsOf(stroke).map((point) => ({ ...point, x: point.x * scaleX, y: point.y * scaleY }));
  const sizeScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
  return { ...stroke, size: round(Math.max(0.5, stroke.size * sizeScale), 2), points: flattenPoints(points) };
}

function distanceToSegment(point: Point, a: SketchPoint, b: SketchPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * Tramo del segmento que cae dentro del círculo, en fracción `t` (0 = inicio,
 * 1 = final). Devuelve `null` si el segmento no lo toca.
 */
export function segmentCircleRange(a: Point, b: Point, center: Point, radius: number): { t0: number; t1: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const A = dx * dx + dy * dy;
  const C = fx * fx + fy * fy - radius * radius;
  if (A === 0) return C <= 0 ? { t0: 0, t1: 1 } : null;
  const B = 2 * (fx * dx + fy * dy);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = (-B - root) / (2 * A);
  const t1 = (-B + root) / (2 * A);
  if (t1 < 0 || t0 > 1) return null;
  return { t0: Math.max(0, t0), t1: Math.min(1, t1) };
}

function lerpPoint(a: SketchPoint, b: SketchPoint, t: number): SketchPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
  };
}

/** ¿Pasa el trazo por el círculo de la goma? */
export function strokeHitsCircle(stroke: SketchStroke, center: Point, radius: number): boolean {
  const reach = radius + stroke.size / 2;
  const points = pointsOf(stroke);
  if (points.length === 0) return false;
  if (points.length === 1) return Math.hypot(points[0]!.x - center.x, points[0]!.y - center.y) <= reach;
  for (let i = 1; i < points.length; i += 1) {
    if (distanceToSegment(center, points[i - 1]!, points[i]!) <= reach) return true;
  }
  return false;
}

/**
 * Recorta el trazo contra el círculo de la goma y devuelve los trozos de fuera.
 *
 * El corte es geométrico: se calcula dónde entra y dónde sale el trazo del
 * círculo y se agregan esos puntos de frontera (con la presión interpolada), así
 * que no queda un segmento fantasma cruzando el agujero.
 */
export function clipStrokeCircle(stroke: SketchStroke, center: Point, radius: number): SketchStroke[] {
  const points = pointsOf(stroke);
  if (points.length < 2) return points.length === 1 && !strokeHitsCircle(stroke, center, radius) ? [stroke] : [];
  const pieces: SketchPoint[][] = [];
  let current: SketchPoint[] = [];
  const pushPoint = (point: SketchPoint) => {
    const last = current[current.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) current.push(point);
  };
  const closePiece = () => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const range = segmentCircleRange(a, b, center, radius);
    if (!range) {
      pushPoint(a);
      pushPoint(b);
      continue;
    }
    if (range.t0 > 0) {
      pushPoint(a);
      pushPoint(lerpPoint(a, b, range.t0));
    }
    closePiece();
    if (range.t1 < 1) {
      pushPoint(lerpPoint(a, b, range.t1));
      pushPoint(b);
    }
  }
  closePiece();

  return pieces.map((piece) => ({ ...stroke, id: createElementId(), points: flattenPoints(piece) }));
}

/**
 * Goma. `split` recorta: los tramos dentro del círculo desaparecen y el trazo
 * se parte en los trozos que quedan fuera (como una goma de verdad).
 * `whole` borra el trazo entero en cuanto lo toca.
 */
export function eraseStrokes(
  strokes: SketchStroke[],
  center: Point,
  radius: number,
  mode: 'split' | 'whole' = 'split',
): SketchStroke[] {
  const result: SketchStroke[] = [];
  for (const stroke of strokes) {
    if (!strokeHitsCircle(stroke, center, radius)) {
      result.push(stroke);
      continue;
    }
    if (mode === 'whole') continue;
    result.push(...clipStrokeCircle(stroke, center, radius));
  }
  return result;
}

/** Douglas-Peucker sobre x/y, conservando la presión de los puntos que quedan. */
export function simplifyStroke(stroke: SketchStroke, tolerance = SIMPLIFY_TOLERANCE): SketchStroke {
  const points = pointsOf(stroke);
  if (points.length <= 2) return stroke;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDistance = 0;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const distance = distanceToSegment(points[i]!, points[start]!, points[end]!);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (index > 0 && maxDistance > tolerance) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return { ...stroke, points: flattenPoints(points.filter((_, i) => keep[i]!)) };
}

/**
 * Camino SVG del trazo. Es el dibujo de respaldo (miniaturas y tableros en modo
 * simplificado): el lienzo usa `perfect-freehand` para el trazo con presión.
 */
export function strokeToPathD(stroke: SketchStroke, smoothing = true): string {
  const points = pointsOf(stroke);
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${round(points[0]!.x)} ${round(points[0]!.y)} l 0.01 0`;
  let path = `M ${round(points[0]!.x)} ${round(points[0]!.y)}`;
  if (!smoothing || points.length === 2) {
    for (let i = 1; i < points.length; i += 1) path += ` L ${round(points[i]!.x)} ${round(points[i]!.y)}`;
    return path;
  }
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i]!;
    const next = points[i + 1]!;
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    path += ` Q ${round(current.x)} ${round(current.y)} ${round(midX)} ${round(midY)}`;
  }
  const last = points[points.length - 1]!;
  path += ` L ${round(last.x)} ${round(last.y)}`;
  return path;
}

/** Radio de la goma a partir de su grosor. */
export function eraserRadius(size: number): number {
  return Math.max(4, size * 1.5);
}

/** Grosor efectivo del trazo según la herramienta. */
export function effectiveSize(tool: SketchTool, size: number): number {
  if (tool === 'highlighter') return Math.max(size, 12);
  if (tool === 'marker') return Math.max(size * 1.5, 6);
  if (tool === 'pen') return Math.max(1, size * 0.75);
  return Math.max(1, size);
}

/** Opacidad del trazo: el subrayador deja ver lo de abajo. */
export function toolOpacity(tool: SketchTool): number {
  return tool === 'highlighter' ? 0.4 : 1;
}

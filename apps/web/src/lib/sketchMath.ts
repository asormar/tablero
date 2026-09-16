/**
 * Dibujo a mano alzada: conversión de trazos a SVG.
 *
 * El modelo y la geometría viven en el contrato compartido (`sketch.ts`). Acá
 * está el paso final: los puntos de un trazo se convierten en un camino SVG. El
 * trazo con presión lo calcula `perfect-freehand` (contorno cerrado, como una
 * plumilla); las líneas y figuras rectas salen de sus dos extremos.
 */

import { getStroke } from 'perfect-freehand';

import {
  type Point,
  type Rect,
  type SketchStroke,
  DEFAULT_SKETCH_SIZE,
  SIMPLIFY_TOLERANCE,
  effectiveSize,
  pointsOf,
  simplifyStroke,
  strokeToPathD,
  toolOpacity,
} from '@tablero/shared';

export type ShapeKind = 'line' | 'rect' | 'ellipse';

export type StrokeRender =
  | { kind: 'freehand'; path: string; opacity: number }
  | { kind: 'shape'; shape: ShapeKind; from: Point; to: Point; size: number; opacity: number };

const cache = new WeakMap<SketchStroke, string>();

export function isShapeTool(tool: SketchStroke['tool']): tool is ShapeKind {
  return tool === 'line' || tool === 'rect' || tool === 'ellipse';
}

/** Rectángulo normalizado entre dos puntos (para rect y ellipse). */
export function shapeRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** Contorno cerrado de `perfect-freehand` convertido en camino SVG. */
export function outlineToPath(outline: readonly (readonly number[])[]): string {
  if (outline.length === 0) return '';
  const points: string[] = [];
  for (let index = 0; index < outline.length; index += 1) {
    const next = outline[(index + 1) % outline.length] as readonly number[];
    const current = outline[index] as readonly number[];
    const [x0, y0] = current as [number, number];
    const [x1, y1] = next as [number, number];
    points.push(`${round(x0)},${round(y0)} ${round((x0 + x1) / 2)},${round((y0 + y1) / 2)}`);
  }
  return `M ${points.join(' Q ')} Z`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

const FREEHAND_OPTIONS = {
  thinning: 0.55,
  smoothing: 0.5,
  streamline: 0.4,
  easing: (t: number) => t,
  simulatePressure: true,
  start: { taper: 0, cap: true },
  end: { taper: 6, cap: true },
};

/** Cómo se pinta un trazo (con camino SVG ya resuelto). */
export function renderOf(stroke: SketchStroke, simplified = false): StrokeRender {
  const size = effectiveSize(stroke.tool === 'eraser' ? 'pen' : stroke.tool, stroke.size);
  const opacity = toolOpacity(stroke.tool);
  const points = pointsOf(stroke);

  if (isShapeTool(stroke.tool)) {
    const from = points[0] ?? { x: 0, y: 0, pressure: 0.5 };
    const to = points[points.length - 1] ?? from;
    return { kind: 'shape', shape: stroke.tool, from, to, size, opacity };
  }

  if (simplified) {
    // Modo simplificado: camino de respaldo, sin contorno con presión.
    const cached = cache.get(stroke);
    if (cached) return { kind: 'freehand', path: cached, opacity };
    const path = strokeToPathD(stroke, false);
    cache.set(stroke, path);
    return { kind: 'freehand', path, opacity };
  }

  const cached = cache.get(stroke);
  if (cached) return { kind: 'freehand', path: cached, opacity };
  const outline = getStroke(
    points.map((point) => ({ x: point.x, y: point.y, pressure: point.pressure })),
    { ...FREEHAND_OPTIONS, size, last: true },
  );
  const path = outlineToPath(outline.map((point) => [point[0] ?? 0, point[1] ?? 0]));
  cache.set(stroke, path);
  return { kind: 'freehand', path, opacity };
}

/** Puntos nuevos a partir de muestras de puntero (con presión, si la hay). */
export function samplesToPoints(
  samples: readonly { x: number; y: number; pressure?: number }[],
  lastPressure = 0.5,
): { x: number; y: number; pressure: number }[] {
  return samples.map((sample) => ({
    x: sample.x,
    y: sample.y,
    pressure: sample.pressure && sample.pressure > 0 ? sample.pressure : lastPressure,
  }));
}

/** Pinta el trazo en curso (sin simplificar, para que se vea en tiempo real). */
export function previewPath(
  points: readonly { x: number; y: number; pressure: number }[],
  tool: SketchStroke['tool'],
  size: number,
  color: string,
): SketchStroke {
  return {
    id: 'preview',
    tool,
    color,
    size,
    points: points.flatMap((point) => [point.x, point.y, point.pressure]),
  };
}

/** Trazo terminado y listo para guardar (simplificado si es de mano alzada). */
export function finishStroke(stroke: SketchStroke, simplify = true): SketchStroke {
  if (!simplify || isShapeTool(stroke.tool)) return stroke;
  return simplifyStroke(stroke, SIMPLIFY_TOLERANCE);
}

export { DEFAULT_SKETCH_SIZE };

/**
 * Geometría del lienzo: rectángulos, selección por lazo, guías de alineación y
 * ajuste a rejilla. Todo en coordenadas de mundo (mundo = píxeles lógicos).
 */

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

export const GRID_SIZE = 8;
export const GUIDE_THRESHOLD = 6;

export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function rectRight(r: Rect): number {
  return r.x + r.width;
}
export function rectBottom(r: Rect): number {
  return r.y + r.height;
}
export function rectCenterX(r: Rect): number {
  return r.x + r.width / 2;
}
export function rectCenterY(r: Rect): number {
  return r.y + r.height / 2;
}

/** Solapamiento estricto: dos rectángulos que solo se tocan por el borde no solapan. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && b.x < rectRight(a) && a.y < rectBottom(b) && b.y < rectBottom(a);
}

/** Intersección estricta: un lazo de 1 px dentro de la tarjeta no la selecciona. */
export function rectsIntersectLoose(a: Rect, b: Rect, tolerance = 2): boolean {
  return rectsIntersect(expandRect(a, tolerance), b);
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= rectRight(r) && p.y >= r.y && p.y <= rectBottom(r);
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    rectRight(inner) <= rectRight(outer) &&
    rectBottom(inner) <= rectBottom(outer)
  );
}

export function expandRect(r: Rect, amount: number): Rect {
  return {
    x: r.x - amount,
    y: r.y - amount,
    width: r.width + amount * 2,
    height: r.height + amount * 2,
  };
}

export function translateRect(r: Rect, dx: number, dy: number): Rect {
  return { ...r, x: r.x + dx, y: r.y + dy };
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(rectRight(a), rectRight(b)) - x,
    height: Math.max(rectBottom(a), rectBottom(b)) - y,
  };
}

/** Caja envolvente de una lista de rectángulos. `null` si la lista está vacía. */
export function boundsOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let result = rects[0]!;
  for (let i = 1; i < rects.length; i += 1) {
    result = unionRect(result, rects[i]!);
  }
  return result;
}

export function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function snapToGrid(value: number, grid = GRID_SIZE): number {
  // `+ 0` evita el -0 que produciría Math.round(-0.375) al ajustar negativos.
  return Math.round(value / grid) * grid + 0;
}

export function snapPointToGrid(p: Point, grid = GRID_SIZE): Point {
  return { x: snapToGrid(p.x, grid), y: snapToGrid(p.y, grid) };
}

export type Guide = {
  axis: 'x' | 'y';
  /** Coordenada de mundo donde se dibuja la guía. */
  position: number;
  /** Extremos del segmento a dibujar. */
  start: number;
  end: number;
  kind: 'edge' | 'center';
};

export type AlignmentOptions = {
  /** Umbral magnético en unidades de mundo. */
  threshold?: number;
  /** Rejilla invisible a la que ajustar cuando no hay guías. */
  grid?: number;
  /** Si es false, solo se aplica la rejilla. */
  guides?: boolean;
  /** Si es false, no se aplica la rejilla. */
  gridSnap?: boolean;
};

export type AlignmentResult = {
  dx: number;
  dy: number;
  guides: Guide[];
};

type EdgeCandidate = { delta: number; position: number; kind: 'edge' | 'center' };

function bestCandidate(
  movingEdges: { value: number; kind: 'edge' | 'center' }[],
  targetEdges: { value: number; kind: 'edge' | 'center' }[],
  threshold: number,
): EdgeCandidate | null {
  let best: EdgeCandidate | null = null;
  for (const m of movingEdges) {
    for (const t of targetEdges) {
      const delta = t.value - m.value;
      if (Math.abs(delta) > threshold) continue;
      const kind: 'edge' | 'center' = m.kind === 'center' || t.kind === 'center' ? 'center' : 'edge';
      if (!best) {
        best = { delta, position: t.value, kind };
        continue;
      }
      const better = Math.abs(delta) < Math.abs(best.delta);
      // Empate: la guía de centros gana (es más informativa que la de bordes).
      const tieBreak = Math.abs(delta) === Math.abs(best.delta) && kind === 'center' && best.kind !== 'center';
      if (better || tieBreak) {
        best = { delta, position: t.value, kind };
      }
    }
  }
  return best;
}

/**
 * Calcula el desplazamiento magnético de un grupo de elementos que se está
 * arrastrando frente a un conjunto de elementos de referencia.
 *
 * Devuelve el delta a aplicar (ya redondeado) y las guías a dibujar.
 */
export function computeAlignment(
  moving: Rect[],
  targets: Rect[],
  options: AlignmentOptions = {},
): AlignmentResult {
  const threshold = options.threshold ?? GUIDE_THRESHOLD;
  const grid = options.grid ?? GRID_SIZE;
  const useGuides = options.guides ?? true;
  const useGrid = options.gridSnap ?? true;

  if (moving.length === 0) return { dx: 0, dy: 0, guides: [] };

  const box = boundsOf(moving);
  if (!box) return { dx: 0, dy: 0, guides: [] };

  if (!useGuides || targets.length === 0) {
    const dx = useGrid ? snapToGrid(box.x, grid) - box.x : 0;
    const dy = useGrid ? snapToGrid(box.y, grid) - box.y : 0;
    return { dx, dy, guides: [] };
  }

  const movingX = [
    { value: box.x, kind: 'edge' as const },
    { value: rectCenterX(box), kind: 'center' as const },
    { value: rectRight(box), kind: 'edge' as const },
  ];
  const movingY = [
    { value: box.y, kind: 'edge' as const },
    { value: rectCenterY(box), kind: 'center' as const },
    { value: rectBottom(box), kind: 'edge' as const },
  ];

  const targetX: { value: number; kind: 'edge' | 'center' }[] = [];
  const targetY: { value: number; kind: 'edge' | 'center' }[] = [];
  for (const t of targets) {
    targetX.push({ value: t.x, kind: 'edge' }, { value: rectCenterX(t), kind: 'center' }, { value: rectRight(t), kind: 'edge' });
    targetY.push({ value: t.y, kind: 'edge' }, { value: rectCenterY(t), kind: 'center' }, { value: rectBottom(t), kind: 'edge' });
  }

  const bestX = bestCandidate(movingX, targetX, threshold);
  const bestY = bestCandidate(movingY, targetY, threshold);

  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;

  if (bestX) {
    dx = bestX.delta;
    const shifted = translateRect(box, dx, 0);
    let top = rectBottom(shifted);
    let bottom = shifted.y;
    for (const t of targets) {
      if (
        Math.abs(t.x - bestX.position) < 0.5 ||
        Math.abs(rectCenterX(t) - bestX.position) < 0.5 ||
        Math.abs(rectRight(t) - bestX.position) < 0.5
      ) {
        top = Math.min(top, t.y);
        bottom = Math.max(bottom, rectBottom(t));
      }
    }
    guides.push({
      axis: 'x',
      position: bestX.position,
      start: Math.min(top, shifted.y),
      end: Math.max(bottom, rectBottom(shifted)),
      kind: bestX.kind,
    });
  } else if (useGrid) {
    dx = snapToGrid(box.x, grid) - box.x;
  }

  if (bestY) {
    dy = bestY.delta;
    const shifted = translateRect(box, 0, dy);
    let left = rectRight(shifted);
    let right = shifted.x;
    for (const t of targets) {
      if (
        Math.abs(t.y - bestY.position) < 0.5 ||
        Math.abs(rectCenterY(t) - bestY.position) < 0.5 ||
        Math.abs(rectBottom(t) - bestY.position) < 0.5
      ) {
        left = Math.min(left, t.x);
        right = Math.max(right, rectRight(t));
      }
    }
    guides.push({
      axis: 'y',
      position: bestY.position,
      start: Math.min(left, shifted.x),
      end: Math.max(right, rectRight(shifted)),
      kind: bestY.kind,
    });
  } else if (useGrid) {
    dy = snapToGrid(box.y, grid) - box.y;
  }

  return { dx: Math.round(dx), dy: Math.round(dy), guides };
}

export type AlignAction =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom'
  | 'distribute-x'
  | 'distribute-y';

/** Alineación/distribución de una selección sobre la caja envolvente común. */
export function alignRects(rects: Rect[], action: AlignAction): Point[] {
  const box = boundsOf(rects);
  if (!box || rects.length < 2) {
    if (action.startsWith('distribute')) return rects.map((r) => ({ x: r.x, y: r.y }));
    return rects.map((r) => ({ x: r.x, y: r.y }));
  }
  switch (action) {
    case 'left':
      return rects.map((r) => ({ x: box.x, y: r.y }));
    case 'center-x':
      return rects.map((r) => ({ x: rectCenterX(box) - r.width / 2, y: r.y }));
    case 'right':
      return rects.map((r) => ({ x: rectRight(box) - r.width, y: r.y }));
    case 'top':
      return rects.map((r) => ({ x: r.x, y: box.y }));
    case 'center-y':
      return rects.map((r) => ({ x: r.x, y: rectCenterY(box) - r.height / 2 }));
    case 'bottom':
      return rects.map((r) => ({ x: r.x, y: rectBottom(box) - r.height }));
    case 'distribute-x': {
      if (rects.length < 3) return rects.map((r) => ({ x: r.x, y: r.y }));
      const sorted = [...rects].sort((a, b) => a.x - b.x);
      const totalWidth = sorted.reduce((sum, r) => sum + r.width, 0);
      const gap = (box.width - totalWidth) / (sorted.length - 1);
      let cursor = box.x;
      const positions = new Map<Rect, Point>();
      for (const r of sorted) {
        positions.set(r, { x: Math.round(cursor), y: r.y });
        cursor += r.width + gap;
      }
      return rects.map((r) => positions.get(r)!);
    }
    case 'distribute-y': {
      if (rects.length < 3) return rects.map((r) => ({ x: r.x, y: r.y }));
      const sorted = [...rects].sort((a, b) => a.y - b.y);
      const totalHeight = sorted.reduce((sum, r) => sum + r.height, 0);
      const gap = (box.height - totalHeight) / (sorted.length - 1);
      let cursor = box.y;
      const positions = new Map<Rect, Point>();
      for (const r of sorted) {
        positions.set(r, { x: r.x, y: Math.round(cursor) });
        cursor += r.height + gap;
      }
      return rects.map((r) => positions.get(r)!);
    }
    default:
      return rects.map((r) => ({ x: r.x, y: r.y }));
  }
}

/** Coloca elementos nuevos en flujo: debajo del último, sin solaparse. */
export function nextPlacement(existing: Rect[], size: Size, origin: Point, gap = 16): Point {
  let candidate = { x: rectIsFree(existing, { ...origin, ...size }) ? origin.x : origin.x, y: origin.y };
  for (let i = 0; i < existing.length + 1; i += 1) {
    const rect: Rect = { x: candidate.x, y: candidate.y, ...size };
    const collides = existing.some((r) => rectsIntersect(expandRect(r, gap / 2), rect));
    if (!collides) return candidate;
    candidate = { x: candidate.x, y: candidate.y + size.height + gap };
  }
  return candidate;
}

function rectIsFree(existing: Rect[], rect: Rect): boolean {
  return !existing.some((r) => rectsIntersect(r, rect));
}

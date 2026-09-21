/**
 * Conectores (líneas y flechas): modelo y geometría.
 *
 * Un conector no tiene posición propia: se ancla a los bordes de dos elementos
 * (o a un punto libre del lienzo) y se recalcula cuando esos elementos se
 * mueven. El estilo es data pura; el dibujo lo hace la capa SVG de la web. La
 * etiqueta vive sobre el punto medio de la curva.
 */

import type { Rect, Point } from './geometry.js';
import { expandRect, rectBottom, rectCenterX, rectCenterY, rectRight, rectsIntersect } from './geometry.js';

export const ANCHOR_SIDES = ['auto', 'left', 'right', 'top', 'bottom'] as const;
export type AnchorSide = (typeof ANCHOR_SIDES)[number];
export type FixedSide = Exclude<AnchorSide, 'auto'>;

/** Puntas: ninguna, flecha o punto (en cualquiera de los dos extremos). */
export const ARROW_KINDS = ['none', 'arrow', 'dot'] as const;
export type ArrowKind = (typeof ARROW_KINDS)[number];

export type ConnectorCurve = 'straight' | 'curved';
export type ConnectorDash = 'solid' | 'dashed' | 'dotted';

export type ConnectorStyle = {
  curve: ConnectorCurve;
  dash: ConnectorDash;
  /** Grosor en píxeles de mundo (1–8 recomendado). */
  width: number;
  /** Token de la paleta (`gray`, `red`…) o color literal `#RRGGBB`. */
  color: string;
  startArrow: ArrowKind;
  endArrow: ArrowKind;
  /** Cuánto se separa la curva de la recta, en fracción de la distancia (0–1). */
  tension: number;
};

export const DEFAULT_CONNECTOR_STYLE: ConnectorStyle = {
  curve: 'curved',
  dash: 'solid',
  width: 2,
  color: 'gray',
  startArrow: 'none',
  endArrow: 'arrow',
  tension: 0.35,
};

export type ConnectorEndpoint = {
  /** Elemento al que se ancla. `null` = punto libre en el lienzo. */
  elementId: string | null;
  /** Posición de reserva (punto libre, o cuando el elemento ya no existe). */
  point: Point;
  /** Lado del rectángulo al que se pega; `auto` elige el más cercano. */
  side: AnchorSide;
  /** Posición a lo largo del lado, 0 = principio, 0.5 = centro, 1 = final. */
  offset: number;
};

export type ConnectorLabel = {
  text: string;
  /** Desplazamiento respecto del punto medio de la curva. */
  dx: number;
  dy: number;
};

export type Connector = {
  id: string;
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
  style: ConnectorStyle;
  label?: ConnectorLabel;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export function createEndpoint(init: Partial<ConnectorEndpoint> = {}): ConnectorEndpoint {
  return {
    elementId: init.elementId ?? null,
    point: init.point ?? { x: 0, y: 0 },
    side: init.side ?? 'auto',
    offset: init.offset ?? 0.5,
  };
}

/** Punto de anclaje sobre un lado del rectángulo. */
export function anchorPoint(rect: Rect, side: FixedSide, offset = 0.5): Point {
  const t = Math.max(0, Math.min(1, offset));
  switch (side) {
    case 'left':
      return { x: rect.x, y: rect.y + rect.height * t };
    case 'right':
      return { x: rectRight(rect), y: rect.y + rect.height * t };
    case 'top':
      return { x: rect.x + rect.width * t, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width * t, y: rectBottom(rect) };
    default:
      return { x: rectCenterX(rect), y: rectCenterY(rect) };
  }
}

/** Normal hacia fuera del rectángulo, para separar la curva del borde. */
export function sideNormal(side: FixedSide): Point {
  switch (side) {
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Lados que se miran entre sí: si el otro rectángulo está más a la derecha, se
 * sale por la derecha y se entra por la izquierda.
 */
export function autoSides(from: Rect, to: Rect): { from: FixedSide; to: FixedSide } {
  const dx = rectCenterX(to) - rectCenterX(from);
  const dy = rectCenterY(to) - rectCenterY(from);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  }
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

export type ResolvedEndpoint = { point: Point; side: FixedSide | null };

/**
 * Resuelve un extremo a un punto concreto. Con `other` se puede resolver el
 * lado `auto` (hace falta saber hacia dónde va el conector).
 */
export function resolveEndpoint(
  endpoint: ConnectorEndpoint,
  rect: Rect | null,
  other: Rect | null = null,
): ResolvedEndpoint {
  if (!rect) return { point: endpoint.point, side: null };
  let side: FixedSide;
  if (endpoint.side !== 'auto') {
    side = endpoint.side;
  } else if (other) {
    const sides = autoSides(rect, other);
    side = sides.from;
  } else {
    side = 'right';
  }
  return { point: anchorPoint(rect, side, endpoint.offset), side };
}

export type ConnectorGeometry = {
  start: Point;
  end: Point;
  /** Puntos de control del bézier (iguales a los extremos si la línea es recta). */
  control1: Point;
  control2: Point;
  /** Atributo `d` listo para un `<path>`. */
  path: string;
  /** Punto medio de la curva: donde va la etiqueta y el tirador de curvatura. */
  labelPoint: Point;
  /** Direcciones (normalizadas) en cada extremo, para orientar las puntas. */
  startDirection: Point;
  endDirection: Point;
};

/**
 * Cuerpo mínimo visible de un conector, en píxeles de mundo.
 *
 * Con los dos extremos casi pegados (dos tarjetas que se tocan) el empuje mínimo
 * de los controles plegaba la curva sobre el ancla: en pantalla quedaba solo la
 * punta de flecha, sin trazo, y como el clic caía sobre la tarjeta no había
 * forma de seleccionar el conector ni de borrarlo. Por debajo de esta distancia
 * el cuerpo se estira a lo largo del eje para que la línea se vea y quede un
 * trecho donde hacer clic.
 */
export const MIN_CONNECTOR_BODY = 24;

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalize(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

function pointOnCubic(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
  const mt = 1 - t;
  const x =
    mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x;
  const y =
    mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y;
  return { x, y };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Geometría entre dos extremos ya resueltos.
 *
 * Con `curve: 'straight'` los controles son el punto medio (la curva degenera en
 * la recta). Con `curved`, cada control sale del extremo en la dirección de su
 * lado, proporcional a la distancia: así la curva nunca cruza la tarjeta.
 *
 * Si las dos anclas están más cerca que `MIN_CONNECTOR_BODY` el cuerpo se estira
 * hacia atrás desde el ancla de destino (la punta y la flecha no se mueven) para
 * que la línea se vea y quede un trecho donde hacer clic; a distancias normales
 * la geometría es exactamente la de siempre.
 */
export function connectorGeometry(
  from: ResolvedEndpoint,
  to: ResolvedEndpoint,
  style: ConnectorStyle = DEFAULT_CONNECTOR_STYLE,
): ConnectorGeometry {
  const anchorStart = from.point;
  const anchorEnd = to.point;
  const raw = distance(anchorStart, anchorEnd);

  let start = anchorStart;
  const end = anchorEnd;
  let stretched = false;
  if (raw < MIN_CONNECTOR_BODY) {
    // Dirección del conector; con las anclas superpuestas sirve la normal del
    // lado de salida (apunta hacia el destino).
    const axis =
      raw > 0
        ? { x: (anchorEnd.x - anchorStart.x) / raw, y: (anchorEnd.y - anchorStart.y) / raw }
        : from.side
          ? sideNormal(from.side)
          : { x: 1, y: 0 };
    const grow = MIN_CONNECTOR_BODY - raw;
    start = { x: anchorStart.x - axis.x * grow, y: anchorStart.y - axis.y * grow };
    stretched = true;
  }

  const span = Math.max(MIN_CONNECTOR_BODY, distance(start, end));
  const push = Math.max(18, span * Math.max(0, Math.min(1, style.tension)));
  // Con el cuerpo estirado, un empuje mayor que el propio cuerpo plegaría la
  // curva sobre las anclas (el lazo que dejaba el conector sin línea).
  const reach = stretched ? Math.min(push, span / 2) : push;

  let control1: Point;
  let control2: Point;
  if (style.curve === 'curved') {
    const normalFrom = from.side ? sideNormal(from.side) : normalize({ x: end.x - start.x, y: end.y - start.y });
    const normalTo = to.side ? sideNormal(to.side) : normalize({ x: start.x - end.x, y: start.y - end.y });
    control1 = { x: start.x + normalFrom.x * reach, y: start.y + normalFrom.y * reach };
    control2 = { x: end.x + normalTo.x * reach, y: end.y + normalTo.y * reach };
  } else {
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    control1 = mid;
    control2 = mid;
  }

  const path =
    style.curve === 'curved'
      ? `M ${formatNumber(start.x)} ${formatNumber(start.y)} C ${formatNumber(control1.x)} ${formatNumber(control1.y)}, ${formatNumber(control2.x)} ${formatNumber(control2.y)}, ${formatNumber(end.x)} ${formatNumber(end.y)}`
      : `M ${formatNumber(start.x)} ${formatNumber(start.y)} L ${formatNumber(end.x)} ${formatNumber(end.y)}`;

  // Dirección de la curva en cada extremo (para las puntas).
  const startDirection =
    style.curve === 'curved' ? normalize({ x: control1.x - start.x, y: control1.y - start.y }) : normalize({ x: end.x - start.x, y: end.y - start.y });
  const endDirection =
    style.curve === 'curved' ? normalize({ x: end.x - control2.x, y: end.y - control2.y }) : normalize({ x: end.x - start.x, y: end.y - start.y });

  return {
    start,
    end,
    control1,
    control2,
    path,
    labelPoint: pointOnCubic(start, control1, control2, end, 0.5),
    startDirection,
    endDirection,
  };
}

/** Punto de la curva en `t` (0 = inicio, 1 = final). */
export function pointOnPath(geometry: ConnectorGeometry, t: number): Point {
  return pointOnCubic(geometry.start, geometry.control1, geometry.control2, geometry.end, Math.max(0, Math.min(1, t)));
}

/** Distancia mínima de un punto a la curva, aproximada por muestreo. */
export function distanceToPath(geometry: ConnectorGeometry, point: Point, samples = 32): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= samples; i += 1) {
    const candidate = pointOnPath(geometry, i / samples);
    const d = distance(candidate, point);
    if (d < best) best = d;
  }
  return best;
}

/** ¿El clic cayó sobre la línea? El grosor del trazo se suma a la tolerancia. */
export function hitsPath(geometry: ConnectorGeometry, point: Point, tolerance = 6, style?: ConnectorStyle): boolean {
  const width = style?.width ?? 2;
  return distanceToPath(geometry, point) <= tolerance + width;
}

/** Caja envolvente de la curva (para el lazo de selección y el encaje). */
export function connectorBounds(geometry: ConnectorGeometry, samples = 16): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i <= samples; i += 1) {
    const point = pointOnPath(geometry, i / samples);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** Signo del giro a→b→c (0 = colineales). */
function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** ¿Los dos segmentos se cruzan de verdad (sin contarse los extremos)? */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** ¿El segmento a→b cruza alguno de los cuatro bordes del rectángulo? */
function segmentCrossesRect(a: Point, b: Point, rect: Rect): boolean {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const corners: Point[] = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  for (let i = 0; i < corners.length; i += 1) {
    const from = corners[i];
    const to = corners[(i + 1) % corners.length];
    if (from && to && segmentsCross(a, b, from, to)) return true;
  }
  return false;
}

/**
 * ¿La curva de un conector intersecta el rectángulo? Es el acierto del lazo de
 * selección: la flecha entra cuando el rectángulo la toca, la cruza o la
 * envuelve; y no entra cuando el lazo pasa cerca pero no llega al trazo.
 *
 * Primero descarta con la caja envolvente (O(1) para todo lo lejano) y después
 * camina la polilínea muestreada comprobando punto a punto y segmento a
 * segmento: así un lazo que cruza una línea larga por la mitad cuenta aunque
 * ningún punto de muestreo caiga dentro. `tolerance` (1 px de mundo) cubre el
 * lazo degenerado de un arrastre perfectamente horizontal o vertical.
 */
export function connectorIntersectsRect(
  geometry: ConnectorGeometry,
  rect: Rect,
  samples = 32,
  tolerance = 1,
): boolean {
  const box = tolerance > 0 ? expandRect(rect, tolerance) : rect;
  if (!rectsIntersect(connectorBounds(geometry, samples), box)) return false;
  let previous = geometry.start;
  if (pointInRect(previous, box)) return true;
  for (let i = 1; i <= samples; i += 1) {
    const point = pointOnPath(geometry, i / samples);
    if (pointInRect(point, box)) return true;
    if (segmentCrossesRect(previous, point, box)) return true;
    previous = point;
  }
  return false;
}

/** Patrón de guiones para el trazo. */
export function dashArray(style: ConnectorStyle, width = style.width): string | undefined {
  switch (style.dash) {
    case 'dashed':
      return `${width * 3} ${width * 2}`;
    case 'dotted':
      return `0 ${width * 2.2}`;
    default:
      return undefined;
  }
}

/**
 * Conector nuevo entre dos elementos (o puntos libres), con estilo por defecto.
 * El `auto` de los lados se resuelve al dibujar, no acá: así el conector se
 * reacomoda solo cuando las tarjetas se mueven.
 */
export function createConnector(
  id: string,
  from: Partial<ConnectorEndpoint>,
  to: Partial<ConnectorEndpoint>,
  init: { style?: Partial<ConnectorStyle>; createdBy?: string; now?: number } = {},
): Connector {
  const now = init.now ?? Date.now();
  return {
    id,
    from: createEndpoint(from),
    to: createEndpoint(to),
    style: { ...DEFAULT_CONNECTOR_STYLE, ...init.style },
    createdBy: init.createdBy ?? 'unknown',
    createdAt: now,
    updatedAt: now,
  };
}

/** ¿Este extremo está pegado a un elemento (y no a un punto libre)? */
export function isAttached(endpoint: ConnectorEndpoint): boolean {
  return typeof endpoint.elementId === 'string' && endpoint.elementId.length > 0;
}

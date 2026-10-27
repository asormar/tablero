/**
 * Geometría de los conectores en el lienzo.
 *
 * La curva se recalcula a partir de los rectángulos de las tarjetas. Para los
 * gestos (arrastre, lazo, clic) se usan los rectángulos **vivos**: se prefiere el
 * del DOM (que ya incluye el `transform` de un arrastre en curso) y, si la
 * tarjeta no está montada por la virtualización, el del layout. De ahí que las
 * flechas sigan a las tarjetas: no guardan posición, se recalculan en cada frame
 * del gesto. Para pintar la capa (`ConnectorLayer`) se usa el modo estático: el
 * layout en coordenadas de mundo, que no cambian al desplazarse ni al hacer zoom.
 */

import {
  type Connector,
  type ConnectorGeometry,
  type Point,
  type Rect,
  connectorGeometry,
  connectorIntersectsRect,
  hitsPath,
  resolveEndpoint,
} from '@tablero/shared';

import { canvasRect } from '@/canvas/canvasRef';
import { getNode } from '@/canvas/nodeRegistry';
import type { BoardSession } from '@/collab/BoardSession';
import { arrowPath } from '@/lib/connectorArrows';
import { type ElementLayout, rectOf } from '@/lib/layout';
import { useUiStore } from '@/state/uiStore';

/** Resuelve el rectángulo de mundo de una tarjeta. */
export type RectResolver = (id: string) => Rect | null;

function domRectOf(node: HTMLElement, scale: number, offset: Point): Rect {
  const rect = node.getBoundingClientRect();
  const canvas = canvasRect();
  return {
    x: offset.x + (rect.left - canvas.left) / scale,
    y: offset.y + (rect.top - canvas.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

export type RectResolverOptions = {
  /**
   * `true` (por defecto): el DOM de la tarjeta manda, porque ya incluye el
   * `transform` de un arrastre en curso. `false`: las tarjetas del layout se
   * resuelven solo por sus coordenadas de mundo (más la altura medida), sin
   * leer el DOM; así el resultado no depende del viewport y un paneo o un zoom
   * no obliga a recalcular nada.
   */
  live?: boolean;
};

/**
 * Índice de rectángulos. En modo vivo, primero el DOM de la tarjeta (exacto y al
 * día durante un arrastre) y después el layout (tarjetas virtualizadas fuera de
 * pantalla). En modo estático, primero el layout; el DOM solo cubre lo que el
 * layout no trae: los hijos de una columna, que ubica el flujo de la columna y
 * no tienen posición de mundo en el documento.
 */
export function createRectResolver(
  layout: readonly ElementLayout[],
  measured?: ReadonlyMap<string, number>,
  options: RectResolverOptions = {},
): RectResolver {
  const live = options.live ?? true;
  const index = new Map<string, Rect>();
  for (const item of layout) index.set(item.id, rectOf(item, measured));
  const { viewport } = useUiStore.getState();
  const fromDom = (id: string): Rect | null => {
    const node = getNode(id);
    return node ? domRectOf(node, viewport.scale, { x: viewport.x, y: viewport.y }) : null;
  };
  if (live) return (id: string) => fromDom(id) ?? index.get(id) ?? null;
  return (id: string) => index.get(id) ?? fromDom(id);
}

/**
 * ¿Algún extremo apunta a un hijo de columna? Esos rectángulos salen del DOM, así
 * que dependen del viewport (la capa tiene que recalcular al desplazarse).
 */
export function hasColumnChildEndpoints(
  session: BoardSession,
  connectors: readonly Connector[],
  layout: readonly ElementLayout[],
): boolean {
  if (connectors.length === 0) return false;
  let known: Set<string> | null = null;
  for (const connector of connectors) {
    for (const endpoint of [connector.from, connector.to]) {
      const id = endpoint.elementId;
      if (!id) continue;
      if (!known) known = new Set(layout.map((item) => item.id));
      if (known.has(id)) continue;
      if (session.getElement(id)?.parentId) return true;
    }
  }
  return false;
}

/** Geometría de un conector con los rectángulos ya resueltos. */
export function geometryOf(connector: Connector, resolve: RectResolver): ConnectorGeometry {
  const fromRect = connector.from.elementId ? resolve(connector.from.elementId) : null;
  const toRect = connector.to.elementId ? resolve(connector.to.elementId) : null;
  const from = resolveEndpoint(connector.from, fromRect, toRect);
  const to = resolveEndpoint(connector.to, toRect, fromRect);
  return connectorGeometry(from, to, connector.style);
}

export type ResolvedConnector = { connector: Connector; geometry: ConnectorGeometry };

/** Todas las geometrías del tablero (una pasada, reutilizable por la capa). */
export function resolveConnectors(session: BoardSession, layout: readonly ElementLayout[]): ResolvedConnector[] {
  const measured = useUiStore.getState().measuredHeights;
  const resolve = createRectResolver(layout, measured);
  return session.getConnectors().map((connector) => ({ connector, geometry: geometryOf(connector, resolve) }));
}

/** Conector sobre el que cae un punto de mundo (para seleccionar y borrar). */
export function connectorAtPoint(
  session: BoardSession,
  point: Point,
  tolerance = 6,
): Connector | null {
  const resolved = resolveConnectors(session, session.getLayout());
  let best: { connector: Connector; distance: number } | null = null;
  for (const item of resolved) {
    if (!hitsPath(item.geometry, point, tolerance, item.connector.style)) continue;
    const distance = Math.hypot(item.geometry.labelPoint.x - point.x, item.geometry.labelPoint.y - point.y);
    if (!best || distance < best.distance) best = { connector: item.connector, distance };
  }
  return best?.connector ?? null;
}

/**
 * Conectores cuya geometría intersecta un rectángulo de mundo (el lazo).
 * Se resuelve con los rectángulos **vivos** de las tarjetas, así que un lazo
 * sobre tarjetas que se acaban de mover acierta igual.
 */
export function connectorsInRect(session: BoardSession, rect: Rect): Connector[] {
  const resolved = resolveConnectors(session, session.getLayout());
  const hits: Connector[] = [];
  for (const item of resolved) {
    if (!connectorIntersectsRect(item.geometry, rect)) continue;
    hits.push(item.connector);
  }
  return hits;
}

// --- Nodos del DOM para el seguimiento en vivo -------------------------------

export type ConnectorNodes = {
  path: SVGPathElement | null;
  halo: SVGPathElement | null;
  startArrow: SVGPathElement | null;
  endArrow: SVGPathElement | null;
  label: HTMLElement | null;
  handle: HTMLElement | null;
};

const EMPTY_NODES: ConnectorNodes = {
  path: null,
  halo: null,
  startArrow: null,
  endArrow: null,
  label: null,
  handle: null,
};

const nodes = new Map<string, ConnectorNodes>();

/** Registra los nodos de un conector (se fusiona: cada pieza aporta los suyos). */
export function registerConnectorNodes(id: string, value: Partial<ConnectorNodes>): void {
  const current = nodes.get(id) ?? { ...EMPTY_NODES };
  nodes.set(id, { ...current, ...value });
}

export function unregisterConnectorNodes(id: string): void {
  nodes.delete(id);
}

/** Suelta solo los nodos que aportó una pieza (el resto sigue registrado). */
export function releaseConnectorNodes(id: string, keys: (keyof ConnectorNodes)[]): void {
  const current = nodes.get(id);
  if (!current) return;
  const next = { ...current };
  for (const key of keys) next[key] = null;
  if (Object.values(next).every((value) => value === null)) nodes.delete(id);
  else nodes.set(id, next);
}

/**
 * Recalcula y reescribe la geometría de todos los conectores directamente en el
 * DOM. Se llama en cada frame de un arrastre: mover 300 tarjetas con flechas no
 * puede costar renders de React.
 */
export function refreshConnectorNodes(session: BoardSession): void {
  if (nodes.size === 0) return;
  const measured = useUiStore.getState().measuredHeights;
  const resolve = createRectResolver(session.getLayout(), measured);
  for (const connector of session.getConnectors()) {
    const entry = nodes.get(connector.id);
    if (!entry) continue;
    const geometry = geometryOf(connector, resolve);
    entry.path?.setAttribute('d', geometry.path);
    entry.halo?.setAttribute('d', geometry.path);
    const arrows = arrowPaths(connector, geometry);
    if (entry.startArrow) entry.startArrow.setAttribute('d', arrows.startArrowPath);
    if (entry.endArrow) entry.endArrow.setAttribute('d', arrows.endArrowPath);
    if (entry.label) {
      const label = connector.label;
      entry.label.style.transform = `translate3d(${geometry.labelPoint.x + (label?.dx ?? 0)}px, ${geometry.labelPoint.y + (label?.dy ?? 0)}px, 0) translate(-50%, -50%)`;
    }
    if (entry.handle) {
      entry.handle.style.transform = `translate3d(${geometry.labelPoint.x + 10}px, ${geometry.labelPoint.y + 10}px, 0) translate(-50%, -50%)`;
    }
  }
}

/** Rutas de las puntas (se recalcula con la geometría viva). */
export function arrowPaths(connector: Connector, geometry: ConnectorGeometry): { startArrowPath: string; endArrowPath: string } {
  const width = connector.style.width;
  return {
    startArrowPath: arrowPath(connector.style.startArrow, geometry.start, { x: -geometry.startDirection.x, y: -geometry.startDirection.y }, width),
    endArrowPath: arrowPath(connector.style.endArrow, geometry.end, geometry.endDirection, width),
  };
}

/**
 * Conectores en el documento del tablero (capa web).
 *
 * El contrato compartido (`@tablero/shared/connectors`) define el modelo y la
 * geometría, pero no la persistencia: ese archivo solo declara el mapa
 * `doc.getMap('connectors')`. Acá está la escritura y la lectura de ese mapa,
 * con la misma convención que los elementos: campos primitivos en el `Y.Map` y
 * las estructuras (`from`, `to`, `style`, `label`) como JSON en una sola clave.
 */

import * as Y from 'yjs';

import {
  type Connector,
  type ConnectorEndpoint,
  type ConnectorLabel,
  type ConnectorStyle,
  DEFAULT_CONNECTOR_STYLE,
  type Point,
  connectorsOf,
  createConnector,
  createConnectorId,
} from '@tablero/shared';

export type ConnectorInit = {
  style?: Partial<ConnectorStyle>;
  label?: ConnectorLabel;
  createdBy?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readPoint(value: unknown, fallback: Point = { x: 0, y: 0 }): Point {
  const record = asObject(value);
  if (!record) return fallback;
  const x = asNumber(record['x']);
  const y = asNumber(record['y']);
  return { x: x ?? fallback.x, y: y ?? fallback.y };
}

function readEndpoint(value: unknown): ConnectorEndpoint {
  const record = asObject(value);
  if (!record) return { elementId: null, point: { x: 0, y: 0 }, side: 'auto', offset: 0.5 };
  const elementId = asString(record['elementId']) ?? null;
  const side = asString(record['side']);
  const offset = asNumber(record['offset']);
  return {
    elementId: elementId && elementId.length > 0 ? elementId : null,
    point: readPoint(record['point']),
    side: side === 'left' || side === 'right' || side === 'top' || side === 'bottom' ? side : 'auto',
    offset: offset === undefined ? 0.5 : Math.max(0, Math.min(1, offset)),
  };
}

function readStyle(value: unknown): ConnectorStyle {
  const record = asObject(value);
  if (!record) return { ...DEFAULT_CONNECTOR_STYLE };
  const curve = asString(record['curve']);
  const dash = asString(record['dash']);
  const startArrow = asString(record['startArrow']);
  const endArrow = asString(record['endArrow']);
  const width = asNumber(record['width']);
  const tension = asNumber(record['tension']);
  const color = asString(record['color']);
  return {
    curve: curve === 'straight' ? 'straight' : 'curved',
    dash: dash === 'dashed' || dash === 'dotted' ? dash : 'solid',
    width: width === undefined ? DEFAULT_CONNECTOR_STYLE.width : Math.max(0.5, Math.min(16, width)),
    color: color && color.length > 0 ? color : DEFAULT_CONNECTOR_STYLE.color,
    startArrow: startArrow === 'arrow' || startArrow === 'dot' ? startArrow : 'none',
    endArrow: endArrow === 'arrow' || endArrow === 'dot' ? endArrow : 'none',
    tension: tension === undefined ? DEFAULT_CONNECTOR_STYLE.tension : Math.max(0, Math.min(1, tension)),
  };
}

function readLabel(value: unknown): ConnectorLabel | undefined {
  const record = asObject(value);
  if (!record) return undefined;
  const text = asString(record['text']);
  if (text === undefined) return undefined;
  return { text, dx: asNumber(record['dx']) ?? 0, dy: asNumber(record['dy']) ?? 0 };
}

/** Lee un `Y.Map` de conector (null si está incompleto). */
export function readConnector(map: Y.Map<unknown>): Connector | null {
  const id = asString(map.get('id'));
  if (!id) return null;
  return {
    id,
    from: readEndpoint(map.get('from')),
    to: readEndpoint(map.get('to')),
    style: readStyle(map.get('style')),
    ...(readLabel(map.get('label')) ? { label: readLabel(map.get('label')) } : {}),
    createdBy: asString(map.get('createdBy')) ?? 'unknown',
    createdAt: asNumber(map.get('createdAt')) ?? 0,
    updatedAt: asNumber(map.get('updatedAt')) ?? 0,
  };
}

function connectorMap(connector: Connector): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('id', connector.id);
  map.set('from', connector.from);
  map.set('to', connector.to);
  map.set('style', connector.style);
  if (connector.label) map.set('label', connector.label);
  map.set('createdBy', connector.createdBy);
  map.set('createdAt', connector.createdAt);
  map.set('updatedAt', connector.updatedAt);
  return map;
}

/** Escribe un conector completo (creación, pegado, importación). */
export function writeConnector(doc: Y.Doc, connector: Connector, origin: unknown): void {
  doc.transact(() => {
    connectorsOf(doc).set(connector.id, connectorMap(connector));
  }, origin);
}

/** Crea un conector entre dos extremos y lo guarda. Devuelve su id. */
export function addConnector(
  doc: Y.Doc,
  from: Partial<ConnectorEndpoint>,
  to: Partial<ConnectorEndpoint>,
  origin: unknown,
  init: ConnectorInit = {},
): string {
  const connector = createConnector(
    createConnectorId(),
    from,
    to,
    { ...(init.style ? { style: init.style } : {}), ...(init.createdBy ? { createdBy: init.createdBy } : {}) },
  );
  const withLabel: Connector = init.label ? { ...connector, label: init.label } : connector;
  writeConnector(doc, withLabel, origin);
  return withLabel.id;
}

export type ConnectorPatch = Partial<Pick<Connector, 'from' | 'to' | 'style' | 'label'>>;

/** Aplica campos a un conector existente, en una sola transacción. */
export function patchConnector(doc: Y.Doc, id: string, patch: ConnectorPatch, origin: unknown): void {
  const map = connectorsOf(doc).get(id);
  if (!map) return;
  doc.transact(() => {
    if (patch.from) map.set('from', patch.from);
    if (patch.to) map.set('to', patch.to);
    if (patch.style) map.set('style', patch.style);
    if (patch.label) map.set('label', patch.label);
    map.set('updatedAt', Date.now());
  }, origin);
}

export function removeConnectors(doc: Y.Doc, ids: string[], origin: unknown): void {
  if (ids.length === 0) return;
  const store = connectorsOf(doc);
  doc.transact(() => {
    for (const id of ids) store.delete(id);
  }, origin);
}

/**
 * Al borrar elementos hay que borrar también sus conectores: si no, quedarían
 * flechas apuntando a una tarjeta que ya no existe.
 */
export function connectorIdsTouching(connectors: Connector[], elementIds: readonly string[]): string[] {
  const wanted = new Set(elementIds);
  const result: string[] = [];
  for (const connector of connectors) {
    const from = connector.from.elementId;
    const to = connector.to.elementId;
    if ((from && wanted.has(from)) || (to && wanted.has(to))) result.push(connector.id);
  }
  return result;
}

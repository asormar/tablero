/**
 * Capa de conectores: SVG sobre el lienzo con las etiquetas de texto.
 *
 * Vive dentro del mundo (hereda el zoom) y no captura el puntero: el clic se
 * resuelve por geometría (`connectorAtPoint`), no por hit-testing del SVG. Las
 * etiquetas y el tirador de curvatura sí son nodos HTML (hermanos del SVG),
 * porque se editan con un input de verdad.
 *
 * Con zoom por debajo del umbral simplificado no se pintan etiquetas ni
 * tiradores: solo el trazo, más fino.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { type ConnectorGeometry, SIMPLIFIED_SCALE, isColorToken, shades } from '@tablero/shared';

import {
  arrowPaths,
  createRectResolver,
  geometryOf,
  registerConnectorNodes,
  releaseConnectorNodes,
  type ResolvedConnector,
} from '@/canvas/connectorGeometry';
import { canvasPoint } from '@/canvas/canvasRef';
import type { BoardSession } from '@/collab/BoardSession';
import { useSessionConnectors, useSessionLayout } from '@/collab/SessionContext';
import { patchConnector } from '@/lib/connectors';
import { useUiStore } from '@/state/uiStore';

/** Color del trazo: los tokens usan el matiz fuerte de la paleta. */
export function connectorColor(value: string): string {
  if (isColorToken(value)) return shades(value).strong;
  return value;
}

function dashArrayOf(dash: string, width: number): string | undefined {
  if (dash === 'dashed') return `${width * 3} ${width * 2}`;
  if (dash === 'dotted') return `0 ${width * 2.2}`;
  return undefined;
}

function labelTransform(point: { x: number; y: number }): string {
  return `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%)`;
}

type ConnectorPathsProps = {
  item: ResolvedConnector;
  selected: boolean;
  simplified: boolean;
};

function ConnectorPaths({ item, selected, simplified }: ConnectorPathsProps): JSX.Element {
  const { connector, geometry } = item;
  const pathRef = useRef<SVGPathElement | null>(null);
  const haloRef = useRef<SVGPathElement | null>(null);
  const startArrowRef = useRef<SVGPathElement | null>(null);
  const endArrowRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    registerConnectorNodes(connector.id, {
      path: pathRef.current,
      halo: haloRef.current,
      startArrow: startArrowRef.current,
      endArrow: endArrowRef.current,
    });
    return () => releaseConnectorNodes(connector.id, ['path', 'halo', 'startArrow', 'endArrow']);
  }, [connector.id]);

  const stroke = connectorColor(connector.style.color);
  const width = simplified ? Math.max(1, connector.style.width * 0.75) : connector.style.width;
  const arrows = arrowPaths(connector, geometry);

  return (
    <g className={selected ? 'conn is-selected' : 'conn'} data-connector-id={connector.id}>
      <path ref={haloRef} className="conn__halo" d={geometry.path} stroke={stroke} strokeWidth={width} />
      <path
        ref={pathRef}
        className="conn__line"
        data-connector-path={connector.id}
        d={geometry.path}
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dashArrayOf(connector.style.dash, width)}
        strokeLinecap="round"
      />
      {connector.style.startArrow !== 'none' ? (
        <path ref={startArrowRef} className="conn__arrow" d={arrows.startArrowPath} fill={stroke} />
      ) : null}
      {connector.style.endArrow !== 'none' ? (
        <path ref={endArrowRef} className="conn__arrow" d={arrows.endArrowPath} fill={stroke} />
      ) : null}
    </g>
  );
}

type ConnectorLabelProps = {
  session: BoardSession;
  item: ResolvedConnector;
  selected: boolean;
  editing: boolean;
  onEdit(id: string): void;
  onDone(): void;
};

function ConnectorLabel({ session, item, selected, editing, onEdit, onDone }: ConnectorLabelProps): JSX.Element {
  const { connector, geometry } = item;
  const node = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState(connector.label?.text ?? '');
  const point = {
    x: geometry.labelPoint.x + (connector.label?.dx ?? 0),
    y: geometry.labelPoint.y + (connector.label?.dy ?? 0),
  };

  useEffect(() => {
    registerConnectorNodes(connector.id, { label: node.current });
    return () => releaseConnectorNodes(connector.id, ['label']);
  }, [connector.id]);

  useEffect(() => {
    if (editing) setDraft(connector.label?.text ?? '');
  }, [editing, connector.label?.text]);

  const commit = (value: string): void => {
    patchConnector(session.doc, connector.id, { label: { text: value.trim(), dx: 0, dy: 0 } }, session.origin);
    onDone();
  };

  return (
    <div
      ref={node}
      className={`conn__label${selected ? ' is-selected' : ''}${connector.label?.text ? '' : ' is-empty'}`}
      style={{ transform: labelTransform(point) }}
      data-connector-label={connector.id}
      onPointerDown={(event) => {
        event.stopPropagation();
        useUiStore.getState().setSelectedConnector(connector.id);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onEdit(connector.id);
      }}
    >
      {editing ? (
        <input
          className="conn__label-input"
          autoFocus
          value={draft}
          placeholder="Etiqueta"
          aria-label="Etiqueta del conector"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(draft);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onDone();
            }
          }}
        />
      ) : (
        <span className="conn__label-text">{connector.label?.text ?? ''}</span>
      )}
    </div>
  );
}

type ConnectorHandleProps = {
  session: BoardSession;
  item: ResolvedConnector;
};

function ConnectorHandle({ session, item }: ConnectorHandleProps): JSX.Element {
  const { connector, geometry } = item;
  const node = useRef<HTMLDivElement | null>(null);
  const point = geometry.labelPoint;

  useEffect(() => {
    registerConnectorNodes(connector.id, { handle: node.current });
    return () => releaseConnectorNodes(connector.id, ['handle']);
  }, [connector.id]);

  const paint = (tension: number): void => {
    const resolve = createRectResolver(session.getLayout(), useUiStore.getState().measuredHeights);
    const next = geometryOf({ ...connector, style: { ...connector.style, tension } }, resolve);
    applyGeometry(connector.id, next, { x: next.labelPoint.x, y: next.labelPoint.y });
  };

  const start = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    const { start: from, end: to } = geometry;
    const span = Math.max(24, Math.hypot(to.x - from.x, to.y - from.y));
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const nx = -(to.y - from.y) / span;
    const ny = (to.x - from.x) / span;
    const tensionAt = (clientX: number, clientY: number): number => {
      const local = canvasPoint(clientX, clientY);
      const { viewport } = useUiStore.getState();
      const x = viewport.x + local.x / viewport.scale;
      const y = viewport.y + local.y / viewport.scale;
      const along = (x - mid.x) * nx + (y - mid.y) * ny;
      return Math.max(0, Math.min(1, Math.abs(along) / span));
    };
    const onMove = (move: PointerEvent): void => paint(tensionAt(move.clientX, move.clientY));
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      patchConnector(
        session.doc,
        connector.id,
        { style: { ...connector.style, tension: tensionAt(up.clientX, up.clientY) } },
        session.origin,
      );
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={node}
      className="conn__handle"
      style={{ transform: labelTransform({ x: point.x + 10, y: point.y + 10 }) }}
      title="Arrastrar para curvar"
      data-connector-handle={connector.id}
      onPointerDown={start}
    />
  );
}

/** Escribe la geometría en los nodos del DOM (seguimiento en vivo). */
export function applyGeometry(
  id: string,
  geometry: ConnectorGeometry,
  labelPoint: { x: number; y: number },
  arrows?: { startArrowPath: string; endArrowPath: string },
): void {
  const nodes = document.querySelectorAll<SVGPathElement>(`[data-connector-path="${CSS.escape(id)}"]`);
  nodes.forEach((node) => node.setAttribute('d', geometry.path));
  if (arrows) {
    const group = document.querySelector(`[data-connector-id="${CSS.escape(id)}"]`);
    const arrowNodes = group?.querySelectorAll<SVGPathElement>('.conn__arrow');
    arrowNodes?.forEach((node, index) => {
      node.setAttribute('d', index === 0 ? arrows.startArrowPath : arrows.endArrowPath);
    });
  }
  const label = document.querySelector<HTMLElement>(`[data-connector-label="${CSS.escape(id)}"]`);
  if (label) label.style.transform = labelTransform(labelPoint);
  const handle = document.querySelector<HTMLElement>(`[data-connector-handle="${CSS.escape(id)}"]`);
  if (handle) handle.style.transform = labelTransform({ x: labelPoint.x + 10, y: labelPoint.y + 10 });
}

export const ConnectorLayer = memo(function ConnectorLayer({ session }: { session: BoardSession }): JSX.Element | null {
  const connectors = useSessionConnectors();
  const layout = useSessionLayout();
  const measured = useUiStore((state) => state.measuredHeights);
  const viewport = useUiStore((state) => state.viewport);
  const canvasSize = useUiStore((state) => state.canvasSize);
  const selectedIds = useUiStore((state) => state.selectedConnectorIds);
  // El tirador de curvatura sigue al conector «principal» (el último elegido).
  const selectedId = useUiStore((state) => state.selectedConnectorId);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const simplified = viewport.scale < SIMPLIFIED_SCALE;
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const resolved = useMemo<ResolvedConnector[]>(() => {
    if (connectors.length === 0) return [];
    const resolve = createRectResolver(layout, measured);
    return connectors.map((connector) => ({ connector, geometry: geometryOf(connector, resolve) }));
    // El rectángulo del DOM cambia con el zoom, con el layout y con las alturas.
  }, [connectors, layout, measured, viewport.x, viewport.y, viewport.scale]);

  // Caja del SVG: cubre lo visible más lo que ocupan los conectores (sin recortes).
  const box = useMemo(() => {
    let minX = viewport.x;
    let minY = viewport.y;
    let maxX = viewport.x + canvasSize.width / viewport.scale;
    let maxY = viewport.y + canvasSize.height / viewport.scale;
    for (const item of resolved) {
      const points = [item.geometry.start, item.geometry.end, item.geometry.labelPoint];
      for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
    const pad = 80;
    return {
      x: Math.floor(minX - pad),
      y: Math.floor(minY - pad),
      width: Math.ceil(maxX - minX + pad * 2),
      height: Math.ceil(maxY - minY + pad * 2),
    };
  }, [resolved, viewport.x, viewport.y, viewport.scale, canvasSize.width, canvasSize.height]);

  if (resolved.length === 0) return null;

  return (
    <>
      <svg
        className="conn-layer"
        style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        aria-hidden="true"
      >
        {resolved.map((item) => (
          <ConnectorPaths
            key={item.connector.id}
            item={item}
            selected={selected.has(item.connector.id)}
            simplified={simplified}
          />
        ))}
      </svg>
      {simplified ? null : (
        <div className="conn-overlay">
          {resolved.map((item) => (
            <ConnectorLabel
              key={item.connector.id}
              session={session}
              item={item}
              selected={selected.has(item.connector.id)}
              editing={editingLabelId === item.connector.id}
              onEdit={(id) => setEditingLabelId(id)}
              onDone={() => setEditingLabelId(null)}
            />
          ))}
          {resolved
            .filter((item) => item.connector.id === selectedId)
            .map((item) => (
              <ConnectorHandle key={`handle-${item.connector.id}`} session={session} item={item} />
            ))}
        </div>
      )}
    </>
  );
});

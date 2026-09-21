/**
 * Panel de estilo del conector seleccionado.
 *
 * Aparece sobre el punto medio de la curva: tipo de trazo (recta/curada),
 * continuidad (continua/discontinua/punteada), grosor, color, puntas en cada
 * extremo y borrado. Cada cambio es una transacción (un paso de deshacer).
 */

import { useMemo } from 'react';

import {
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  Circle,
  Minus,
  MoveRight,
  Trash2,
} from 'lucide-react';

import { type ArrowKind, type ColorToken, DEFAULT_CONNECTOR_STYLE, type ConnectorStyle } from '@tablero/shared';

import { createRectResolver, geometryOf } from '@/canvas/connectorGeometry';
import { ColorPicker } from '@/chrome/ColorPicker';
import type { BoardSession } from '@/collab/BoardSession';
import { useSessionConnectors, useSessionLayout } from '@/collab/SessionContext';
import { patchConnector } from '@/lib/connectors';
import { deleteSelectedConnectors } from '@/canvas/connectorCommands';
import { useUiStore } from '@/state/uiStore';

const ARROW_OPTIONS: { kind: ArrowKind; label: string; icon: JSX.Element }[] = [
  { kind: 'none', label: 'Sin punta', icon: <Minus size={13} /> },
  { kind: 'arrow', label: 'Flecha', icon: <MoveRight size={13} /> },
  { kind: 'dot', label: 'Punto', icon: <Circle size={7} /> },
];

export function ConnectorBar({ session }: { session: BoardSession }): JSX.Element | null {
  const selectedId = useUiStore((state) => state.selectedConnectorId);
  const connectors = useSessionConnectors();
  const layout = useSessionLayout();
  const measured = useUiStore((state) => state.measuredHeights);
  const viewport = useUiStore((state) => state.viewport);
  const canvasSize = useUiStore((state) => state.canvasSize);

  const connector = useMemo(
    () => connectors.find((item) => item.id === selectedId) ?? null,
    [connectors, selectedId],
  );

  const geometry = useMemo(() => {
    if (!connector) return null;
    const resolve = createRectResolver(layout, measured);
    return geometryOf(connector, resolve);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector, layout, measured, viewport.scale]);

  if (!connector || !geometry) return null;

  const style = connector.style;
  const update = (patch: Partial<ConnectorStyle>): void => {
    patchConnector(session.doc, connector.id, { style: { ...style, ...patch } }, session.origin);
  };

  const screenX = (geometry.labelPoint.x - viewport.x) * viewport.scale;
  const screenY = (geometry.labelPoint.y - viewport.y) * viewport.scale;
  const half = 260;
  const left = Math.min(Math.max(screenX, half), Math.max(half, canvasSize.width - half));
  const top = Math.max(72, screenY - 54);

  return (
    <div
      className="ctxbar ctxbar--connector"
      style={{ left, top, transform: 'translate(-50%, -100%)' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="ctxbar__group">
        <button
          type="button"
          className={`icon-button${style.curve === 'straight' ? ' is-active' : ''}`}
          title="Línea recta"
          aria-pressed={style.curve === 'straight'}
          onClick={() => update({ curve: 'straight' })}
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          className={`icon-button${style.curve === 'curved' ? ' is-active' : ''}`}
          title="Línea curada"
          aria-pressed={style.curve === 'curved'}
          onClick={() => update({ curve: 'curved' })}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
            <path d="M2 12 Q 7.5 -2 13 12" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </div>

      <span className="ctxbar__sep" />

      <div className="ctxbar__group">
        {(['solid', 'dashed', 'dotted'] as const).map((dash) => (
          <button
            key={dash}
            type="button"
            className={`icon-button${style.dash === dash ? ' is-active' : ''}`}
            title={dash === 'solid' ? 'Continua' : dash === 'dashed' ? 'Discontinua' : 'Punteada'}
            aria-pressed={style.dash === dash}
            onClick={() => update({ dash })}
          >
            <svg width="18" height="15" viewBox="0 0 18 15" aria-hidden="true">
              <line
                x1="1"
                y1="7.5"
                x2="17"
                y2="7.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeDasharray={dash === 'dashed' ? '4 3' : dash === 'dotted' ? '0.1 4' : undefined}
                strokeLinecap="round"
              />
            </svg>
          </button>
        ))}
      </div>

      <span className="ctxbar__sep" />

      <div className="ctxbar__group">
        <button
          type="button"
          className="icon-button"
          title="Más fina"
          onClick={() => update({ width: Math.max(1, style.width - 1) })}
        >
          −
        </button>
        <span className="ctxbar__value" title="Grosor">
          {style.width}
        </span>
        <button
          type="button"
          className="icon-button"
          title="Más gruesa"
          onClick={() => update({ width: Math.min(8, style.width + 1) })}
        >
          +
        </button>
      </div>

      <span className="ctxbar__sep" />

      <div className="ctxbar__group">
        <ColorPicker
          value={style.color as ColorToken}
          onPick={(token) => update({ color: token })}
        />
      </div>

      <span className="ctxbar__sep" />

      <div className="ctxbar__group">
        {ARROW_OPTIONS.map((option) => (
          <button
            key={`start-${option.kind}`}
            type="button"
            className={`icon-button${style.startArrow === option.kind ? ' is-active' : ''}`}
            title={`Inicio: ${option.label}`}
            aria-pressed={style.startArrow === option.kind}
            onClick={() => update({ startArrow: option.kind })}
          >
            <ArrowLeft size={13} />
          </button>
        ))}
      </div>

      <div className="ctxbar__group">
        {ARROW_OPTIONS.map((option) => (
          <button
            key={`end-${option.kind}`}
            type="button"
            className={`icon-button${style.endArrow === option.kind ? ' is-active' : ''}`}
            title={`Fin: ${option.label}`}
            aria-pressed={style.endArrow === option.kind}
            onClick={() => update({ endArrow: option.kind })}
          >
            <ArrowRight size={13} />
          </button>
        ))}
      </div>

      <span className="ctxbar__sep" />

      <button
        type="button"
        className="icon-button"
        title="Invertir los extremos"
        onClick={() =>
          patchConnector(
            session.doc,
            connector.id,
            { from: connector.to, to: connector.from },
            session.origin,
          )
        }
      >
        <ArrowLeftRight size={14} />
      </button>
      <button
        type="button"
        className="icon-button"
        title="Restablecer el estilo"
        onClick={() => update({ ...DEFAULT_CONNECTOR_STYLE, endArrow: style.endArrow })}
      >
        ↺
      </button>
      <button
        type="button"
        className="icon-button icon-button--danger"
        title="Eliminar los conectores seleccionados (Supr)"
        onClick={() => {
          deleteSelectedConnectors(session);
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

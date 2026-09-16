/**
 * Superposiciones del lienzo: guías magnéticas, lazo de selección y rejilla.
 * Todas se pintan en coordenadas de pantalla (no heredan el zoom del lienzo),
 * calculadas a partir del viewport.
 */

import { memo } from 'react';

import { GRID_SIZE, type Guide, type Rect, type Viewport } from '@tablero/shared';

import { useUiStore } from '@/state/uiStore';

function toScreenX(viewport: Viewport, x: number): number {
  return (x - viewport.x) * viewport.scale;
}

function toScreenY(viewport: Viewport, y: number): number {
  return (y - viewport.y) * viewport.scale;
}

export const GuidesOverlay = memo(function GuidesOverlay(): JSX.Element | null {
  const guides = useUiStore((state) => state.guides);
  const viewport = useUiStore((state) => state.viewport);
  if (guides.length === 0) return null;

  return (
    <svg className="overlay overlay--guides" aria-hidden="true">
      {guides.map((guide: Guide, index) => {
        const className = guide.kind === 'center' ? 'guide guide--center' : 'guide';
        if (guide.axis === 'x') {
          const x = toScreenX(viewport, guide.position);
          return (
            <line
              key={`x-${index}`}
              className={className}
              x1={x}
              y1={toScreenY(viewport, guide.start)}
              x2={x}
              y2={toScreenY(viewport, guide.end)}
            />
          );
        }
        const y = toScreenY(viewport, guide.position);
        return (
          <line
            key={`y-${index}`}
            className={className}
            x1={toScreenX(viewport, guide.start)}
            y1={y}
            x2={toScreenX(viewport, guide.end)}
            y2={y}
          />
        );
      })}
    </svg>
  );
});

export const MarqueeOverlay = memo(function MarqueeOverlay(): JSX.Element | null {
  const marquee = useUiStore((state) => state.marquee);
  const viewport = useUiStore((state) => state.viewport);
  if (!marquee) return null;
  const rect: Rect = marquee;
  return (
    <div
      className="overlay overlay--marquee"
      style={{
        left: toScreenX(viewport, rect.x),
        top: toScreenY(viewport, rect.y),
        width: rect.width * viewport.scale,
        height: rect.height * viewport.scale,
      }}
    />
  );
});

/**
 * Rejilla de puntos. Se dibuja como fondo del área visible (fija), con el paso
 * escalado y desplazada según el viewport: siempre nítida, sin nodos extra.
 */
export const CanvasGrid = memo(function CanvasGrid(): JSX.Element {
  const viewport = useUiStore((state) => state.viewport);
  const step = GRID_SIZE * 4 * viewport.scale;
  const visible = step >= 6;
  return (
    <div
      className="canvas__grid"
      aria-hidden="true"
      style={
        visible
          ? {
              backgroundSize: `${step}px ${step}px`,
              backgroundPosition: `${-viewport.x * viewport.scale}px ${-viewport.y * viewport.scale}px`,
            }
          : { backgroundImage: 'none' }
      }
    />
  );
});

/**
 * Línea de inserción del kanban y de las listas de tareas. Va en coordenadas de
 * pantalla (no hereda el zoom): es una guía de 1–2 px, siempre legible.
 */
export const DropLineOverlay = memo(function DropLineOverlay(): JSX.Element | null {
  const line = useUiStore((state) => state.dropLine);
  if (!line) return null;
  return (
    <div
      className="drop-line"
      aria-hidden="true"
      style={{ left: line.x, top: line.y, width: line.width }}
    />
  );
});

/** Línea provisional mientras se dibuja un conector desde el borde de una tarjeta. */
export const ConnectorDraftOverlay = memo(function ConnectorDraftOverlay(): JSX.Element | null {
  const draft = useUiStore((state) => state.connectorDraft);
  if (!draft) return null;
  return (
    <svg className="overlay overlay--connector" aria-hidden="true">
      <line className="conn-draft" x1={draft.x1} y1={draft.y1} x2={draft.x2} y2={draft.y2} />
      <circle className="conn-draft__end" cx={draft.x2} cy={draft.y2} r={3.5} />
    </svg>
  );
});

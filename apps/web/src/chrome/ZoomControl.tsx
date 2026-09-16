/**
 * Control de zoom (abajo a la derecha del lienzo) y su versión compacta para la
 * barra superior. El rango va del 10 % al 400 % (MIN_SCALE/MAX_SCALE).
 */

import { Maximize2, Minus, Plus } from 'lucide-react';

import { formatZoom } from '@tablero/shared';

import { fitToScreen } from '@/canvas/commands';
import type { BoardSession } from '@/collab/BoardSession';
import { useUiStore } from '@/state/uiStore';

function useZoomAnchor(): { x: number; y: number } {
  const width = useUiStore((state) => state.canvasSize.width);
  const height = useUiStore((state) => state.canvasSize.height);
  return { x: width / 2, y: height / 2 };
}

export function ZoomControl({ session }: { session: BoardSession }): JSX.Element {
  const scale = useUiStore((state) => state.viewport.scale);
  const anchor = useZoomAnchor();

  return (
    <div className="zoom" role="group" aria-label="Zoom">
      <button
        type="button"
        className="zoom__button"
        title="Alejar (−)"
        onClick={() => useUiStore.getState().zoomStep(-1, anchor)}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="zoom__value"
        title="Restablecer al 100 % (Ctrl+0)"
        onClick={() => useUiStore.getState().zoomAtPoint(anchor, 1)}
      >
        {formatZoom(scale)}
      </button>
      <button
        type="button"
        className="zoom__button"
        title="Acercar (+)"
        onClick={() => useUiStore.getState().zoomStep(1, anchor)}
      >
        <Plus size={14} />
      </button>
      <span className="zoom__separator" aria-hidden="true" />
      <button
        type="button"
        className="zoom__button"
        title="Ajustar a pantalla (Shift+1)"
        onClick={() => fitToScreen(session)}
      >
        <Maximize2 size={14} />
      </button>
    </div>
  );
}

export function ZoomControlCompact({ session }: { session: BoardSession }): JSX.Element {
  const scale = useUiStore((state) => state.viewport.scale);
  const anchor = useZoomAnchor();
  return (
    <div className="zoom zoom--compact" role="group" aria-label="Zoom">
      <button
        type="button"
        className="zoom__button"
        title="Alejar (−)"
        onClick={() => useUiStore.getState().zoomStep(-1, anchor)}
      >
        <Minus size={13} />
      </button>
      <button
        type="button"
        className="zoom__value"
        title="Restablecer al 100 % (Ctrl+0)"
        onClick={() => useUiStore.getState().zoomAtPoint(anchor, 1)}
      >
        {formatZoom(scale)}
      </button>
      <button
        type="button"
        className="zoom__button"
        title="Acercar (+)"
        onClick={() => useUiStore.getState().zoomStep(1, anchor)}
      >
        <Plus size={13} />
      </button>
      <button
        type="button"
        className="zoom__button"
        title="Ajustar a pantalla (Shift+1)"
        onClick={() => fitToScreen(session)}
      >
        <Maximize2 size={13} />
      </button>
    </div>
  );
}

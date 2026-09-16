/**
 * Editor de recorte (no destructivo).
 *
 * Se arrastra un rectángulo sobre la imagen con guías de aspecto; al aceptar se
 * guardan las **fracciones** del original en `crop` (el archivo nunca se toca).
 * Todas las interacciones usan Pointer Events (el lienzo ya lo hace así) y el
 * cambio se escribe en una sola transacción.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Check, RotateCcw, X } from 'lucide-react';

import { type ImageCrop, type Rect, FULL_CROP, assetRoutes, cropSourceRect } from '@tablero/shared';

import { setElementCrop } from '@/canvas/contentCommands';
import type { BoardSession } from '@/collab/BoardSession';
import { useSessionElement } from '@/collab/SessionContext';
import {
  CROP_ASPECTS,
  applyAspect,
  clampRectToBox,
  cropFromViewRect,
  cropViewRect,
  rectFromDrag,
  resizeCropRect,
  type CropHandle,
} from '@/lib/cropMath';
import { useAsset } from '@/state/assetStore';
import { useUiStore } from '@/state/uiStore';

/** Tamaño máximo del área de trabajo (px). */
const WORK_MAX_WIDTH = 860;
const WORK_MAX_HEIGHT = 560;

export function CropEditor({ session }: { session: BoardSession }): JSX.Element | null {
  const targetId = useUiStore((state) => state.cropTargetId);
  const closeCropEditor = useUiStore((state) => state.closeCropEditor);
  const element = useSessionElement(targetId ?? '');
  const assetEntry = useAsset(element && element.type === 'image' ? element.assetId : null);
  const asset = assetEntry.asset;

  const natural = useMemo(() => {
    if (element && element.type === 'image' && element.naturalWidth && element.naturalHeight) {
      return { width: element.naturalWidth, height: element.naturalHeight };
    }
    if (asset?.width && asset.height) return { width: asset.width, height: asset.height };
    return null;
  }, [element, asset]);

  // Tamaño con el que se muestra la imagen (vista) dentro del área de trabajo.
  const view = useMemo(() => {
    if (!natural) return { width: WORK_MAX_WIDTH, height: WORK_MAX_HEIGHT };
    const scale = Math.min(WORK_MAX_WIDTH / natural.width, WORK_MAX_HEIGHT / natural.height, 1);
    return { width: Math.max(40, natural.width * scale), height: Math.max(40, natural.height * scale) };
  }, [natural]);

  const crop: ImageCrop = element && element.type === 'image' ? element.crop ?? FULL_CROP : FULL_CROP;
  const [rect, setRect] = useState<Rect>(() => cropViewRect(crop, {
    width: natural?.width ?? WORK_MAX_WIDTH,
    height: natural?.height ?? WORK_MAX_HEIGHT,
  }));
  const [aspect, setAspect] = useState<number | null>(null);
  const [mode, setMode] = useState<'idle' | 'move' | 'create' | 'resize'>('idle');
  type DragState =
    | { kind: 'move'; start: { x: number; y: number } }
    | { kind: 'create'; start: { x: number; y: number } }
    | { kind: 'resize'; corner: CropHandle };
  const dragState = useRef<DragState | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Al abrir (o cambiar de imagen) el rectángulo parte del recorte actual.
  useEffect(() => {
    if (!targetId) return;
    setRect(cropViewRect(crop, view));
    setAspect(null);
    setMode('idle');
    // Solo al cambiar de objetivo: los cambios siguientes los mueve el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, view.width, view.height]);

  useEffect(() => {
    if (!targetId) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCropEditor();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [targetId, closeCropEditor]);

  const pointerToLocal = useCallback(
    (event: React.PointerEvent | PointerEvent): { x: number; y: number } => {
      const node = surfaceRef.current;
      if (!node) return { x: 0, y: 0 };
      const box = node.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    },
    [],
  );

  const onPointerDown = (event: React.PointerEvent): void => {
    if (!natural) return;
    const local = pointerToLocal(event);
    const box = { width: view.width, height: view.height };
    const target = event.target as HTMLElement;
    const handle = target.dataset['handle'];
    (target.closest('.crop-editor__surface') as HTMLElement | null)?.setPointerCapture(event.pointerId);

    if (handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se') {
      dragState.current = { kind: 'resize', corner: handle };
      setMode('resize');
      return;
    }

    const inside =
      local.x >= rect.x &&
      local.x <= rect.x + rect.width &&
      local.y >= rect.y &&
      local.y <= rect.y + rect.height;
    if (inside) {
      dragState.current = { kind: 'move', start: local };
      setMode('move');
      return;
    }
    // Fuera del rectángulo: se empieza uno nuevo desde este punto.
    dragState.current = { kind: 'create', start: local };
    setMode('create');
    setRect(rectFromDrag(local, local, box));
  };

  const onPointerMove = (event: React.PointerEvent): void => {
    const state = dragState.current;
    if (!state) return;
    const local = pointerToLocal(event);
    const box = { width: view.width, height: view.height };
    if (state.kind === 'move') {
      const dx = local.x - state.start.x;
      const dy = local.y - state.start.y;
      state.start = local;
      setRect((current) => clampRectToBox({ ...current, x: current.x + dx, y: current.y + dy }, box));
      return;
    }
    if (state.kind === 'create') {
      setRect(rectFromDrag(state.start, local, box));
      return;
    }
    setRect((current) => resizeCropRect(current, state.corner, local, box, aspect));
  };

  const onPointerUp = (): void => {
    dragState.current = null;
    setMode('idle');
  };

  const applyAspectChoice = (value: number | null): void => {
    setAspect(value);
    if (!natural) return;
    const box = { width: view.width, height: view.height };
    setRect((current) => clampRectToBox(applyAspect(current, value, box), box));
  };

  const accept = (): void => {
    if (!element || element.type !== 'image' || !natural) {
      closeCropEditor();
      return;
    }
    const next = cropFromViewRect(rect, view);
    setElementCrop(session, element.id, next);
    closeCropEditor();
  };

  const reset = (): void => {
    if (!natural) return;
    setRect({ x: 0, y: 0, width: view.width, height: view.height });
    setAspect(null);
  };

  if (!targetId || !element || element.type !== 'image') return null;

  const source = natural ? cropSourceRect(cropFromViewRect(rect, view), natural.width, natural.height) : null;
  const url = asset?.url ?? assetRoutes.raw(element.assetId);

  return (
    <div className="crop-editor" role="dialog" aria-modal="true" aria-label="Recortar imagen">
      <div className="crop-editor__panel">
        <header className="crop-editor__head">
          <h2 className="crop-editor__title">Recortar imagen</h2>
          <div className="crop-editor__aspects" role="group" aria-label="Aspecto del recorte">
            {CROP_ASPECTS.map((option) => (
              <button
                key={option.label}
                type="button"
                className={option.value === aspect ? 'is-active' : undefined}
                onClick={() => applyAspectChoice(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="crop-editor__actions">
            <button type="button" className="icon-button" title="Restablecer" onClick={reset}>
              <RotateCcw size={15} />
            </button>
            <button type="button" className="crop-editor__cancel" onClick={closeCropEditor}>
              <X size={14} /> Cancelar
            </button>
            <button type="button" className="crop-editor__accept" onClick={accept}>
              <Check size={14} /> Aplicar
            </button>
          </div>
        </header>

        <div className="crop-editor__stage">
          <div
            className="crop-editor__surface"
            ref={surfaceRef}
            style={{ width: view.width, height: view.height }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img className="crop-editor__image" src={url} alt="" draggable={false} />
            <div
              className="crop-editor__selection"
              data-mode={mode}
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            >
              <span className="crop-editor__handle crop-editor__handle--nw" data-handle="nw" />
              <span className="crop-editor__handle crop-editor__handle--ne" data-handle="ne" />
              <span className="crop-editor__handle crop-editor__handle--sw" data-handle="sw" />
              <span className="crop-editor__handle crop-editor__handle--se" data-handle="se" />
            </div>
          </div>
        </div>

        <footer className="crop-editor__foot">
          <span>
            Recorte: {source ? `${source.width} × ${source.height} px de ${natural?.width} × ${natural?.height}` : '—'}
          </span>
          <span className="crop-editor__hint">
            Arrastrá para mover o dibujar el recorte; el original no se modifica.
          </span>
        </footer>
      </div>
    </div>
  );
}

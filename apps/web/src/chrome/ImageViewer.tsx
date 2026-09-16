/**
 * Visor de imágenes a pantalla completa.
 *
 * Zoom (rueda, botones, 1:1 y encajar), paneo con puntero, navegación con las
 * flechas entre las imágenes del tablero, descarga, recorte y paleta. Se abre
 * con doble clic en una imagen o desde los botones de la tarjeta.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ChevronLeft,
  ChevronRight,
  Crop,
  Download,
  Maximize2,
  Minus,
  Palette,
  Plus,
  Square,
  X,
} from 'lucide-react';

import { assetRoutes, cropAspectRatio, isFullCrop } from '@tablero/shared';

import { createSwatchesForPalette } from '@/canvas/contentCommands';
import type { BoardSession } from '@/collab/BoardSession';
import { useSessionElement, useSessionLayout } from '@/collab/SessionContext';
import { extractPalette, type PaletteEntry } from '@/lib/palette';
import { fitZoom, stepViewer, stepZoom, viewerSequence } from '@/lib/viewerNav';
import { useAsset } from '@/state/assetStore';
import { useUiStore } from '@/state/uiStore';

const MIN_FIT = 0.05;

export function ImageViewer({ session }: { session: BoardSession }): JSX.Element | null {
  const viewerId = useUiStore((state) => state.viewerId);
  const closeViewer = useUiStore((state) => state.closeViewer);
  const openCropEditor = useUiStore((state) => state.openCropEditor);
  const layout = useSessionLayout();
  const element = useSessionElement(viewerId ?? '');
  const assetEntry = useAsset(element && element.type === 'image' ? element.assetId : null);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [palette, setPalette] = useState<PaletteEntry[] | null>(null);

  const imageIds = useMemo(() => viewerSequence(layout, 'image'), [layout]);
  const index = viewerId ? imageIds.indexOf(viewerId) : -1;

  const asset = assetEntry.asset;
  const url = element && element.type === 'image' ? asset?.url ?? assetRoutes.raw(element.assetId) : '';
  const natural = useMemo(() => {
    if (element && element.type === 'image' && element.naturalWidth && element.naturalHeight) {
      return { width: element.naturalWidth, height: element.naturalHeight };
    }
    if (asset?.width && asset.height) return { width: asset.width, height: asset.height };
    return null;
  }, [element, asset]);
  const aspect =
    element && element.type === 'image' && element.crop && !isFullCrop(element.crop) && natural
      ? cropAspectRatio(element.crop, natural.width, natural.height)
      : natural
        ? natural.width / natural.height
        : 1.5;

  // Tamaño de la caja (para encajar la imagen y para el paneo).
  useEffect(() => {
    const measure = (): void => {
      const node = boxRef.current;
      if (!node) return;
      setBox({ width: node.clientWidth, height: node.clientHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [viewerId]);

  // Al cambiar de imagen se vuelve a encajar la vista.
  useEffect(() => {
    setZoom(null);
    setOffset({ x: 0, y: 0 });
    setPalette(null);
  }, [viewerId]);

  // Zoom de encaje: la imagen entra completa sin ampliarse por encima del 100 %.
  const fit = useMemo(() => {
    if (box.width === 0 || box.height === 0) return 1;
    const target = natural ?? { width: box.width, height: box.height };
    return fitZoom(target, { width: box.width * 0.92, height: box.height * 0.92 });
  }, [natural, box.width, box.height]);

  const effectiveZoom = zoom ?? fit;
  const displayWidth = (natural?.width ?? box.width) * effectiveZoom;
  const displayHeight = (natural?.height ?? box.height) * effectiveZoom;

  const go = useCallback(
    (direction: 1 | -1) => {
      const next = stepViewer(imageIds, viewerId ?? '', direction);
      if (next) useUiStore.getState().openViewer(next);
    },
    [imageIds, viewerId],
  );

  useEffect(() => {
    if (!viewerId) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeViewer();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        go(1);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(-1);
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoom((current) => stepZoom(current ?? fit, 1));
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        setZoom((current) => stepZoom(current ?? fit, -1));
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [viewerId, closeViewer, go, fit]);

  const onWheel = (event: React.WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0018);
    setZoom((current) => Math.max(MIN_FIT, Math.min(8, (current ?? fit) * factor)));
  };

  const loadPalette = (): void => {
    if (url.length === 0) return;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => setPalette(extractPalette(image, 6));
    image.onerror = () => setPalette([]);
    image.src = url;
  };

  if (!viewerId || !element || element.type !== 'image') return null;

  const caption = element.caption ?? '';

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Visor de imagen">
      <div className="viewer__bar" onPointerDown={(event) => event.stopPropagation()}>
        <span className="viewer__counter">
          {index >= 0 ? `${index + 1} / ${imageIds.length}` : '1 / 1'}
        </span>
        <span className="viewer__title" title={asset?.originalName ?? ''}>
          {caption.length > 0 ? caption : asset?.originalName ?? 'Imagen'}
        </span>
        <div className="viewer__actions">
          <button type="button" className="icon-button" title="Alejar (-)" onClick={() => setZoom((z) => stepZoom(z ?? fit, -1))}>
            <Minus size={15} />
          </button>
          <span className="viewer__zoom">{Math.round(effectiveZoom * 100)} %</span>
          <button type="button" className="icon-button" title="Acercar (+)" onClick={() => setZoom((z) => stepZoom(z ?? fit, 1))}>
            <Plus size={15} />
          </button>
          <button type="button" className="icon-button" title="Tamaño real (0)" onClick={() => setZoom(1)}>
            <Square size={15} />
          </button>
          <button type="button" className="icon-button" title="Encajar en la pantalla" onClick={() => setZoom(null)}>
            <Maximize2 size={15} />
          </button>
          <button type="button" className="icon-button" title="Extraer la paleta" onClick={loadPalette}>
            <Palette size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Recortar"
            onClick={() => openCropEditor(element.id)}
          >
            <Crop size={15} />
          </button>
          <a
            className="icon-button"
            title="Descargar"
            href={url}
            download={asset?.originalName ?? undefined}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Download size={15} />
          </a>
          <button type="button" className="icon-button" title="Cerrar (Esc)" onClick={closeViewer}>
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="viewer__stage" ref={boxRef}>
        <button
          type="button"
          className="viewer__nav viewer__nav--prev"
          title="Anterior (←)"
          onClick={() => go(-1)}
        >
          <ChevronLeft size={22} />
        </button>

        <div
          className="viewer__canvas"
          style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
          onWheel={onWheel}
          onPointerDown={(event) => {
            drag.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            setOffset({ x: event.clientX - start.x, y: event.clientY - start.y });
          }}
          onPointerUp={(event) => {
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <img
            className="viewer__image"
            src={url}
            alt={caption.length > 0 ? caption : 'Imagen'}
            draggable={false}
            style={{
              width: `${displayWidth}px`,
              height: `${displayHeight}px`,
              transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
            }}
          />
        </div>

        <button
          type="button"
          className="viewer__nav viewer__nav--next"
          title="Siguiente (→)"
          onClick={() => go(1)}
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {palette ? (
        <div className="viewer__palette">
          {palette.length === 0 ? (
            <span className="viewer__palette-hint">No se pudo leer la paleta de esta imagen</span>
          ) : (
            <>
              {palette.map((entry) => (
                <span
                  key={entry.hex}
                  className="viewer__chip"
                  style={{ background: entry.hex }}
                  title={`${entry.hex} · ${Math.round(entry.ratio * 100)} %`}
                />
              ))}
              <button
                type="button"
                className="viewer__palette-action"
                onClick={() => {
                  createSwatchesForPalette(session, element.id, palette);
                  closeViewer();
                }}
              >
                Crear muestras de color
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

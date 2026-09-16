/**
 * Tarjetas de archivo de la fase 2: imagen, vídeo, audio y archivo.
 *
 * La imagen respeta el recorte no destructivo (fracciones del original) sin
 * deformar: la caja de la tarjeta toma el aspecto del recorte y la imagen se
 * escala y desplaza dentro. El vídeo y el audio usan los controles nativos del
 * navegador con el póster de la API, y el archivo muestra icono por extensión,
 * nombre y tamaño (con miniatura y visor si es un PDF).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import {
  Archive,
  Check,
  Crop,
  Download,
  ExternalLink,
  Expand,
  FileText,
  Frame,
  ImageOff,
  Maximize2,
  Palette,
  Pause,
  Play,
  Table2,
} from 'lucide-react';

import {
  type AssetSummary,
  type CanvasElement,
  FALLBACK_ASPECT,
  FULL_CROP,
  PDF_MIME_TYPE,
  assetRoutes,
  cropAspectRatio,
  extensionForMime,
  formatBytes,
  formatDuration,
  isFullCrop,
} from '@tablero/shared';

import {
  createSwatchesForPalette,
  updateAssetElement,
} from '@/canvas/contentCommands';
import type { BoardSession } from '@/collab/BoardSession';
import { InlineEdit } from '@/elements/InlineEdit';
import { extractPalette, type PaletteEntry } from '@/lib/palette';
import { peaksForUrl } from '@/lib/waveform';
import { useAsset } from '@/state/assetStore';
import { useUiStore } from '@/state/uiStore';

import { EmptyAssetCard, MissingAssetCard, UploadProgressCard } from './AssetStates';
import { PdfCanvas } from './PdfPreview';
import { useUploadEntry } from '@/state/uploadStore';

export type CardProps = {
  session: BoardSession;
  element: CanvasElement;
  simplified: boolean;
};

function naturalSize(element: CanvasElement, asset: AssetSummary | null): { width: number; height: number } | null {
  const width = element.type === 'image' || element.type === 'video' ? element.naturalWidth : undefined;
  const height = element.type === 'image' || element.type === 'video' ? element.naturalHeight : undefined;
  if (width && height && width > 0 && height > 0) return { width, height };
  if (asset?.width && asset.height) return { width: asset.width, height: asset.height };
  return null;
}

/** Pie de foto editable (imagen, vídeo y audio). */
function MediaCaption({
  session,
  element,
  placeholder,
}: {
  session: BoardSession;
  element: CanvasElement;
  placeholder: string;
}): JSX.Element {
  const value = element.type === 'image' || element.type === 'video' || element.type === 'audio'
    ? element.caption ?? ''
    : '';
  return (
    <div className="media-caption">
      <InlineEdit
        value={value}
        placeholder={placeholder}
        ariaLabel="Pie de foto"
        multiline
        className="media-caption__input"
        onCommit={(next) => updateAssetElement(session, element.id, { caption: next })}
      />
    </div>
  );
}

/** Botones de la tarjeta (aparecen al seleccionarla). */
function CardTools({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="card-tools" onPointerDown={(event) => event.stopPropagation()}>
      {children}
    </div>
  );
}

// --- Imagen -----------------------------------------------------------------

export function ImageCard({ session, element, simplified }: CardProps): JSX.Element {
  const assetId = element.type === 'image' ? element.assetId : '';
  const assetEntry = useAsset(assetId);
  const upload = useUploadEntry(element.id);
  const openViewer = useUiStore((state) => state.openViewer);
  const openCropEditor = useUiStore((state) => state.openCropEditor);
  const paletteOpen = useUiStore((state) => state.paletteTargetId === element.id);
  const setPaletteTarget = useUiStore((state) => state.setPaletteTarget);

  const asset = assetEntry.asset;
  const rawUrl = asset?.url ?? (assetId.length > 0 ? assetRoutes.raw(assetId) : '');
  const crop = element.type === 'image' ? element.crop : undefined;
  const cropped = Boolean(crop) && !isFullCrop(crop);
  const natural = naturalSize(element, asset);
  const aspect = natural
    ? cropped && crop
      ? cropAspectRatio(crop, natural.width, natural.height)
      : natural.width / natural.height
    : FALLBACK_ASPECT;
  const caption = element.type === 'image' ? element.caption ?? '' : '';
  const frameless = element.type === 'image' && element.frameless === true;
  const activeCrop = cropped && crop ? crop : FULL_CROP;

  // Medidas reales: si el elemento no las tiene, se guardan al cargar la imagen
  // (el recorte y la altura de la tarjeta dependen de ellas).
  const onLoadImage = (event: React.SyntheticEvent<HTMLImageElement>): void => {
    const node = event.currentTarget;
    if (node.naturalWidth <= 0) return;
    if (element.type !== 'image') return;
    if (element.naturalWidth === node.naturalWidth && element.naturalHeight === node.naturalHeight) return;
    updateAssetElement(session, element.id, {
      naturalWidth: node.naturalWidth,
      naturalHeight: node.naturalHeight,
    });
  };

  if (upload && upload.status !== 'ready') return <UploadProgressCard entry={upload} width={element.width} />;
  if (assetId.length === 0) return <EmptyAssetCard session={session} element={element} kind="image" />;
  if (assetEntry.status === 'missing') return <MissingAssetCard message="La imagen ya no está en el servidor" />;

  const mediaStyle: CSSProperties = { aspectRatio: `${aspect}` };
  const imageStyle: CSSProperties = cropped
    ? {
        position: 'absolute',
        width: `${100 / activeCrop.width}%`,
        height: `${100 / activeCrop.height}%`,
        left: `${(-activeCrop.x * 100) / activeCrop.width}%`,
        top: `${(-activeCrop.y * 100) / activeCrop.height}%`,
      }
    : { display: 'block', width: '100%', height: 'auto' };

  return (
    <div className={`image-card${frameless ? ' is-frameless' : ''}`}>
      <div className="image-card__media" style={mediaStyle}>
        {rawUrl.length > 0 ? (
          <img
            className="image-card__img"
            src={rawUrl}
            alt={caption.length > 0 ? caption : 'Imagen'}
            style={imageStyle}
            draggable={false}
            loading="lazy"
            onLoad={onLoadImage}
            onDoubleClick={() => openViewer(element.id)}
          />
        ) : (
          <div className="image-card__broken">
            <ImageOff size={18} />
          </div>
        )}
        {upload && upload.status === 'ready' ? (
          <span className="image-card__badge">
            <Check size={12} /> Listo
          </span>
        ) : null}
      </div>

      {!simplified ? (
        <>
          <CardTools>
            <button type="button" title="Ver a pantalla completa (clic)" onClick={() => openViewer(element.id)}>
              <Maximize2 size={13} />
            </button>
            <button type="button" title="Recortar" onClick={() => openCropEditor(element.id)}>
              <Crop size={13} />
            </button>
            <button
              type="button"
              title="Extraer la paleta"
              className={paletteOpen ? 'is-active' : undefined}
              onClick={() => setPaletteTarget(paletteOpen ? null : element.id)}
            >
              <Palette size={13} />
            </button>
            <button
              type="button"
              title={frameless ? 'Poner marco' : 'Quitar marco'}
              className={frameless ? 'is-active' : undefined}
              onClick={() => updateAssetElement(session, element.id, { frameless: !frameless })}
            >
              <Frame size={13} />
            </button>
            <a
              className="card-tools__link"
              title="Descargar"
              href={rawUrl}
              download={asset?.originalName ?? undefined}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Download size={13} />
            </a>
          </CardTools>
          <MediaCaption session={session} element={element} placeholder="Añade un pie de foto…" />
          {paletteOpen ? (
            <PaletteStrip session={session} elementId={element.id} url={rawUrl} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Tira de colores dominantes con la opción de crear muestras al lado. */
function PaletteStrip({
  session,
  elementId,
  url,
}: {
  session: BoardSession;
  elementId: string;
  url: string;
}): JSX.Element {
  const [entries, setEntries] = useState<PaletteEntry[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) return;
      setEntries(extractPalette(image, 5));
    };
    image.onerror = () => {
      if (!cancelled) setEntries([]);
    };
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  const create = (): void => {
    if (!entries || entries.length === 0) return;
    setCreating(true);
    createSwatchesForPalette(session, elementId, entries);
    setTimeout(() => setCreating(false), 800);
  };

  return (
    <div className="palette-strip">
      {entries === null ? (
        <span className="palette-strip__hint">Analizando la imagen…</span>
      ) : entries.length === 0 ? (
        <span className="palette-strip__hint">No se pudo leer la paleta</span>
      ) : (
        <>
          {entries.map((entry) => (
            <button
              key={entry.hex}
              type="button"
              className="palette-strip__chip"
              style={{ background: entry.hex }}
              title={`${entry.hex} · ${Math.round(entry.ratio * 100)} %`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                void navigator.clipboard?.writeText(entry.hex).catch(() => undefined);
              }}
            />
          ))}
          <button
            type="button"
            className="palette-strip__action"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={create}
          >
            {creating ? 'Creadas' : 'Crear muestras'}
          </button>
        </>
      )}
    </div>
  );
}

// --- Vídeo ------------------------------------------------------------------

export function VideoCard({ session, element, simplified }: CardProps): JSX.Element {
  const assetId = element.type === 'video' ? element.assetId : '';
  const assetEntry = useAsset(assetId);
  const upload = useUploadEntry(element.id);
  const asset = assetEntry.asset;
  const rawUrl = asset?.url ?? (assetId.length > 0 ? assetRoutes.raw(assetId) : '');
  const [duration, setDuration] = useState<number | null>(asset?.duration ?? null);
  const natural = naturalSize(element, asset);
  const aspect = natural ? natural.width / natural.height : 16 / 10;

  if (upload && upload.status !== 'ready') return <UploadProgressCard entry={upload} width={element.width} />;
  if (assetId.length === 0) return <EmptyAssetCard session={session} element={element} kind="video" />;
  if (assetEntry.status === 'missing') return <MissingAssetCard message="El vídeo ya no está en el servidor" />;

  const seconds = duration ?? asset?.duration ?? null;

  return (
    <div className="video-card">
      <div className="video-card__media" style={{ aspectRatio: `${aspect}` }}>
        {rawUrl.length > 0 ? (
          <video
            className="video-card__player"
            src={rawUrl}
            poster={asset?.thumbnailUrl ?? undefined}
            controls
            preload="metadata"
            playsInline
            onPointerDown={(event) => event.stopPropagation()}
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              if (Number.isFinite(value) && value > 0) setDuration(value);
            }}
          />
        ) : null}
      </div>
      {!simplified ? (
        <>
          <div className="video-card__bar">
            <span className="video-card__duration">{formatDuration(seconds)}</span>
            <a
              className="video-card__link"
              href={rawUrl}
              download={asset?.originalName ?? undefined}
              target="_blank"
              rel="noreferrer"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Download size={13} /> Descargar
            </a>
          </div>
          <MediaCaption session={session} element={element} placeholder="Añade un pie de foto…" />
        </>
      ) : null}
    </div>
  );
}

// --- Audio ------------------------------------------------------------------

export function AudioCard({ session, element, simplified }: CardProps): JSX.Element {
  const assetId = element.type === 'audio' ? element.assetId : '';
  const assetEntry = useAsset(assetId);
  const upload = useUploadEntry(element.id);
  const asset = assetEntry.asset;
  const rawUrl = asset?.url ?? (assetId.length > 0 ? assetRoutes.raw(assetId) : '');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState<number | null>(asset?.duration ?? null);

  useEffect(() => {
    if (rawUrl.length === 0) return undefined;
    let cancelled = false;
    void peaksForUrl(rawUrl, 72).then((result) => {
      if (!cancelled) setPeaks(result);
    });
    return () => {
      cancelled = true;
    };
  }, [rawUrl]);

  const seconds = duration ?? asset?.duration ?? null;

  if (upload && upload.status !== 'ready') return <UploadProgressCard entry={upload} width={element.width} />;
  if (assetId.length === 0) return <EmptyAssetCard session={session} element={element} kind="audio" />;
  if (assetEntry.status === 'missing') return <MissingAssetCard message="El audio ya no está en el servidor" />;

  const toggle = (): void => {
    const node = audioRef.current;
    if (!node) return;
    if (node.paused) void node.play().catch(() => undefined);
    else node.pause();
  };

  return (
    <div className="audio-card">
      <div className="audio-card__body">
        <button
          type="button"
          className="audio-card__play"
          title={playing ? 'Pausar' : 'Reproducir'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={toggle}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button
          type="button"
          className="audio-card__wave"
          title="Reproducir"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={toggle}
        >
          <Waveform peaks={peaks} />
        </button>
        <span className="audio-card__duration">{formatDuration(seconds)}</span>
      </div>
      <audio
        ref={audioRef}
        src={rawUrl}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
      />
      {!simplified ? (
        <MediaCaption session={session} element={element} placeholder="Añade un pie de foto…" />
      ) : null}
    </div>
  );
}

/** Onda del audio: picos normalizados como barras verticales. */
function Waveform({ peaks }: { peaks: number[] }): JSX.Element {
  const bars = useMemo(() => {
    if (peaks.length === 0) return [];
    return peaks.map((peak, index) => ({ index, height: Math.max(6, Math.round(peak * 100)) }));
  }, [peaks]);

  return (
    <span className="waveform" aria-hidden="true">
      {bars.length === 0 ? (
        <span className="waveform__placeholder">
          {Array.from({ length: 28 }, (_, index) => (
            <span key={index} className="waveform__bar" style={{ height: '22%' }} />
          ))}
        </span>
      ) : (
        bars.map((bar) => <span key={bar.index} className="waveform__bar" style={{ height: `${bar.height}%` }} />)
      )}
    </span>
  );
}

// --- Archivo ----------------------------------------------------------------

const FILE_ICON_BY_KIND: { matches: RegExp; icon: JSX.Element }[] = [
  { matches: /^(pdf)$/i, icon: <FileText size={18} /> },
  { matches: /^(csv|xls|xlsx|ods)$/i, icon: <Table2 size={18} /> },
  { matches: /^(zip|rar|7z|tar|gz)$/i, icon: <Archive size={18} /> },
];

export function FileCard({ session, element, simplified }: CardProps): JSX.Element {
  const assetId = element.type === 'file' ? element.assetId : '';
  const assetEntry = useAsset(assetId);
  const upload = useUploadEntry(element.id);
  const asset = assetEntry.asset;
  const rawUrl = asset?.url ?? (assetId.length > 0 ? assetRoutes.raw(assetId) : '');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [thumbWidth, setThumbWidth] = useState(Math.max(64, Math.round(element.width - 24)));

  const extension = asset ? extensionForMime(asset.mime, asset.originalName) : 'bin';
  const isPdf = asset?.mime === PDF_MIME_TYPE;
  const icon = FILE_ICON_BY_KIND.find((entry) => entry.matches.test(extension))?.icon ?? <FileText size={18} />;
  const name = asset?.originalName ?? 'Archivo';
  const size = asset ? formatBytes(asset.size) : '';

  if (upload && upload.status !== 'ready') return <UploadProgressCard entry={upload} width={element.width} />;
  if (assetId.length === 0) return <EmptyAssetCard session={session} element={element} kind="file" />;
  if (assetEntry.status === 'missing') return <MissingAssetCard message="El archivo ya no está en el servidor" />;

  const shown = simplified ? null : (
    <div className="file-card__actions">
      <a
        className="file-card__action"
        href={rawUrl}
        target="_blank"
        rel="noreferrer"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ExternalLink size={12} /> Abrir
      </a>
      <a
        className="file-card__action"
        href={rawUrl}
        download={name}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Download size={12} /> Descargar
      </a>
      {isPdf ? (
        <button
          type="button"
          className="file-card__action"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            setThumbWidth(Math.max(200, Math.round(element.width - 24)));
            setViewerOpen((open) => !open);
          }}
        >
          <Expand size={12} /> {viewerOpen ? 'Cerrar visor' : 'Ver'}
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="file-card">
      {isPdf && rawUrl.length > 0 ? (
        <div className="file-card__thumb" onPointerDown={(event) => event.stopPropagation()}>
          <PdfCanvas url={rawUrl} width={thumbWidth} page={1} />
        </div>
      ) : (
        <span className="file-card__icon" data-ext={extension}>
          {icon}
        </span>
      )}
      <div className="file-card__meta">
        <a
          className="file-card__name"
          href={rawUrl}
          target="_blank"
          rel="noreferrer"
          title={name}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {name}
        </a>
        <span className="file-card__size">
          {extension.toUpperCase()} · {size}
        </span>
      </div>
      {isPdf && viewerOpen && rawUrl.length > 0 ? (
        <div className="file-card__viewer" onPointerDown={(event) => event.stopPropagation()}>
          <PdfPageViewerPanel url={rawUrl} width={Math.max(160, Math.round(element.width - 24))} />
        </div>
      ) : null}
      {shown}
    </div>
  );
}

/** Visor de PDF paginado dentro de la tarjeta (canvas del cliente). */
export function PdfPageViewerPanel({ url, width }: { url: string; width: number }): JSX.Element {
  const [page, setPage] = useState(1);
  const [count, setCount] = useState<number | null>(null);
  const max = count ?? 1;
  return (
    <div className="pdf-panel">
      <PdfCanvas url={url} width={width} page={page} onPageCount={setCount} />
      <div className="pdf-panel__bar">
        <button
          type="button"
          className="pdf-panel__button"
          disabled={page <= 1}
          title="Página anterior"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          ‹
        </button>
        <span className="pdf-panel__count">
          {page} / {max}
        </span>
        <button
          type="button"
          className="pdf-panel__button"
          disabled={count !== null && page >= count}
          title="Página siguiente"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setPage((current) => Math.min(count ?? current + 1, current + 1))}
        >
          ›
        </button>
      </div>
    </div>
  );
}

/**
 * Estados provisionales de una tarjeta de archivo: subiendo, vacía (a la
 * espera de que se elija un archivo) y con error.
 *
 * La tarjeta existe desde el primer momento: al soltar veinte imágenes se ven
 * las veinte con su nombre y su barra de progreso, no un hueco en blanco.
 */

import { type CSSProperties } from 'react';

import { AlertTriangle, FileUp, ImagePlus, Loader2, Music, Upload, Video } from 'lucide-react';

import type { AssetKind, CanvasElement } from '@tablero/shared';
import { formatBytes } from '@tablero/shared';

import { retryStoredUpload, uploadIntoCard } from '@/canvas/uploadController';
import type { BoardSession } from '@/collab/BoardSession';
import { pickFiles } from '@/lib/filePicker';
import { useUploadStore, type UploadEntry } from '@/state/uploadStore';

const KIND_ICON: Record<AssetKind, JSX.Element> = {
  image: <ImagePlus size={18} />,
  video: <Video size={18} />,
  audio: <Music size={18} />,
  file: <FileUp size={18} />,
};

const KIND_LABEL: Record<AssetKind, string> = {
  image: 'Elegir imagen',
  video: 'Elegir vídeo',
  audio: 'Elegir audio',
  file: 'Elegir archivo',
};

/** Tarjeta con la barra de progreso mientras el archivo se sube. */
export function UploadProgressCard({ entry, width }: { entry: UploadEntry; width: number }): JSX.Element {
  const percent = Math.round(entry.progress * 100);
  const style: CSSProperties = { ['--upload-progress' as string]: `${percent}%` };
  return (
    <div className="upload-card" style={style} data-status={entry.status} data-kind={entry.kind}>
      <div className="upload-card__row">
        <span className="upload-card__icon">
          {entry.status === 'error' ? <AlertTriangle size={16} /> : <Loader2 size={16} className="spin" />}
        </span>
        <span className="upload-card__name" title={entry.name}>
          {entry.name}
        </span>
      </div>
      <div className="upload-card__meta">
        {entry.status === 'error' ? (
          <span className="upload-card__error">{entry.error ?? 'No se pudo subir'}</span>
        ) : (
          <>
            <span className="upload-card__size">{formatBytes(entry.size)}</span>
            <span className="upload-card__percent">{percent} %</span>
          </>
        )}
      </div>
      <div
        className="upload-card__bar"
        role="progressbar"
        aria-label={`Subiendo ${entry.name}`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        data-width={width}
      >
        <span className="upload-card__fill" />
      </div>
    </div>
  );
}

export type EmptyAssetCardProps = {
  session: BoardSession;
  element: CanvasElement;
  /** Tipos que se pueden elegir para esta tarjeta. */
  kind: AssetKind;
};

/** Tarjeta sin archivo: invita a elegirlo (o a soltarlo encima). */
export function EmptyAssetCard({ session, element, kind }: EmptyAssetCardProps): JSX.Element {
  const choose = async (): Promise<void> => {
    const files = await pickFiles(kind === 'file' ? 'any' : kind, false);
    const file = files[0];
    if (!file) return;
    await uploadIntoCard(session, element.id, file);
  };

  return (
    <div className="asset-drop" data-kind={kind}>
      <span className="asset-drop__icon">{KIND_ICON[kind]}</span>
      <span className="asset-drop__hint">Sin archivo</span>
      <button
        type="button"
        className="asset-drop__button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => void choose()}
      >
        <Upload size={13} />
        {KIND_LABEL[kind]}
      </button>
    </div>
  );
}

/** Archivo que ya no está disponible (o no se pudo leer del servidor). */
export function MissingAssetCard({ message }: { message: string }): JSX.Element {
  return (
    <div className="asset-drop" data-kind="file">
      <span className="asset-drop__icon">
        <AlertTriangle size={18} />
      </span>
      <span className="asset-drop__hint">{message}</span>
    </div>
  );
}

/** Reintenta una subida fallida usando el archivo que quedó en memoria. */
export function retryUpload(session: BoardSession, elementId: string): void {
  const entry = useUploadStore.getState().entries[elementId];
  if (!entry) return;
  useUploadStore.getState().dismiss(elementId);
  void retryStoredUpload(session, elementId);
}

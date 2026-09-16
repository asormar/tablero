/**
 * Archivos (assets): tipos, clasificación por MIME y cuentas de presentación.
 *
 * Los binarios viven en almacenamiento compatible con S3; la API es la única
 * que habla con ese almacenamiento y expone rutas propias (`assetRoutes`) que
 * redirigen a URLs firmadas. La web nunca necesita saber dónde están los bytes.
 */

import type { ImageCrop } from './elements.js';

export const ASSET_KINDS = ['image', 'video', 'audio', 'file'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Metadatos de un archivo (`Asset` en la base de datos). */
export type AssetSummary = {
  id: string;
  type: AssetKind;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  /** Segundos, solo para vídeo y audio. */
  duration: number | null;
  originalName: string;
  createdAt: number;
  /** Ruta de los bytes (`assetRoutes.raw`). */
  url: string;
  /** Ruta de la miniatura, si se pudo generar. */
  thumbnailUrl: string | null;
};

/** Rutas de los archivos en la API. El detalle devuelve `AssetSummary` en JSON. */
export const assetRoutes = {
  collection: '/api/assets',
  detail: (id: string) => `/api/assets/${encodeURIComponent(id)}`,
  raw: (id: string) => `/api/assets/${encodeURIComponent(id)}/raw`,
  thumb: (id: string) => `/api/assets/${encodeURIComponent(id)}/thumb`,
} as const;

export const DEFAULT_MAX_UPLOAD_MB = 500;
export const DEFAULT_MAX_UPLOAD_BYTES = DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;

/** Mimes que el visor de imágenes puede mostrar tal cual. */
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
] as const;

/** Mimes de imagen que se convierten a WEBP en el servidor (no SVG/GIF animado). */
export const CONVERTIBLE_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
] as const;

export const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/ogg',
  'video/x-msvideo',
] as const;

export const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/flac',
  'audio/opus',
] as const;

export const PDF_MIME_TYPE = 'application/pdf';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/webm': 'weba',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/opus': 'opus',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/markdown': 'md',
};

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export function isConvertibleImageMime(mime: string): boolean {
  return (CONVERTIBLE_IMAGE_MIME_TYPES as readonly string[]).includes(mime.toLowerCase());
}

export function isVideoMime(mime: string): boolean {
  return mime.startsWith('video/');
}

export function isAudioMime(mime: string): boolean {
  return mime.startsWith('audio/');
}

export function isPdfMime(mime: string): boolean {
  return mime === PDF_MIME_TYPE;
}

/** Clasificación del archivo según su MIME (lo que decide qué tarjeta se crea). */
export function assetKindFromMime(mime: string | undefined | null): AssetKind {
  const value = (mime ?? '').toLowerCase();
  if (value === '') return 'file';
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Extensión para guardar en el almacenamiento (MIME primero, nombre después). */
export function extensionForMime(mime: string, originalName = ''): string {
  const known = EXTENSION_BY_MIME[mime.toLowerCase()];
  if (known) return known;
  const match = /\.([a-z0-9]{1,8})$/i.exec(originalName.trim());
  return match?.[1]?.toLowerCase() ?? 'bin';
}

/** Nombre de archivo seguro (sin rutas ni caracteres de control). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'archivo';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '-')
    .trim();
  return cleaned.slice(0, 200) || 'archivo';
}

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

/** Tamaño legible: 1,2 MB. */
export function formatBytes(bytes: number, locale = 'es-ES'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const decimals = unit === 0 || value >= 100 ? 0 : 1;
  const formatted = value.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
  return `${formatted} ${BYTE_UNITS[unit]}`;
}

/** Duración legible: 3:05 o 1:02:03. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Aspecto por defecto cuando todavía no se conocen las medidas reales. */
export const FALLBACK_ASPECT = 3 / 2;

export function aspectRatio(width?: number | null, height?: number | null): number {
  if (!width || !height || width <= 0 || height <= 0) return FALLBACK_ASPECT;
  return width / height;
}

/** Alto que le corresponde a una imagen al fijarle un ancho (respeta el aspecto). */
export function heightForWidth(
  width: number,
  naturalWidth?: number | null,
  naturalHeight?: number | null,
): number {
  const ratio = aspectRatio(naturalWidth, naturalHeight);
  return Math.max(1, Math.round(width / ratio));
}

/** Escala proporcional dentro de una caja (redimensión desde la esquina). */
export function fitWithin(
  size: { width: number; height: number },
  box: { width: number; height: number },
): { width: number; height: number } {
  const scale = Math.min(box.width / size.width, box.height / size.height);
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/**
 * Recorte no destructivo: fracciones (0..1) del original, tal como se guardan en
 * el elemento (`ImageCrop` del modelo). El original nunca se modifica.
 */
export const FULL_CROP: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };

export function clampCrop(crop: Partial<ImageCrop> | null | undefined): ImageCrop {
  const clamp = (value: number, fallback: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : fallback));
  const x = clamp(crop?.x ?? 0, 0);
  const y = clamp(crop?.y ?? 0, 0);
  const width = clamp(crop?.width ?? 1, 1);
  const height = clamp(crop?.height ?? 1, 1);
  return {
    x: Math.min(x, 1 - 0.01),
    y: Math.min(y, 1 - 0.01),
    width: Math.max(0.01, Math.min(width, 1 - Math.min(x, 1))),
    height: Math.max(0.01, Math.min(height, 1 - Math.min(y, 1))),
  };
}

export function isFullCrop(crop: ImageCrop | null | undefined): boolean {
  if (!crop) return true;
  return crop.x <= 0.0001 && crop.y <= 0.0001 && crop.width >= 0.9999 && crop.height >= 0.9999;
}

/** Rectángulo de píxeles del original que hay que mostrar. */
export function cropSourceRect(
  crop: ImageCrop | null | undefined,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number; width: number; height: number } {
  const c = crop ? clampCrop(crop) : FULL_CROP;
  return {
    x: Math.round(c.x * naturalWidth),
    y: Math.round(c.y * naturalHeight),
    width: Math.max(1, Math.round(c.width * naturalWidth)),
    height: Math.max(1, Math.round(c.height * naturalHeight)),
  };
}

/** Aspecto del recorte: es el que debe tener la tarjeta para no deformar. */
export function cropAspectRatio(
  crop: ImageCrop | null | undefined,
  naturalWidth: number,
  naturalHeight: number,
): number {
  const rect = cropSourceRect(crop, naturalWidth, naturalHeight);
  return rect.width / rect.height;
}

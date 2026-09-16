import { describe, expect, it } from 'vitest';

import {
  assetKindFromMime,
  assetRoutes,
  aspectRatio,
  clampCrop,
  cropAspectRatio,
  cropSourceRect,
  extensionForMime,
  fitWithin,
  formatBytes,
  formatDuration,
  heightForWidth,
  isAudioMime,
  isConvertibleImageMime,
  isFullCrop,
  isImageMime,
  isPdfMime,
  isVideoMime,
  safeFileName,
} from './assets.js';

describe('clasificación por MIME', () => {
  it('decide el tipo de tarjeta', () => {
    expect(assetKindFromMime('image/png')).toBe('image');
    expect(assetKindFromMime('video/mp4')).toBe('video');
    expect(assetKindFromMime('audio/mpeg')).toBe('audio');
    expect(assetKindFromMime('application/pdf')).toBe('file');
    expect(assetKindFromMime('application/zip')).toBe('file');
    expect(assetKindFromMime(undefined)).toBe('file');
    expect(assetKindFromMime('')).toBe('file');
  });

  it('reconoce las familias', () => {
    expect(isImageMime('image/heic')).toBe(true);
    expect(isVideoMime('video/quicktime')).toBe(true);
    expect(isAudioMime('audio/webm')).toBe(true);
    expect(isPdfMime('application/pdf')).toBe(true);
    expect(isPdfMime('image/png')).toBe(false);
  });

  it('no promete conversión de SVG ni GIF (se sirven tal cual)', () => {
    expect(isConvertibleImageMime('image/jpeg')).toBe(true);
    expect(isConvertibleImageMime('image/heic')).toBe(true);
    expect(isConvertibleImageMime('image/svg+xml')).toBe(false);
    expect(isConvertibleImageMime('image/gif')).toBe(false);
  });
});

describe('nombres y extensiones', () => {
  it('saca la extensión del MIME', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('audio/mpeg')).toBe('mp3');
    expect(extensionForMime('application/pdf')).toBe('pdf');
  });

  it('cae al nombre original cuando el MIME es desconocido', () => {
    expect(extensionForMime('application/x-raro', 'informe.PPTX')).toBe('pptx');
    expect(extensionForMime('application/x-raro', 'sin-extension')).toBe('bin');
  });

  it('sanea el nombre y quita la ruta', () => {
    expect(safeFileName('C:\\Users\\ale\\foto veraniega.jpg')).toBe('foto veraniega.jpg');
    expect(safeFileName('/tmp/a:b*c?.png')).toBe('a-b-c-.png');
    expect(safeFileName('   ')).toBe('archivo');
    expect(safeFileName('x'.repeat(400)).length).toBe(200);
  });
});

describe('formatBytes', () => {
  it('usa unidades decimales y una cifra significativa', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1500)).toBe('1,5 kB');
    expect(formatBytes(2 * 1000 * 1000)).toBe('2 MB');
    expect(formatBytes(1_234_567)).toBe('1,2 MB');
  });

  it('devuelve un guion con valores imposibles', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formatea minutos y segundos', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('devuelve vacío si no hay duración', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });
});

describe('aspecto y redimensión proporcional', () => {
  it('calcula el alto a partir del ancho', () => {
    expect(heightForWidth(320, 1600, 900)).toBe(180);
    expect(heightForWidth(300, 1000, 1000)).toBe(300);
  });

  it('usa 3:2 cuando no hay medidas', () => {
    expect(aspectRatio(null, null)).toBeCloseTo(1.5);
    expect(heightForWidth(300, null, null)).toBe(200);
  });

  it('escala dentro de una caja', () => {
    expect(fitWithin({ width: 1000, height: 500 }, { width: 400, height: 400 })).toEqual({
      width: 400,
      height: 200,
    });
    expect(fitWithin({ width: 100, height: 100 }, { width: 500, height: 500 })).toEqual({
      width: 500,
      height: 500,
    });
  });
});

describe('recorte no destructivo', () => {
  it('el recorte completo no cambia nada', () => {
    expect(isFullCrop(null)).toBe(true);
    expect(isFullCrop(clampCrop(undefined))).toBe(true);
    expect(isFullCrop({ x: 0.2, y: 0, width: 0.5, height: 1 })).toBe(false);
  });

  it('ajusta los valores fuera de rango', () => {
    expect(clampCrop({ x: -1, y: 2, width: 5, height: 0 })).toEqual({
      x: 0,
      y: 0.99,
      width: 1,
      height: 0.01,
    });
  });

  it('convierte fracciones a píxeles del original', () => {
    expect(cropSourceRect({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, 1000, 800)).toEqual({
      x: 250,
      y: 400,
      width: 500,
      height: 400,
    });
  });

  it('el aspecto del recorte no es el del original', () => {
    expect(cropAspectRatio({ x: 0, y: 0, width: 0.5, height: 1 }, 1000, 500)).toBeCloseTo(1);
    expect(cropAspectRatio(null, 1000, 500)).toBeCloseTo(2);
  });

  it('nunca devuelve un rectángulo vacío', () => {
    const rect = cropSourceRect({ x: 0.999, y: 0.999, width: 0.001, height: 0.001 }, 100, 100);
    expect(rect.width).toBeGreaterThanOrEqual(1);
    expect(rect.height).toBeGreaterThanOrEqual(1);
  });
});

describe('rutas de los archivos', () => {
  it('escapa los identificadores', () => {
    expect(assetRoutes.detail('a b')).toBe('/api/assets/a%20b');
    expect(assetRoutes.raw('x')).toBe('/api/assets/x/raw');
    expect(assetRoutes.thumb('x')).toBe('/api/assets/x/thumb');
    expect(assetRoutes.collection).toBe('/api/assets');
  });
});

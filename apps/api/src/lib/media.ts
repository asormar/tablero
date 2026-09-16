/**
 * Metadatos y miniaturas de los archivos (procesamiento *best effort*).
 *
 * Reglas de la fase 2:
 * - **Imágenes convertibles** (`isConvertibleImageMime`, según el contrato
 *   compartido): `sharp`. Se respeta la orientación EXIF (`.rotate()`) y se
 *   genera una miniatura WEBP de 480 px de ancho como máximo (nunca se agranda:
 *   una imagen de 320 px de ancho deja una miniatura de 320).
 * - **SVG y GIF**: se guardan tal cual, sin miniatura propia: el original sirve
 *   de miniatura (los navegadores los pintan directamente). Igual se intentan
 *   leer sus medidas sin convertirlos.
 * - **Vídeo y audio**: `ffprobe` da la duración (y las medidas del vídeo) y
 *   `ffmpeg` extrae el fotograma de los 2 s (o la mitad, si el vídeo es más
 *   corto) como miniatura WEBP. Para el audio se intenta la portada incrustada
 *   (flujo de imagen adjunto); si no hay, no hay miniatura.
 * - **PDF y ofimática**: sin proceso en el servidor. El visor y la miniatura del
 *   PDF los hace la web en el cliente (ver README).
 *
 * Ningún fallo de procesamiento debe tumbar la subida: todo el trabajo va
 * envuelto y devuelve lo que se haya podido obtener (el resto queda en `null`).
 */

import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';
import { isConvertibleImageMime } from '@tablero/shared';

/** Ancho máximo de las miniaturas (px). */
export const THUMBNAIL_WIDTH = 480;
/** Segundo del vídeo del que se extrae la miniatura. */
export const VIDEO_THUMBNAIL_SEEK_SECONDS = 2;

export type MediaProcessing = {
  width: number | null;
  height: number | null;
  /** Segundos (vídeo y audio). */
  duration: number | null;
  /** Bytes de la miniatura WEBP, si se pudo generar. */
  thumbnail: Buffer | null;
};

export type ProcessLogger = (message: string, error?: unknown) => void;

const noop: ProcessLogger = () => undefined;

export function emptyProcessing(): MediaProcessing {
  return { width: null, height: null, duration: null, thumbnail: null };
}

type CommandResult = { code: number; stdout: string; stderr: string };

/** Ejecuta un binario externo sin shell y con salida acotada. */
function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (error) {
      resolve({ code: -1, stdout, stderr: String(error) });
      return;
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ code: -1, stdout, stderr: `${stderr}\n${String(error)}` });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

let ffmpegProbe: Promise<boolean> | null = null;

/** ¿Están `ffmpeg` y `ffprobe` en el PATH? Se comprueba una sola vez. */
export function ffmpegAvailable(): Promise<boolean> {
  ffmpegProbe ??= (async () => {
    const [probe, encoder] = await Promise.all([
      runCommand('ffprobe', ['-version']),
      runCommand('ffmpeg', ['-version']),
    ]);
    return probe.code === 0 && encoder.code === 0;
  })();
  return ffmpegProbe;
}

// --------------------------------------------------------------------------
// Imágenes (sharp)
// --------------------------------------------------------------------------

/**
 * Medidas de la imagen ya orientada: si el EXIF dice que hay que girarla 90°
 * (orientaciones 5..8), ancho y alto van intercambiados.
 */
function orientedSize(metadata: sharp.Metadata): { width: number | null; height: number | null } {
  const { width, height, orientation } = metadata;
  if (typeof width !== 'number' || typeof height !== 'number') return { width: null, height: null };
  const rotated = typeof orientation === 'number' && orientation >= 5 && orientation <= 8;
  return rotated ? { width: height, height: width } : { width, height };
}

/** Metadatos y miniatura de una imagen. Nunca lanza. */
export async function processImage(
  filePath: string,
  mime: string,
  log: ProcessLogger = noop,
): Promise<MediaProcessing> {
  const result = emptyProcessing();

  try {
    const metadata = await sharp(filePath, { failOn: 'none' }).metadata();
    const size = orientedSize(metadata);
    result.width = size.width;
    result.height = size.height;
  } catch (error) {
    log(`No se pudieron leer los metadatos de la imagen (${mime})`, error);
  }

  if (!isConvertibleImageMime(mime)) {
    // SVG y GIF se guardan tal cual: el original hace de miniatura.
    return result;
  }

  try {
    result.thumbnail = await sharp(filePath, { failOn: 'none' })
      .rotate() // hornea la orientación EXIF en los píxeles
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (error) {
    log(`No se pudo generar la miniatura de la imagen (${mime})`, error);
  }

  return result;
}

// --------------------------------------------------------------------------
// Vídeo y audio (ffmpeg/ffprobe)
// --------------------------------------------------------------------------

type ProbeResult = {
  duration: number | null;
  width: number | null;
  height: number | null;
};

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Duración y medidas del primer flujo de vídeo (sin contar portadas de audio). */
async function probeMedia(filePath: string): Promise<ProbeResult> {
  const { code, stdout } = await runCommand('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  if (code !== 0) return { duration: null, width: null, height: null };

  let parsed: { format?: { duration?: unknown }; streams?: unknown[] };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    return { duration: null, width: null, height: null };
  }

  const streams = Array.isArray(parsed.streams) ? (parsed.streams as Record<string, unknown>[]) : [];
  const video = streams.find(
    (stream) => stream['codec_type'] === 'video' && (stream['disposition'] as { attached_pic?: number } | undefined)?.attached_pic !== 1,
  );

  let duration = positiveNumber(parsed.format?.duration);
  if (duration === null && video) duration = positiveNumber(video['duration']);

  let width = positiveNumber(video?.['width']);
  let height = positiveNumber(video?.['height']);
  const rotation = Number.parseInt(String((video?.['side_data_list'] as { rotation?: unknown }[] | undefined)?.[0]?.rotation ?? ''), 10);
  if ((rotation === 90 || rotation === 270) && width !== null && height !== null) {
    [width, height] = [height, width];
  }
  return { duration: duration !== null ? Number(duration.toFixed(3)) : null, width, height };
}

/** Ancho objetivo de la miniatura, par (lo exige el escalado de vídeo) y sin agrandar. */
function thumbnailTargetWidth(sourceWidth: number | null): number {
  const target = sourceWidth !== null ? Math.min(THUMBNAIL_WIDTH, Math.round(sourceWidth)) : THUMBNAIL_WIDTH;
  return Math.max(2, target % 2 === 0 ? target : target - 1);
}

function seekSecondsFor(duration: number | null): number {
  if (duration === null || duration <= 0) return VIDEO_THUMBNAIL_SEEK_SECONDS;
  return Number(Math.min(VIDEO_THUMBNAIL_SEEK_SECONDS, duration / 2).toFixed(2));
}

/** Ejecuta ffmpeg y devuelve los bytes del WEBP resultante (o `null`). */
async function runFfmpegToWebp(args: string[], outputPath: string, log: ProcessLogger): Promise<Buffer | null> {
  const { code, stderr } = await runCommand('ffmpeg', args);
  if (code !== 0) {
    log(`ffmpeg terminó con código ${code}: ${stderr.trim().split('\n').slice(-1)[0] ?? ''}`);
    return null;
  }
  try {
    const info = await stat(outputPath);
    if (info.size === 0) return null;
    return await readFile(outputPath);
  } catch {
    return null;
  }
}

/** Duración y miniatura de vídeo/audio. Nunca lanza. */
export async function processAv(
  filePath: string,
  kind: 'video' | 'audio',
  workDir: string,
  log: ProcessLogger = noop,
): Promise<MediaProcessing> {
  const result = emptyProcessing();

  if (!(await ffmpegAvailable())) {
    log('ffmpeg/ffprobe no están disponibles: se guarda sin duración ni miniatura');
    return result;
  }

  try {
    const probe = await probeMedia(filePath);
    result.duration = probe.duration;
    if (kind === 'video') {
      result.width = probe.width;
      result.height = probe.height;
    }
  } catch (error) {
    log('No se pudieron leer los metadatos con ffprobe', error);
  }

  const outputPath = join(workDir, 'thumbnail.webp');
  const width = thumbnailTargetWidth(kind === 'video' ? result.width : null);

  try {
    if (kind === 'video') {
      const seek = seekSecondsFor(result.duration);
      const base = ['-y', '-loglevel', 'error'];
      const tail = ['-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'webp', '-q:v', '82', outputPath];
      // `-ss` antes de `-i` = búsqueda rápida. Si el fotograma pedido no existe
      // (vídeo más corto de lo esperado) se reintenta desde el principio.
      let frame = await runFfmpegToWebp([...base, '-ss', String(seek), '-i', filePath, ...tail], outputPath, log);
      if (!frame && seek > 0) {
        frame = await runFfmpegToWebp([...base, '-i', filePath, ...tail], outputPath, log);
      }
      result.thumbnail = frame;
    } else {
      // Portada incrustada (MP3/FLAC/M4A): es el primer flujo de vídeo adjunto.
      result.thumbnail = await runFfmpegToWebp(
        ['-y', '-loglevel', 'error', '-i', filePath, '-map', '0:v:0', '-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'webp', '-q:v', '82', outputPath],
        outputPath,
        log,
      );
    }
  } catch (error) {
    log('No se pudo generar la miniatura con ffmpeg', error);
  }

  return result;
}

/**
 * Almacenamiento de objetos compatible con S3 (MinIO en desarrollo).
 *
 * La API es la única que habla con el almacenamiento: las claves
 * (`assets/<ownerId>/<assetId>.<ext>` y `thumbs/<ownerId>/<assetId>.webp`) no
 * salen nunca al cliente, que usa siempre las rutas de `assetRoutes`. Las
 * descargas se sirven con una redirección (302) a una URL firmada de vida corta.
 *
 * El bucket se asegura al arrancar de forma idempotente (`ensureBucket`): si ya
 * existe no se toca, y si no, se crea. Un fallo de MinIO al arrancar no tumba la
 * API: se registra y los assets fallarán hasta que el almacenamiento vuelva.
 */

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

import { env } from '../env.js';

/** Vida de las URLs firmadas que se entregan al cliente (15 min). */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Ventana en la que se cuantiza la hora de firma (5 min): dentro de la misma
 * ventana un objeto produce **la misma** URL, así el navegador puede reutilizar
 * la redirección y los bytes ya descargados. Con un TTL de 15 min, toda URL
 * entregada es válida al menos 10 min más.
 */
export const SIGNING_WINDOW_SECONDS = 5 * 60;

/** Margen que se resta a la caducidad al calcular el `max-age` de la redirección. */
export const SIGNED_URL_CACHE_MARGIN_SECONDS = 60;

/**
 * `Cache-Control` de los objetos al subirlos. Las claves son inmutables: llevan
 * un id aleatorio por archivo (`assets/<dueño>/<assetId>.<ext>`) y un archivo
 * nuevo nunca reutiliza una clave, así que los bytes de una URL no cambian.
 * `private`: son archivos de usuario, no contenido para cachés compartidas.
 */
export const OBJECT_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/**
 * MinIO (y cualquier S3 autoalojado) exige direccionamiento por ruta:
 * `http://host/bucket/clave` en vez de `http://bucket.host/clave`.
 * R2 usa virtual-hosted, así que `forcePathStyle` sale de la configuración
 * (`S3_FORCE_PATH_STYLE`): en producción va en `false`.
 *
 * `requestChecksumCalculation`/`responseChecksumValidation` en `WHEN_REQUIRED`:
 * desde la v3.729 el SDK calcula los checksums flexibles (CRC32) por defecto y
 * los manda en la petición, lo que R2 rechaza con un error de firma. Con
 * `WHEN_REQUIRED` solo se envían cuando la operación los pide de verdad.
 */
export const s3 = new S3Client({
  endpoint: env.s3.endpoint,
  region: env.s3.region,
  credentials: {
    accessKeyId: env.s3.accessKey,
    secretAccessKey: env.s3.secretKey,
  },
  forcePathStyle: env.s3.forcePathStyle,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

/** Clave del archivo original. Extensión derivada del MIME (o del nombre). */
export function assetKey(ownerId: string, assetId: string, extension: string): string {
  return `assets/${ownerId}/${assetId}.${extension}`;
}

/** Clave de la miniatura WEBP (siempre la misma forma, para poder borrarla). */
export function thumbnailKey(ownerId: string, assetId: string): string {
  return `thumbs/${ownerId}/${assetId}.webp`;
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate?.name === 'NotFound' ||
    candidate?.Code === 'NotFound' ||
    candidate?.$metadata?.httpStatusCode === 404
  );
}

/** ¿El endpoint es de Cloudflare R2? (`<cuenta>.r2.cloudflarestorage.com`). */
function isR2(): boolean {
  return /\.r2\.cloudflarestorage\.com$/.test(env.s3.endpoint);
}

/**
 * Crea el bucket si hace falta. Idempotente: repetirla no cambia nada.
 * Devuelve `true` cuando el bucket quedó disponible.
 *
 * En R2 el bucket se crea desde el panel de Cloudflare: el endpoint no acepta
 * `CreateBucket` con `LocationConstraint`, así que acá solo se verifica que
 * exista y se avisa (sin tirar) cuando falta.
 */
export async function ensureBucket(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.s3.bucket }));
    return true;
  } catch (error) {
    if (!isNotFound(error)) {
      // Otro error (credenciales, red): no se intenta crear, se propaga.
      throw error;
    }
  }
  if (isR2()) {
    throw new Error(
      `El bucket "${env.s3.bucket}" no existe en R2: créalo desde el panel de Cloudflare (Storage & Databases → R2) y reiniciá la API`,
    );
  }
  try {
    await s3.send(new CreateBucketCommand({ Bucket: env.s3.bucket }));
  } catch (error) {
    // Carrera entre dos instancias que arrancan a la vez: el bucket ya es nuestro.
    const candidate = error as { name?: string; Code?: string };
    if (candidate?.name !== 'BucketAlreadyOwnedByYou' && candidate?.Code !== 'BucketAlreadyOwnedByYou') {
      throw error;
    }
  }
  return true;
}

/** Sube un objeto. `body` puede ser un Buffer o un stream (se conoce el tamaño). */
export async function putObject(
  key: string,
  body: Buffer | Readable,
  contentType: string,
  contentLength?: number,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: OBJECT_CACHE_CONTROL,
      ...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
    }),
  );
}

export type SignedUrlOptions = {
  /** Fuerza la descarga con el nombre original (`Content-Disposition: attachment`). */
  downloadName?: string | null;
  /** Hora de firma (por defecto, ahora). La caducidad cuenta desde ella. */
  signingDate?: Date;
};

/** URL firmada de lectura (GET). Nunca se persiste: se genera por petición. */
export async function getPresignedGetUrl(
  key: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
  options: SignedUrlOptions = {},
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.s3.bucket,
    Key: key,
    ...(options.downloadName ? { ResponseContentDisposition: contentDisposition(options.downloadName) } : {}),
  });
  return getSignedUrl(s3, command, {
    expiresIn: ttlSeconds,
    ...(options.signingDate ? { signingDate: options.signingDate } : {}),
  });
}

/**
 * Ventana de firma vigente en `now`: hora de firma cuantizada y momento en que
 * caducan las URLs firmadas con ella.
 */
export function signingWindow(now: number = Date.now()): { signingDate: Date; expiresAt: number } {
  const windowMs = SIGNING_WINDOW_SECONDS * 1000;
  const start = Math.floor(now / windowMs) * windowMs;
  return { signingDate: new Date(start), expiresAt: start + SIGNED_URL_TTL_SECONDS * 1000 };
}

export type CacheablePresignedUrl = {
  url: string;
  /** Segundos que el navegador puede reutilizar la URL (caducidad menos el margen). */
  maxAgeSeconds: number;
};

/**
 * URL firmada de lectura **estable por ventana** (ver `SIGNING_WINDOW_SECONDS`),
 * con los segundos que la redirección puede cachearse sin que el navegador llegue
 * a seguir una URL caducada.
 */
export async function getCacheablePresignedGetUrl(
  key: string,
  options: Omit<SignedUrlOptions, 'signingDate'> = {},
  now: number = Date.now(),
): Promise<CacheablePresignedUrl> {
  const { signingDate, expiresAt } = signingWindow(now);
  const url = await getPresignedGetUrl(key, SIGNED_URL_TTL_SECONDS, { ...options, signingDate });
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt - now) / 1000) - SIGNED_URL_CACHE_MARGIN_SECONDS);
  return { url, maxAgeSeconds };
}

/** `Content-Disposition` con respaldo ASCII y `filename*` UTF-8. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Borra un objeto. No falla si la clave ya no existe. */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }));
}

export type ObjectHead = { size: number; contentType: string | null };

/** Metadatos del objeto, o `null` si no existe. */
export async function headObject(key: string): Promise<ObjectHead | null> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: env.s3.bucket, Key: key }));
    return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export type ObjectStream = { body: Readable; size: number; contentType: string | null };

/**
 * Flujo de lectura de un objeto (exportaciones): el archivo no se carga entero
 * en memoria, se lee por partes. `null` si el objeto ya no existe.
 */
export async function getObjectStream(key: string): Promise<ObjectStream | null> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }));
    if (!response.Body) return null;
    return {
      body: response.Body as Readable,
      size: response.ContentLength ?? 0,
      contentType: response.ContentType ?? null,
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

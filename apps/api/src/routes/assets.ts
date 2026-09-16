/**
 * Rutas de archivos (assets).
 *
 *   POST   /api/assets            multipart (`file` + `boardId?` + `dedupe?`)
 *   GET    /api/assets            listado del usuario (`boardId?`, `type?`)
 *   GET    /api/assets/:id        detalle (`{ asset: AssetSummary }`)
 *   GET    /api/assets/:id/raw    302 a la URL firmada del original (15 min)
 *   GET    /api/assets/:id/thumb  302 a la miniatura firmada (o al original)
 *   DELETE /api/assets/:id        borra el archivo y sus objetos
 *
 * Reglas:
 * - Todas exigen sesión y **solo el propietario** lee o borra su archivo: un
 *   asset ajeno responde 404 (no 403: no se filtra su existencia).
 * - Las claves de S3 nunca salen al cliente; el cliente usa `assetRoutes`.
 * - La subida es `multipart/form-data`; el progreso lo lleva la web. `presign`
 *   (subida directa firmada) queda fuera de esta fase: sin un paso de
 *   confirmación, crearía filas de assets que nunca llegan a subirse.
 * - `dedupe` (por defecto activado): si el mismo usuario ya subió un archivo con
 *   el mismo sha256 + MIME + tamaño, se devuelve el existente con **200** (la
 *   subida nueva responde **201**).
 * - El procesamiento (medidas, duración, miniatura) es *best effort*: si falla,
 *   el archivo se guarda igual y esos campos quedan en `null`.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { Asset } from '@prisma/client';
import {
  assetIdParamSchema,
  assetKindFromMime,
  assetRoutes,
  extensionForMime,
  isImageMime,
  listAssetsSchema,
  safeFileName,
  uploadAssetSchema,
  type AssetSummary,
} from '@tablero/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { prisma } from '../db.js';
import { env } from '../env.js';
import { loadBoardAccess } from '../lib/boards.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { emptyProcessing, processAv, processImage, type MediaProcessing } from '../lib/media.js';
import { currentUser } from '../lib/session.js';
import {
  assetKey,
  deleteObject,
  getPresignedGetUrl,
  putObject,
  SIGNED_URL_TTL_SECONDS,
  thumbnailKey,
} from '../lib/storage.js';

/** Margen sobre el límite antes de rechazar por `Content-Length` (cabeceras del multipart). */
const DECLARED_SIZE_SLACK_BYTES = 1024 * 1024;
/** Tope de filas del listado (la fase 2 no tiene paginación). */
const LIST_LIMIT = 1000;

/**
 * MIME mínimo por extensión, solo para clientes que no mandan `Content-Type`
 * (o mandan `application/octet-stream`, como hace `curl -F` con extensiones
 * raras). Normaliza la clave de dedupe: el mismo archivo siempre da el mismo
 * MIME aunque el cliente lo etiquete distinto.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  ogv: 'video/ogg',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
};

function normalizeMime(raw: string | undefined, fileName: string): string {
  const value = (raw ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (value !== '' && value !== 'application/octet-stream') return value;
  const match = /\.([a-z0-9]{1,8})$/i.exec(fileName.trim());
  const byExtension = match ? MIME_BY_EXTENSION[match[1]!.toLowerCase()] : undefined;
  return byExtension ?? (value !== '' ? value : 'application/octet-stream');
}

function fileTooLarge(): HttpError {
  return new HttpError(
    413,
    `El archivo supera el máximo de ${env.maxUploadMb} MB`,
    'file_too_large',
    { maxUploadMb: env.maxUploadMb },
  );
}

/**
 * `AssetSummary` del contrato compartido. `thumbnailUrl` apunta a la ruta
 * `/thumb`, que siempre responde (miniatura propia u original). Es `null` solo
 * cuando no hay nada que el navegador pueda pintar (vídeo sin ffmpeg, PDF…).
 */
function toAssetSummary(row: Asset): AssetSummary {
  const hasPreview = row.thumbnailKey !== null || isImageMime(row.mime);
  return {
    id: row.id,
    type: row.type,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    duration: row.duration,
    originalName: row.originalName,
    createdAt: row.createdAt.getTime(),
    url: assetRoutes.raw(row.id),
    thumbnailUrl: hasPreview ? assetRoutes.thumb(row.id) : null,
  };
}

function isTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'on', 'yes', ''].includes(value.toLowerCase());
}

/**
 * MIME que el navegador ejecuta si se sirven en línea. Un SVG puede traer
 * `<script>` y un HTML es HTML: servidos desde el origen del almacenamiento,
 * abrirlos en una pestaña sería ejecutar código de un archivo subido.
 */
const INLINE_DANGEROUS_MIME = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml', 'image/svg']);

function isInlineDangerous(mime: string | null | undefined): boolean {
  if (typeof mime !== 'string') return false;
  return INLINE_DANGEROUS_MIME.has(mime.split(';')[0]?.trim().toLowerCase() ?? '');
}

/** Asset del usuario o 404 (ajeno e inexistente son indistinguibles). */
async function requireOwnAsset(request: FastifyRequest): Promise<Asset> {
  const user = currentUser(request);
  const { id } = assetIdParamSchema.parse(request.params ?? {});
  const row = await prisma.asset.findUnique({ where: { id } });
  if (!row || row.ownerId !== user.id) throw notFound('El archivo no existe', 'asset_not_found');
  return row;
}

type ReceivedUpload = {
  size: number;
  sha256: string;
  fileName: string;
  mime: string;
  fields: Record<string, string>;
};

/** Multipart → archivo temporal, con sha256 y tamaño exactos. */
async function receiveUpload(request: FastifyRequest, targetPath: string): Promise<ReceivedUpload> {
  const hash = createHash('sha256');
  let size = 0;
  let fileName = 'archivo';
  let mime = '';
  let received = false;
  const fields: Record<string, string> = {};

  const digest = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });

  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (received) continue; // el plugin ya limita a un archivo
        received = true;
        fileName = part.filename && part.filename.length > 0 ? part.filename : fileName;
        mime = normalizeMime(part.mimetype, fileName);
        await pipeline(part.file, digest, createWriteStream(targetPath));
        if (part.file.truncated) throw fileTooLarge();
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') throw fileTooLarge();
    if (code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT' || code === 'FST_FIELDS_LIMIT') {
      throw badRequest('El formulario tiene demasiados campos o archivos (se admite uno solo)', code);
    }
    if (code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      throw badRequest('El cuerpo debe ser multipart/form-data con un campo `file`', code);
    }
    throw error;
  }

  if (!received) throw badRequest('Falta el archivo (campo `file`)', 'file_missing');
  if (size === 0) throw badRequest('El archivo está vacío', 'file_empty');
  return { size, sha256: hash.digest('hex'), fileName, mime, fields };
}

/** Medidas/duración/miniatura según el tipo. Nunca lanza. */
async function processFile(
  filePath: string,
  workDir: string,
  kind: 'image' | 'video' | 'audio' | 'file',
  mime: string,
  log: (message: string, error?: unknown) => void,
): Promise<MediaProcessing> {
  try {
    if (kind === 'image') return await processImage(filePath, mime, log);
    if (kind === 'video' || kind === 'audio') return await processAv(filePath, kind, workDir, log);
  } catch (error) {
    log(`Procesamiento fallido (${mime}): se guarda el archivo tal cual`, error);
  }
  return emptyProcessing();
}

async function boardIdForUpload(request: FastifyRequest, boardId: string | undefined): Promise<string | null> {
  if (!boardId) return null;
  const user = currentUser(request);
  const access = await loadBoardAccess(user.id);
  if (!access.roleOf(boardId)) throw notFound('El tablero no existe o no tenés acceso');
  return boardId;
}

export async function assetsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/assets', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = currentUser(request);
    const maxBytes = env.maxUploadMb * 1024 * 1024;

    // Rechazo temprano por `Content-Length` para no recibir cuerpos enormes.
    const declared = Number.parseInt(String(request.headers['content-length'] ?? ''), 10);
    if (Number.isFinite(declared) && declared > maxBytes + DECLARED_SIZE_SLACK_BYTES) throw fileTooLarge();

    const workDir = await mkdtemp(join(tmpdir(), 'tablero-asset-'));
    try {
      const upload = await receiveUpload(request, join(workDir, 'original'));
      const input = uploadAssetSchema.parse({
        // Un `boardId` vacío equivale a no mandarlo (la web lo manda siempre).
        boardId: upload.fields['boardId'] && upload.fields['boardId'].length > 0 ? upload.fields['boardId'] : undefined,
        dedupe: upload.fields['dedupe'] === undefined ? undefined : isTruthyFlag(upload.fields['dedupe']),
      });
      const boardId = await boardIdForUpload(request, input.boardId);
      const originalName = safeFileName(upload.fileName);
      const kind = assetKindFromMime(upload.mime);

      if (input.dedupe) {
        const existing = await prisma.asset.findFirst({
          where: { ownerId: user.id, sha256: upload.sha256, mime: upload.mime, size: upload.size },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          reply.code(200);
          return { asset: toAssetSummary(existing) };
        }
      }

      // El id se genera acá (no en Prisma) para poder construir las claves.
      const assetId = randomUUID();
      const storageKey = assetKey(user.id, assetId, extensionForMime(upload.mime, originalName));
      const log = (message: string, error?: unknown) => request.log.warn({ err: error, assetId }, message);

      const originalPath = join(workDir, 'original');
      try {
        await putObject(storageKey, createReadStream(originalPath), upload.mime, upload.size);
      } catch (error) {
        request.log.error({ err: error }, 'No se pudo subir el objeto a S3');
        throw new HttpError(502, 'No se pudo guardar el archivo en el almacenamiento', 'storage_unavailable');
      }

      const processing = await processFile(originalPath, workDir, kind, upload.mime, log);

      let storedThumbnailKey: string | null = null;
      if (processing.thumbnail) {
        const key = thumbnailKey(user.id, assetId);
        try {
          await putObject(key, processing.thumbnail, 'image/webp', processing.thumbnail.length);
          storedThumbnailKey = key;
        } catch (error) {
          log('No se pudo subir la miniatura: el archivo queda sin miniatura', error);
        }
      }

      try {
        const row = await prisma.asset.create({
          data: {
            id: assetId,
            ownerId: user.id,
            boardId,
            type: kind,
            mime: upload.mime,
            size: upload.size,
            sha256: upload.sha256,
            storageKey,
            width: processing.width,
            height: processing.height,
            duration: processing.duration,
            thumbnailKey: storedThumbnailKey,
            originalName,
          },
        });
        reply.code(201);
        return { asset: toAssetSummary(row) };
      } catch (error) {
        // Sin fila no hay asset: se limpian los objetos recién subidos.
        await deleteObject(storageKey).catch(() => undefined);
        if (storedThumbnailKey) await deleteObject(storedThumbnailKey).catch(() => undefined);
        throw error;
      }
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  app.get('/assets', async (request) => {
    const user = currentUser(request);
    const query = listAssetsSchema.parse(request.query ?? {});
    if (query.boardId) {
      const access = await loadBoardAccess(user.id);
      if (!access.roleOf(query.boardId)) throw notFound('El tablero no existe o no tenés acceso');
    }
    const rows = await prisma.asset.findMany({
      where: {
        ownerId: user.id,
        ...(query.type ? { type: query.type } : {}),
        ...(query.boardId ? { boardId: query.boardId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT,
    });
    return { assets: rows.map(toAssetSummary) };
  });

  app.get('/assets/:id', async (request) => {
    const row = await requireOwnAsset(request);
    return { asset: toAssetSummary(row) };
  });

  app.get('/assets/:id/raw', async (request, reply) => {
    const row = await requireOwnAsset(request);
    const download = isTruthyFlag(request.query ? (request.query as Record<string, unknown>)['download'] : undefined);
    // SVG y HTML se ejecutan si el navegador los sirve en línea, y este endpoint
    // redirige a la URL firmada del objeto: al abrirlos en una pestaña correrían
    // su `<script>` en el origen del almacenamiento. Se fuerzan como descarga.
    const url = await getPresignedGetUrl(row.storageKey, SIGNED_URL_TTL_SECONDS, {
      downloadName: download || isInlineDangerous(row.mime) ? row.originalName : null,
    });
    reply.header('cache-control', 'private, no-store');
    reply.redirect(url, 302);
  });

  app.get('/assets/:id/thumb', async (request, reply) => {
    const row = await requireOwnAsset(request);
    // Sin miniatura propia se sirve el original (nunca 404): la web siempre
    // puede pedir esta ruta para previsualizar.
    const url = await getPresignedGetUrl(row.thumbnailKey ?? row.storageKey, SIGNED_URL_TTL_SECONDS);
    reply.header('cache-control', 'private, no-store');
    reply.redirect(url, 302);
  });

  app.delete('/assets/:id', async (request) => {
    const row = await requireOwnAsset(request);
    const keys = [row.storageKey, ...(row.thumbnailKey ? [row.thumbnailKey] : [])];
    for (const key of keys) {
      try {
        await deleteObject(key);
      } catch (error) {
        // El objeto huérfano no puede bloquear el borrado pedido por el usuario.
        request.log.warn({ err: error, key }, 'No se pudo borrar el objeto de S3');
      }
    }
    await prisma.asset.delete({ where: { id: row.id } });
    return { ok: true };
  });
}

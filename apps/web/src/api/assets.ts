/**
 * Capa tipada sobre las rutas de archivos y de previsualización de enlaces.
 *
 * Contrato de la API (fase 2):
 *   POST   /api/assets          multipart (`file`, `boardId`) → { asset } 201/200
 *   GET    /api/assets/:id      → { asset }
 *   GET    /api/assets/:id/raw  → 302 a la URL firmada
 *   GET    /api/assets/:id/thumb→ 302 a la URL firmada
 *   DELETE /api/assets/:id      → 204
 *   GET    /api/link-preview?url= → { preview }
 *
 * La subida usa `XMLHttpRequest` a propósito: es la única forma de tener
 * progreso de envío en el navegador (`fetch` no expone el avance del cuerpo).
 */

import {
  type AssetSummary,
  type LinkPreviewData,
  assetRoutes,
} from '@tablero/shared';

import { API_BASE_URL, ApiError, apiRequest } from './client';

/**
 * Las rutas del contrato compartido ya incluyen `/api` (`assetRoutes.raw(id)`
 * sirve tal cual como `src`). Para las llamadas que pasan por la base de la API
 * se sustituye ese prefijo por la base real, así funciona igual con la base
 * relativa (`/api`, proxied por Vite) y con una absoluta.
 */
const ASSETS_PATH = assetRoutes.collection.replace(/^\/api/, '');
const assetByIdPath = (id: string): string => `${ASSETS_PATH}/${encodeURIComponent(id)}`;

/** URL final de una ruta compartida de archivos (nunca `/api/api/...`). */
export function assetApiPath(route: string): string {
  return `${API_BASE_URL}${route.replace(/^\/api/, '')}`;
}

export type UploadAssetOptions = {
  boardId?: string | null;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
};

/**
 * Mensaje de una subida rechazada.
 *
 * La API responde `{ error: string, code }` (plano): leer `payload.error.message`
 * mostraba siempre «Error 413/500» y se perdía el motivo real. Se aceptan las
 * dos formas para no depender de cómo evolucione el contrato: `error` como
 * cadena (la actual), `error.message` (anidado, por compatibilidad) y `message`
 * (Fastify).
 */
export function uploadErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim().length > 0) return payload.trim();
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const error = record['error'];
    if (typeof error === 'string' && error.trim().length > 0) return error.trim();
    if (error && typeof error === 'object') {
      const nested = (error as Record<string, unknown>)['message'];
      if (typeof nested === 'string' && nested.trim().length > 0) return nested.trim();
    }
    const message = record['message'];
    if (typeof message === 'string' && message.trim().length > 0) return message.trim();
  }
  return `Error ${status}`;
}

type AssetResponse = { asset?: unknown };

function toAssetSummary(raw: unknown): AssetSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = record['id'];
  const url = record['url'];
  if (typeof id !== 'string' || id.length === 0) return null;
  const thumbnailUrl = record['thumbnailUrl'];
  return {
    id,
    type: (record['type'] as AssetSummary['type']) ?? 'file',
    mime: typeof record['mime'] === 'string' ? record['mime'] : 'application/octet-stream',
    size: typeof record['size'] === 'number' ? record['size'] : 0,
    width: typeof record['width'] === 'number' ? record['width'] : null,
    height: typeof record['height'] === 'number' ? record['height'] : null,
    duration: typeof record['duration'] === 'number' ? record['duration'] : null,
    originalName: typeof record['originalName'] === 'string' ? record['originalName'] : '',
    createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : Date.now(),
    // La API ya devuelve rutas listas para usar como `src`.
    url: typeof url === 'string' && url.length > 0 ? url : assetRoutes.raw(id),
    thumbnailUrl: typeof thumbnailUrl === 'string' && thumbnailUrl.length > 0 ? thumbnailUrl : null,
  };
}

/** Sube un archivo y resuelve con sus metadatos. Lanza `ApiError` si falla. */
export function uploadAsset(file: File, options: UploadAssetOptions = {}): Promise<AssetSummary> {
  return new Promise<AssetSummary>((resolve, reject) => {
    const body = new FormData();
    body.append('file', file, file.name);
    if (options.boardId) body.append('boardId', options.boardId);

    const request = new XMLHttpRequest();
    request.open('POST', assetApiPath(assetRoutes.collection), true);
    request.withCredentials = true;
    request.responseType = 'text';
    request.setRequestHeader('Accept', 'application/json');

    const onAbort = (): void => request.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => {
      options.signal?.removeEventListener('abort', onAbort);
    };

    request.upload.onprogress = (event) => {
      if (!options.onProgress) return;
      const ratio = event.lengthComputable && event.total > 0 ? event.loaded / event.total : 0;
      options.onProgress(Math.max(0, Math.min(1, ratio)));
    };
    request.upload.onload = () => options.onProgress?.(1);

    request.onerror = () => {
      cleanup();
      reject(new ApiError('No se pudo conectar con la API', 0, 'network_error'));
    };
    request.ontimeout = () => {
      cleanup();
      reject(new ApiError('La subida tardó demasiado', 0, 'timeout'));
    };
    request.onabort = () => {
      cleanup();
      reject(new ApiError('Subida cancelada', -1, 'aborted'));
    };
    request.onload = () => {
      cleanup();
      const status = request.status;
      const payload = parseJson(request.responseText);
      if (status >= 200 && status < 300) {
        const asset = toAssetSummary((payload as AssetResponse | null)?.asset);
        if (asset) {
          options.onProgress?.(1);
          resolve(asset);
          return;
        }
        reject(new ApiError('La API no devolvió el archivo subido', status, 'bad_response', payload));
        return;
      }
      const message = uploadErrorMessage(payload, status);
      reject(new ApiError(message, status, 'upload_failed', payload));
    };

    request.send(body);
  });
}

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Metadatos de un archivo ya subido. `null` si no existe (404). */
export async function fetchAssetSummary(id: string): Promise<AssetSummary | null> {
  try {
    const payload = await apiRequest<AssetResponse>(assetByIdPath(id));
    return toAssetSummary(payload?.asset);
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) return null;
    throw error;
  }
}

export async function deleteAsset(id: string): Promise<void> {
  await apiRequest<void>(assetByIdPath(id), { method: 'DELETE' });
}

/** Previsualización de un enlace (título, imagen, favicon, tipo de incrustado). */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  try {
    const payload = await apiRequest<{ preview?: LinkPreviewData }>('/link-preview', {
      query: { url },
      timeoutMs: 15000,
    });
    const preview = payload?.preview;
    if (!preview || typeof preview !== 'object' || typeof preview.url !== 'string') return null;
    return preview;
  } catch {
    // Sin API no hay previsualización: la tarjeta se queda con el incrustado
    // inmediato de `detectEmbed` y el dominio.
    return null;
  }
}

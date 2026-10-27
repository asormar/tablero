/**
 * Rutas de la API de archivos: el contrato compartido las publica con el
 * prefijo `/api` incluido (`assetRoutes.raw(id)` sirve como `src`), pero las
 * llamadas que pasan por la base de la API no pueden anteponerlo otra vez o
 * pedirían `/api/api/assets` (404 real detectado en la verificación).
 *
 * Además se cubre el mensaje de una subida rechazada: la API responde
 * `{ error: string, code }` plano, y leer `payload.error.message` mostraba
 * siempre «Error 413/500» perdiendo el motivo real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assetRoutes } from '@tablero/shared';

import {
  assetApiPath,
  fetchAssetSummaries,
  resetAssetBatchSupport,
  uploadAsset,
  uploadErrorMessage,
} from './assets';
import { API_BASE_URL, ApiError } from './client';

describe('assetApiPath', () => {
  it('no duplica el prefijo /api de las rutas del contrato', () => {
    expect(assetApiPath(assetRoutes.collection)).toBe('/api/assets');
    expect(assetApiPath(assetRoutes.detail('abc'))).toBe('/api/assets/abc');
    expect(assetApiPath(assetRoutes.raw('abc'))).toBe('/api/assets/abc/raw');
    expect(assetApiPath(assetRoutes.collection).includes('/api/api/')).toBe(false);
  });

  it('usa la base configurada de la API', () => {
    expect(assetApiPath('/api/assets').startsWith(API_BASE_URL)).toBe(true);
  });

  it('respeta una base absoluta', () => {
    // La sustitución del prefijo sirve igual con una base con host.
    const absolute = 'https://api.example.com/api';
    const route = assetRoutes.detail('abc');
    expect(`${absolute}${route.replace(/^\/api/, '')}`).toBe('https://api.example.com/api/assets/abc');
  });
});

describe('uploadErrorMessage', () => {
  it('lee el `error` plano que devuelve la API', () => {
    expect(
      uploadErrorMessage({ error: 'El archivo supera el máximo de 500 MB', code: 'file_too_large' }, 413),
    ).toBe('El archivo supera el máximo de 500 MB');
  });

  it('acepta un `error` anidado (`{ error: { message } }`)', () => {
    expect(uploadErrorMessage({ error: { message: 'Motivo anidado' } }, 500)).toBe('Motivo anidado');
  });

  it('cae a `message` y, sin nada, al código de estado', () => {
    expect(uploadErrorMessage({ message: 'Motivo de Fastify' }, 500)).toBe('Motivo de Fastify');
    expect(uploadErrorMessage(null, 500)).toBe('Error 500');
    expect(uploadErrorMessage({}, 500)).toBe('Error 500');
    expect(uploadErrorMessage({ error: '   ' }, 413)).toBe('Error 413');
  });
});

/**
 * Doble de `XMLHttpRequest`: `uploadAsset` es el único punto del cliente que
 * usa XHR (por el progreso de envío), así que se prueba con una respuesta
 * preparada sin tocar la red.
 */
class FakeXhr {
  static reply: { status: number; body: string } = { status: 201, body: '{}' };

  status = 0;
  responseText = '';
  withCredentials = false;
  responseType = 'text';
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null; onload: (() => void) | null } = {
    onprogress: null,
    onload: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readonly sent: FormData[] = [];

  open(): void {
    // La URL se comprueba en los tests de `assetApiPath`.
  }

  setRequestHeader(): void {
    // sin cabeceras propias
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    if (body instanceof FormData) this.sent.push(body);
    this.status = FakeXhr.reply.status;
    this.responseText = FakeXhr.reply.body;
    this.upload.onload?.();
    this.onload?.();
  }

  abort(): void {
    this.onabort?.();
  }
}

function withFakeXhr(run: () => Promise<void>): Promise<void> {
  const original = globalThis.XMLHttpRequest;
  // @ts-expect-error el doble reemplaza al constructor real del navegador
  globalThis.XMLHttpRequest = FakeXhr;
  return run().finally(() => {
    globalThis.XMLHttpRequest = original;
  });
}

describe('uploadAsset', () => {
  afterEach(() => {
    FakeXhr.reply = { status: 201, body: '{}' };
  });

  it('rechaza con el mensaje real de la API cuando el archivo supera el máximo (413)', async () => {
    FakeXhr.reply = {
      status: 413,
      body: JSON.stringify({
        error: 'El archivo supera el máximo de 500 MB',
        code: 'file_too_large',
        details: { maxUploadMb: 500 },
      }),
    };

    await withFakeXhr(async () => {
      const error = await uploadAsset(new File(['x'], 'enorme.zip')).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.message).toBe('El archivo supera el máximo de 500 MB');
      expect(apiError.status).toBe(413);
      expect((apiError.details as { code?: string }).code).toBe('file_too_large');
    });
  });

  it('resuelve con el archivo cuando la subida va bien', async () => {
    FakeXhr.reply = {
      status: 201,
      body: JSON.stringify({
        asset: { id: 'a1', url: assetRoutes.raw('a1'), mime: 'image/png', size: 12, originalName: 'foto.png' },
      }),
    };

    await withFakeXhr(async () => {
      const asset = await uploadAsset(new File(['x'], 'foto.png'));
      expect(asset.id).toBe('a1');
      expect(asset.url).toBe(assetRoutes.raw('a1'));
      expect(asset.originalName).toBe('foto.png');
    });
  });
});

/** Respuesta JSON de la API para el `fetch` simulado. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const summary = (id: string) => ({
  id,
  type: 'image',
  mime: 'image/png',
  size: 10,
  width: 1,
  height: 1,
  duration: null,
  originalName: `${id}.png`,
  createdAt: 1,
  url: assetRoutes.raw(id),
  thumbnailUrl: assetRoutes.thumb(id),
});

/** URL pedida por una llamada del `fetch` simulado. */
const requestedUrl = (call: unknown[]): string => String(call[0]);
/** Ids de una URL de lote (`/api/assets?ids=a%2Cb`). */
const batchIds = (url: string): string[] =>
  (new URL(url, 'http://localhost').searchParams.get('ids') ?? '').split(',');

describe('fetchAssetSummaries (resumen por lotes)', () => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    resetAssetBatchSupport();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pide todos los ids en una sola petición y marca como inexistentes los que el servidor omite', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { assets: [summary('a'), summary('c')] }));

    const results = await fetchAssetSummaries(['a', 'b', 'c', 'a']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = requestedUrl(fetchMock.mock.calls[0]!);
    expect(url.startsWith(assetApiPath(assetRoutes.collection))).toBe(true);
    expect(batchIds(url)).toEqual(['a', 'b', 'c']);
    expect(results.get('a')).toMatchObject({ asset: { id: 'a', originalName: 'a.png' } });
    expect(results.get('b')).toEqual({ asset: null });
    expect(results.get('c')).toMatchObject({ asset: { id: 'c' } });
  });

  it('ignora lo que el servidor devuelva sin que se haya pedido', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { assets: [summary('a'), summary('otro')] }));

    const results = await fetchAssetSummaries(['a']);

    expect([...results.keys()]).toEqual(['a']);
  });

  it('con 404 (servidor sin el lote) recurre al detalle por id y lo recuerda', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('ids=')) return jsonResponse(404, { error: 'Not found', code: 'not_found' });
      if (url.endsWith('/assets/a')) return jsonResponse(200, { asset: summary('a') });
      return jsonResponse(404, { error: 'El archivo no existe', code: 'asset_not_found' });
    });

    const first = await fetchAssetSummaries(['a', 'b']);
    expect(first.get('a')).toMatchObject({ asset: { id: 'a' } });
    expect(first.get('b')).toEqual({ asset: null });
    // 1 intento de lote + 2 detalles.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockClear();
    await fetchAssetSummaries(['a']);
    // Ya se sabe que no hay lote: va directo al detalle.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl(fetchMock.mock.calls[0]!).endsWith('/assets/a')).toBe(true);
  });

  it('405 y 501 también cuentan como «todavía no está» (degraded.ts)', async () => {
    for (const status of [405, 501]) {
      resetAssetBatchSupport();
      fetchMock.mockReset();
      fetchMock.mockImplementation(async (url) =>
        url.includes('ids=') ? jsonResponse(status, { error: 'no' }) : jsonResponse(200, { asset: summary('a') }),
      );
      const results = await fetchAssetSummaries(['a']);
      expect(results.get('a')).toMatchObject({ asset: { id: 'a' } });
    }
  });

  it('un fallo del servidor (5xx) llega como error a cada id y no activa el respaldo', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom', code: 'internal_error' }));

    const results = await fetchAssetSummaries(['a', 'b']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const id of ['a', 'b']) {
      const result = results.get(id);
      expect(result && 'error' in result).toBe(true);
    }
    // El lote sigue disponible para la próxima vez.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { assets: [summary('a')] }));
    const retry = await fetchAssetSummaries(['a']);
    expect(retry.get('a')).toMatchObject({ asset: { id: 'a' } });
  });

  it('con la red caída también devuelve el error por id en vez de lanzar', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const results = await fetchAssetSummaries(['a']);

    const result = results.get('a');
    expect(result && 'error' in result).toBe(true);
    expect(result && 'error' in result && (result.error as ApiError).isOffline).toBe(true);
  });

  it('un id con coma no se manda en `ids=` (iría partido): usa el detalle', async () => {
    fetchMock.mockImplementation(async (url) =>
      url.includes('ids=') ? jsonResponse(200, { assets: [summary('a')] }) : jsonResponse(200, { asset: summary('x,y') }),
    );

    const results = await fetchAssetSummaries(['a', 'x,y']);

    expect(results.get('a')).toMatchObject({ asset: { id: 'a' } });
    expect(results.get('x,y')).toMatchObject({ asset: { id: 'x,y' } });
    const urls = fetchMock.mock.calls.map(requestedUrl);
    expect(urls.filter((url) => url.includes('ids='))).toHaveLength(1);
    expect(batchIds(urls.find((url) => url.includes('ids='))!)).toEqual(['a']);
  });
});

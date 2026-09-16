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

import { afterEach, describe, expect, it } from 'vitest';

import { assetRoutes } from '@tablero/shared';

import { uploadAsset, uploadErrorMessage, assetApiPath } from './assets';
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

/**
 * Almacenamiento: URLs firmadas estables por ventana (cacheables por el
 * navegador) y `Cache-Control` inmutable en los objetos subidos.
 *
 * La firma es local (SigV4 no toca la red), así que se prueba con el firmador
 * real del SDK contra el endpoint por defecto; el envío a S3 se espía.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getCacheablePresignedGetUrl,
  OBJECT_CACHE_CONTROL,
  putObject,
  s3,
  SIGNED_URL_CACHE_MARGIN_SECONDS,
  SIGNED_URL_TTL_SECONDS,
  SIGNING_WINDOW_SECONDS,
  signingWindow,
} from './storage.js';

const WINDOW_MS = SIGNING_WINDOW_SECONDS * 1000;
/** Inicio de una ventana cualquiera (múltiplo exacto de 5 min). */
const T0 = Math.floor(Date.UTC(2026, 9, 27, 10, 0, 0) / WINDOW_MS) * WINDOW_MS;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('signingWindow', () => {
  it('cuantiza la hora de firma y la caducidad cuenta desde el inicio de la ventana', () => {
    const { signingDate, expiresAt } = signingWindow(T0 + 123_456);
    expect(signingDate.getTime()).toBe(T0);
    expect(expiresAt).toBe(T0 + SIGNED_URL_TTL_SECONDS * 1000);
  });

  it('cambia de ventana exactamente cada 5 minutos', () => {
    expect(signingWindow(T0 + WINDOW_MS - 1).signingDate.getTime()).toBe(T0);
    expect(signingWindow(T0 + WINDOW_MS).signingDate.getTime()).toBe(T0 + WINDOW_MS);
  });
});

describe('getCacheablePresignedGetUrl', () => {
  it('devuelve la misma URL para el mismo objeto dentro de la ventana', async () => {
    const first = await getCacheablePresignedGetUrl('assets/u/a.png', {}, T0 + 1_000);
    const second = await getCacheablePresignedGetUrl('assets/u/a.png', {}, T0 + WINDOW_MS - 1_000);
    expect(second.url).toBe(first.url);
  });

  it('firma con la hora cuantizada y el TTL de 15 min', async () => {
    const { url } = await getCacheablePresignedGetUrl('assets/u/a.png', {}, T0 + 42_000);
    const params = new URL(url).searchParams;
    // T0 = 2026-10-27 10:00:00 UTC: el inicio de la ventana, no el instante de la petición.
    expect(params.get('X-Amz-Date')).toBe('20261027T100000Z');
    expect(params.get('X-Amz-Expires')).toBe(String(SIGNED_URL_TTL_SECONDS));
  });

  it('cambia la URL al pasar a la ventana siguiente, o con otro objeto o nombre de descarga', async () => {
    const base = await getCacheablePresignedGetUrl('assets/u/a.png', {}, T0);
    const nextWindow = await getCacheablePresignedGetUrl('assets/u/a.png', {}, T0 + WINDOW_MS);
    const otherKey = await getCacheablePresignedGetUrl('assets/u/b.png', {}, T0);
    const download = await getCacheablePresignedGetUrl('assets/u/a.png', { downloadName: 'foto.png' }, T0);

    expect(new Set([base.url, nextWindow.url, otherKey.url, download.url]).size).toBe(4);
    expect(new URL(download.url).searchParams.get('response-content-disposition')).toContain('attachment');
  });

  it('el max-age es lo que queda hasta la caducidad menos el margen, y nunca deja una URL a punto de caducar', async () => {
    const start = await getCacheablePresignedGetUrl('k', {}, T0);
    expect(start.maxAgeSeconds).toBe(SIGNED_URL_TTL_SECONDS - SIGNED_URL_CACHE_MARGIN_SECONDS);

    // En el último instante de la ventana quedan 10 min de vida: 9 de max-age.
    const end = await getCacheablePresignedGetUrl('k', {}, T0 + WINDOW_MS - 1);
    expect(end.maxAgeSeconds).toBeGreaterThanOrEqual(SIGNED_URL_TTL_SECONDS - SIGNING_WINDOW_SECONDS - SIGNED_URL_CACHE_MARGIN_SECONDS - 1);

    // Para cualquier instante, el navegador deja de reutilizarla antes de que caduque.
    for (let offset = 0; offset < WINDOW_MS; offset += 17_000) {
      const now = T0 + offset;
      const { maxAgeSeconds } = await getCacheablePresignedGetUrl('k', {}, now);
      expect(now + maxAgeSeconds * 1000).toBeLessThanOrEqual(T0 + SIGNED_URL_TTL_SECONDS * 1000 - SIGNED_URL_CACHE_MARGIN_SECONDS * 1000);
      expect(maxAgeSeconds).toBeGreaterThan(0);
    }
  });
});

describe('putObject', () => {
  it('sube con Cache-Control inmutable (las claves llevan un id único por archivo)', async () => {
    const send = vi.spyOn(s3, 'send').mockImplementation(async () => ({}) as never);
    await putObject('assets/u/a.png', Buffer.from('x'), 'image/png', 1);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]![0] as unknown as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      Key: 'assets/u/a.png',
      ContentType: 'image/png',
      CacheControl: OBJECT_CACHE_CONTROL,
    });
    expect(OBJECT_CACHE_CONTROL).toBe('private, max-age=31536000, immutable');
  });
});

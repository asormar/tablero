/**
 * Cliente de Nominatim: `User-Agent` propio, límite de una consulta por segundo
 * y caché corta en memoria.
 *
 * El reloj, la espera y el `fetch` se inyectan: los tests miden el espaciado de
 * las consultas y la caducidad de la caché sin esperar de verdad ni tocar la red.
 */

import { describe, expect, it } from 'vitest';

import { GeocodeClient } from './geocode.js';
import { HttpError } from './errors.js';

const NOMINATIM_ENTRY = {
  place_id: 12345,
  lat: '-34.6037',
  lon: '-58.3816',
  display_name: 'Buenos Aires, Argentina',
  type: 'city',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Reloj falso: `sleep` mueve el tiempo hacia adelante. */
function fakeClock(start = 1_000_000) {
  let now = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

describe('GeocodeClient', () => {
  it('consulta Nominatim con User-Agent propio y normaliza la respuesta', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = new GeocodeClient({
      minIntervalMs: 0,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse([NOMINATIM_ENTRY, { place_id: 2, lat: 'no-numérico', lon: '0' }]);
      },
    });

    const outcome = await client.search('Buenos Aires', 3);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin).toBe('https://nominatim.openstreetmap.org');
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('Buenos Aires');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('3');
    expect(url.searchParams.get('accept-language')).toBe('es');

    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get('user-agent')).toMatch(/^Tablero/);
    expect(headers.get('user-agent')).not.toBe('node');

    // La entrada sin coordenadas se descarta; el resto sale normalizado.
    expect(outcome).toEqual({
      results: [{ id: '12345', label: 'Buenos Aires, Argentina', lat: -34.6037, lng: -58.3816, type: 'city' }],
      cached: false,
    });
  });

  it('cachea los resultados 10 minutos y no repite la consulta', async () => {
    const clock = fakeClock();
    let fetches = 0;
    const client = new GeocodeClient({
      minIntervalMs: 0,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: async () => {
        fetches += 1;
        return jsonResponse([NOMINATIM_ENTRY]);
      },
    });

    const first = await client.search('Córdoba', 5);
    const second = await client.search('  córdoba  ', 5); // misma clave: espacios y mayúsculas no cuentan
    expect(fetches).toBe(1);
    expect(second.cached).toBe(true);
    expect(second.results).toEqual(first.results);

    // Otra clave (otro límite) sí consulta.
    await client.search('Córdoba', 8);
    expect(fetches).toBe(2);

    // Pasado el TTL, vuelve a consultar.
    clock.advance(10 * 60 * 1000 + 1);
    const third = await client.search('Córdoba', 5);
    expect(fetches).toBe(3);
    expect(third.cached).toBe(false);
  });

  it('respeta el límite de una consulta por segundo (espaciado real de la cola)', async () => {
    const clock = fakeClock();
    const requestTimes: number[] = [];
    const client = new GeocodeClient({
      minIntervalMs: 1000,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: async () => {
        requestTimes.push(clock.now());
        return jsonResponse([NOMINATIM_ENTRY]);
      },
    });

    await client.search('uno', 5);
    await client.search('dos', 5);
    await client.search('tres', 5);

    expect(requestTimes).toHaveLength(3);
    // Cada consulta esperó el segundo completo que dejó la anterior.
    expect(clock.sleeps).toEqual([1000, 1000]);
    for (let i = 1; i < requestTimes.length; i += 1) {
      expect(requestTimes[i]! - requestTimes[i - 1]!).toBeGreaterThanOrEqual(1000);
    }
  });

  it('serializa las consultas simultáneas: nunca hay dos pedidos en vuelo', async () => {
    const clock = fakeClock();
    let inFlight = 0;
    let maxInFlight = 0;
    const client = new GeocodeClient({
      minIntervalMs: 1000,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return jsonResponse([NOMINATIM_ENTRY]);
      },
    });

    await Promise.all([client.search('a', 5), client.search('b', 5), client.search('c', 5)]);

    expect(maxInFlight).toBe(1);
    expect(clock.sleeps).toEqual([1000, 1000]);
  });

  it('si Nominatim responde con error, devuelve 502 (no una lista vacía)', async () => {
    const client = new GeocodeClient({ minIntervalMs: 0, fetchImpl: async () => jsonResponse({ error: 'no' }, 429) });

    await expect(client.search('Rosario', 5)).rejects.toMatchObject({
      statusCode: 502,
      code: 'geocode_upstream_error',
    });
  });

  it('si la red falla, devuelve 502', async () => {
    const client = new GeocodeClient({
      minIntervalMs: 0,
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });

    const error = await client.search('Mendoza', 5).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 502, code: 'geocode_unreachable' });
  });

  it('si la respuesta no es JSON, devuelve 502', async () => {
    const client = new GeocodeClient({
      minIntervalMs: 0,
      fetchImpl: async () => new Response('<html>bloqueado</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    });

    await expect(client.search('La Plata', 5)).rejects.toMatchObject({
      statusCode: 502,
      code: 'geocode_bad_response',
    });
  });

  it('una consulta que falla no rompe la cola: la siguiente sale igual', async () => {
    const clock = fakeClock();
    let calls = 0;
    const client = new GeocodeClient({
      minIntervalMs: 1000,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new Error('se cayó');
        return jsonResponse([NOMINATIM_ENTRY]);
      },
    });

    await expect(client.search('falla', 5)).rejects.toThrow();
    const ok = await client.search('funciona', 5);
    expect(ok.cached).toBe(false);
    expect(ok.results).toHaveLength(1);
    expect(clock.sleeps).toEqual([1000]);
  });
});

/**
 * GET /api/maps/search: validación de entrada, forma de la respuesta y errores.
 *
 * El cliente de Nominatim se dobla (`vi.mock('../lib/geocode.js')`): acá se
 * prueba la ruta, no la red. El límite de tasa y la caché tienen su propio test
 * en `lib/geocode.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { formatZodError, geocodeResponseSchema } from '@tablero/shared';

import { HttpError } from '../lib/errors.js';

const geocode = vi.hoisted(() => {
  const calls: { query: string; limit: number }[] = [];
  let outcome: { results: unknown[]; cached: boolean } = { results: [], cached: false };
  let failure: Error | null = null;

  return {
    calls,
    setOutcome: (next: { results: unknown[]; cached: boolean }) => {
      outcome = next;
      failure = null;
    },
    setFailure: (error: Error) => {
      failure = error;
    },
    reset: () => {
      calls.length = 0;
      outcome = { results: [], cached: false };
      failure = null;
    },
    geocoder: () => ({
      search: async (query: string, limit: number) => {
        calls.push({ query, limit });
        if (failure) throw failure;
        return outcome;
      },
    }),
  };
});

vi.mock('../lib/geocode.js', () => ({ geocoder: geocode.geocoder }));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    currentUser: () => ({
      id: 'user_ana',
      email: 'ana@tablero.test',
      name: 'Ana',
      avatarUrl: null,
      settings: {},
      createdAt: new Date(),
    }),
  };
});

const { mapsRoutes } = await import('./maps.js');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.statusCode).send(error.toApiError());
      return;
    }
    if (error instanceof ZodError || (error as { name?: string }).name === 'ZodError') {
      reply.code(400).send(formatZodError(error as unknown as ZodError));
      return;
    }
    reply.code(500).send({ error: (error as Error).message, code: 'internal_error' });
  });
  await app.register(mapsRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

beforeEach(() => {
  geocode.reset();
});

describe('GET /api/maps/search', () => {
  it('devuelve los resultados validados con Zod y el límite pedido', async () => {
    geocode.setOutcome({
      results: [{ id: '1', label: 'Buenos Aires, Argentina', lat: -34.6, lng: -58.4, type: 'city' }],
      cached: false,
    });
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/api/maps/search?q=Buenos%20Aires&limit=3' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { results: unknown[]; cached: boolean };
    expect(() => geocodeResponseSchema.parse(body)).not.toThrow();
    expect(body.cached).toBe(false);
    expect(body.results).toEqual([{ id: '1', label: 'Buenos Aires, Argentina', lat: -34.6, lng: -58.4, type: 'city' }]);
    expect(geocode.calls).toEqual([{ query: 'Buenos Aires', limit: 3 }]);
    await app.close();
  });

  it('usa el límite por defecto (5) y propaga el estado de la caché', async () => {
    geocode.setOutcome({ results: [], cached: true });
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/api/maps/search?q=Rosario' });

    expect(response.statusCode).toBe(200);
    expect(response.json().cached).toBe(true);
    expect(geocode.calls).toEqual([{ query: 'Rosario', limit: 5 }]);
    await app.close();
  });

  it('rechaza una consulta vacía o un límite fuera de rango', async () => {
    const app = await buildApp();

    const empty = await app.inject({ method: 'GET', url: '/api/maps/search?q=' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().code).toBe('validation_error');

    const missing = await app.inject({ method: 'GET', url: '/api/maps/search' });
    expect(missing.statusCode).toBe(400);

    const tooMany = await app.inject({ method: 'GET', url: '/api/maps/search?q=Rosario&limit=99' });
    expect(tooMany.statusCode).toBe(400);

    // Ninguna petición inválida llegó al buscador.
    expect(geocode.calls).toHaveLength(0);
    await app.close();
  });

  it('traduce el fallo de Nominatim a 502', async () => {
    geocode.setFailure(new HttpError(502, 'El buscador de lugares respondió 503', 'geocode_upstream_error'));
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/api/maps/search?q=Mendoza' });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: 'geocode_upstream_error' });
    await app.close();
  });
});

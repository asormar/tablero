/**
 * Ajustes (§7.7): valores por defecto, merge del PATCH y token de captura.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { formatZodError } from '@tablero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../lib/errors.js';

const store = vi.hoisted(() => {
  let settings: unknown = {};
  const prisma = {
    user: {
      findUniqueOrThrow: async () => ({ settings, captureToken: 'tok_captura_123' }),
      update: async ({ data }: { data: { settings: unknown } }) => {
        settings = data.settings;
        return { settings, captureToken: 'tok_captura_123' };
      },
    },
  };
  return {
    prisma,
    getSettings: () => settings,
    setSettings: (value: unknown) => {
      settings = value;
    },
  };
});

vi.mock('../db.js', () => ({ prisma: store.prisma }));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    currentUser: () => ({
      id: 'user_ana',
      email: 'ana@tablero.test',
      name: 'Ana',
      avatarUrl: null,
      settings: store.getSettings(),
      createdAt: new Date(),
    }),
  };
});

const { settingsRoutes } = await import('./settings.js');

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
  await app.register(settingsRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

beforeEach(() => {
  store.setSettings({});
});

describe('GET /api/settings', () => {
  it('devuelve los valores por defecto y el token de captura', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      settings: {
        theme: 'system',
        language: 'es',
        canvasBackground: 'dots',
        showGuides: true,
        snapToGrid: true,
        showMinimap: false,
      },
      captureToken: 'tok_captura_123',
    });
    await app.close();
  });

  it('aplica lo guardado y descarta claves desconocidas o inválidas', async () => {
    store.setSettings({ theme: 'dark', language: 'en', basura: true, canvasBackground: 'inexistente' });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(response.json().settings).toEqual({
      theme: 'dark',
      language: 'en',
      canvasBackground: 'dots',
      showGuides: true,
      snapToGrid: true,
      showMinimap: false,
    });
    await app.close();
  });
});

describe('PATCH /api/settings', () => {
  it('mezcla el cambio con lo existente', async () => {
    store.setSettings({ theme: 'light', showGuides: false });
    const app = await buildApp();
    const response = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { theme: 'dark', snapToGrid: false } });
    expect(response.statusCode).toBe(200);
    expect(response.json().settings).toEqual({
      theme: 'dark',
      language: 'es',
      canvasBackground: 'dots',
      showGuides: false,
      snapToGrid: false,
      showMinimap: false,
    });
    expect(store.getSettings()).toMatchObject({ theme: 'dark', showGuides: false, snapToGrid: false });
    await app.close();
  });

  it('rechaza un valor fuera del enum', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { theme: 'neón' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('validation_error');
    await app.close();
  });

  it('rechaza un cuerpo sin campos', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'PATCH', url: '/api/settings', payload: {} });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

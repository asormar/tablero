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
  let captureToken = 'tok_captura_123';
  const prisma = {
    user: {
      findUniqueOrThrow: async () => ({ settings, captureToken }),
      update: async ({ data }: { data: { settings?: unknown; captureToken?: string } }) => {
        if (data.settings !== undefined) settings = data.settings;
        if (data.captureToken !== undefined) captureToken = data.captureToken;
        return { settings, captureToken };
      },
    },
  };
  return {
    prisma,
    getSettings: () => settings,
    setSettings: (value: unknown) => {
      settings = value;
    },
    getCaptureToken: () => captureToken,
    setCaptureToken: (value: string) => {
      captureToken = value;
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
  store.setCaptureToken('tok_captura_123');
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

describe('POST /api/settings/capture-token', () => {
  it('rota el token: devuelve uno nuevo aleatorio y el anterior deja de valer', async () => {
    const previous = store.getCaptureToken();
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/settings/capture-token' });
    expect(response.statusCode).toBe(200);

    const rotated = String(response.json().captureToken ?? '');
    // 32 bytes en base64url: 43 caracteres, sin `+` ni `/` ni padding.
    expect(rotated).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated).not.toBe(previous);
    expect(store.getCaptureToken()).toBe(rotated);

    // El valor que muestran los ajustes es el nuevo.
    const settings = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(settings.json().captureToken).toBe(rotated);
    await app.close();
  });

  it('dos rotaciones seguidas dan tokens distintos', async () => {
    const app = await buildApp();
    const first = String((await app.inject({ method: 'POST', url: '/api/settings/capture-token' })).json().captureToken);
    const second = String((await app.inject({ method: 'POST', url: '/api/settings/capture-token' })).json().captureToken);
    expect(first).not.toBe(second);
    await app.close();
  });
});

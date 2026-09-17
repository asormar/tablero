/**
 * Almacenamiento (§7.7): espacio usado, detección de huérfanos y borrado
 * (fila + objetos), recalculado en el servidor.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { addElement, createBoardDoc } from '@tablero/shared';
import * as Y from 'yjs';
import { ZodError } from 'zod';
import { formatZodError } from '@tablero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../lib/errors.js';

type AssetRow = {
  id: string;
  ownerId: string;
  type: string;
  mime: string;
  size: number;
  sha256: string | null;
  boardId: string | null;
  storageKey: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumbnailKey: string | null;
  originalName: string;
  createdAt: Date;
};

const db = vi.hoisted(() => {
  const assets = new Map<string, AssetRow>();
  const documents = new Map<string, Buffer>();
  const deletedObjects: string[] = [];

  const prisma = {
    board: {
      findMany: async () => [
        {
          id: 'board_uno',
          ownerId: 'user_ana',
          parentBoardId: null,
          title: 'Inicio',
          icon: null,
          color: null,
          coverImageId: 'asset_portada',
          isTemplate: false,
          publishedSlug: null,
          trashedAt: null,
          favoriteAt: null,
          isUnsorted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
    share: { findMany: async () => [] },
    boardDocument: {
      findMany: async ({ where }: { where: { boardId: { in: string[] } } }) =>
        [...documents.entries()]
          .filter(([boardId]) => where.boardId.in.includes(boardId))
          .map(([boardId, yjsState]) => ({ boardId, yjsState })),
    },
    asset: {
      findMany: async () => [...assets.values()].map((row) => ({ ...row })),
      delete: async ({ where }: { where: { id: string } }) => {
        assets.delete(where.id);
        return { id: where.id };
      },
    },
  };

  const makeAsset = (overrides: Partial<AssetRow> & { id: string }): AssetRow => {
    const row: AssetRow = {
      ownerId: 'user_ana',
      type: 'image',
      mime: 'image/png',
      size: 100,
      sha256: null,
      boardId: null,
      storageKey: `assets/user_ana/${overrides.id}.png`,
      width: 1,
      height: 1,
      duration: null,
      thumbnailKey: `thumbs/user_ana/${overrides.id}.webp`,
      originalName: 'foto.png',
      createdAt: new Date(),
      ...overrides,
    };
    assets.set(row.id, row);
    return row;
  };

  return {
    prisma,
    assets,
    documents,
    deletedObjects,
    makeAsset,
    reset: () => {
      assets.clear();
      documents.clear();
      deletedObjects.length = 0;
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

vi.mock('../lib/storage.js', () => ({
  deleteObject: async (key: string) => {
    db.deletedObjects.push(key);
  },
  ensureBucket: async () => true,
}));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    currentUser: () => ({ id: 'user_ana', email: 'ana@tablero.test', name: 'Ana', avatarUrl: null, settings: {}, createdAt: new Date() }),
  };
});

const { storageRoutes } = await import('./storage.js');

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
  await app.register(storageRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

/** Documento con una nota que referencia un asset. */
function documentWithAsset(assetId: string): Buffer {
  const doc = createBoardDoc();
  const id = addElement(doc, 'image', { createdBy: 'ana', x: 0, y: 0, width: 200, assetId }, 'test');
  void id;
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

beforeEach(() => {
  db.reset();
});

describe('GET /api/storage', () => {
  it('suma el espacio usado y encuentra los huérfanos', async () => {
    db.makeAsset({ id: 'asset_usado', size: 150 });
    db.makeAsset({ id: 'asset_huerfano', size: 40, originalName: 'suelto.png' });
    db.documents.set('board_uno', documentWithAsset('asset_usado'));

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/storage' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.usedBytes).toBe(190);
    expect(body.assetCount).toBe(2);
    expect(body.orphanCount).toBe(1);
    expect(body.orphaned[0]).toMatchObject({ id: 'asset_huerfano', originalName: 'suelto.png', size: 40 });
    expect(body.boardsScanned).toBe(1);
    await app.close();
  });

  it('la portada de un tablero cuenta como referencia', async () => {
    db.makeAsset({ id: 'asset_portada', size: 10 });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/storage' });
    expect(response.json().orphanCount).toBe(0);
    await app.close();
  });
});

describe('DELETE /api/storage/orphans', () => {
  it('borra filas y objetos de los huérfanos reales y deja los usados', async () => {
    db.makeAsset({ id: 'asset_usado', size: 150 });
    db.makeAsset({ id: 'asset_huerfano', size: 40 });
    db.documents.set('board_uno', documentWithAsset('asset_usado'));

    const app = await buildApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/storage/orphans' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, deleted: 1, freedBytes: 40, failures: [] });
    expect(db.assets.has('asset_huerfano')).toBe(false);
    expect(db.assets.has('asset_usado')).toBe(true);
    expect(db.deletedObjects).toEqual(['assets/user_ana/asset_huerfano.png', 'thumbs/user_ana/asset_huerfano.webp']);

    const after = await app.inject({ method: 'GET', url: '/api/storage' });
    expect(after.json()).toMatchObject({ orphanCount: 0, assetCount: 1, usedBytes: 150 });
    await app.close();
  });

  it('no borra nada cuando no hay huérfanos', async () => {
    db.makeAsset({ id: 'asset_usado' });
    db.documents.set('board_uno', documentWithAsset('asset_usado'));
    const app = await buildApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/storage/orphans' });
    expect(response.json()).toMatchObject({ deleted: 0, freedBytes: 0 });
    await app.close();
  });
});

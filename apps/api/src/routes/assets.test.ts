/**
 * Archivos (rutas): el borrado comprueba referencias antes de tocar la fila y
 * los objetos. Un archivo en uso responde 409 `asset_in_use` (con
 * `?force=true` se borra igual); uno sin referencias se borra como siempre.
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

type BoardRow = {
  id: string;
  ownerId: string;
  parentBoardId: string | null;
  title: string;
  icon: string | null;
  color: string | null;
  coverImageId: string | null;
  isTemplate: boolean;
  publishedSlug: string | null;
  publishedPasswordHash: string | null;
  publishedAt: Date | null;
  publicIncludeSubBoards: boolean;
  trashedAt: Date | null;
  favoriteAt: Date | null;
  isUnsorted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const db = vi.hoisted(() => {
  const assets = new Map<string, AssetRow>();
  const boards = new Map<string, BoardRow>();
  const documents = new Map<string, Buffer>();
  const deletedObjects: string[] = [];

  const boardRow = (id: string, overrides: Partial<BoardRow> = {}): BoardRow => {
    const row: BoardRow = {
      id,
      ownerId: 'user_ana',
      parentBoardId: null,
      title: id,
      icon: null,
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      publishedPasswordHash: null,
      publishedAt: null,
      publicIncludeSubBoards: false,
      trashedAt: null,
      favoriteAt: null,
      isUnsorted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    boards.set(id, row);
    return row;
  };

  const assetRow = (overrides: Partial<AssetRow> & { id: string }): AssetRow => {
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

  const prisma = {
    asset: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = assets.get(where.id);
        return row ? { ...row } : null;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        assets.delete(where.id);
        return { id: where.id };
      },
    },
    board: {
      findMany: async () => [...boards.values()].map((row) => ({ ...row })),
    },
    boardMember: { findMany: async () => [] },
    boardDocument: {
      findMany: async ({ where }: { where: { boardId: { in: string[] } } }) =>
        [...documents.entries()]
          .filter(([boardId]) => where.boardId.in.includes(boardId))
          .map(([boardId, yjsState]) => ({ boardId, yjsState })),
    },
  };

  return {
    prisma,
    assets,
    boards,
    documents,
    deletedObjects,
    boardRow,
    assetRow,
    reset: () => {
      assets.clear();
      boards.clear();
      documents.clear();
      deletedObjects.length = 0;
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

/**
 * Servidor de colaboración simulado: el documento vivo del tablero, si hay uno
 * abierto en memoria (es lo que va por delante del persistido).
 */
const collab = vi.hoisted(() => ({ live: null as unknown }));

vi.mock('../collab/server.js', () => ({
  liveBoardDocument: () => collab.live as Y.Doc | null,
}));

vi.mock('../lib/storage.js', () => ({
  deleteObject: async (key: string) => {
    db.deletedObjects.push(key);
  },
  putObject: async () => undefined,
  getPresignedGetUrl: async () => 'https://minio.example/signed',
  headObject: async () => null,
  ensureBucket: async () => true,
  getObjectStream: async () => null,
  assetKey: (userId: string, assetId: string, extension: string) => `assets/${userId}/${assetId}.${extension}`,
  thumbnailKey: (userId: string, assetId: string) => `thumbs/${userId}/${assetId}.webp`,
  SIGNED_URL_TTL_SECONDS: 900,
}));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    currentUser: () => ({ id: 'user_ana', email: 'ana@tablero.test', name: 'Ana', avatarUrl: null, settings: {}, createdAt: new Date() }),
  };
});

const { assetsRoutes } = await import('./assets.js');

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
  await app.register(assetsRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

/** Documento con una imagen que referencia el asset. */
function documentWithAsset(assetId: string): Buffer {
  const doc = createBoardDoc();
  addElement(doc, 'image', { createdBy: 'ana', x: 0, y: 0, width: 200, assetId }, 'test');
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

beforeEach(() => {
  db.reset();
  collab.live = null;
  db.boardRow('board_uno');
});

describe('DELETE /api/assets/:id', () => {
  it('no borra un archivo en uso: 409 `asset_in_use` y nada desaparece', async () => {
    const asset = db.assetRow({ id: 'asset_en_uso' });
    db.documents.set('board_uno', documentWithAsset(asset.id));

    const app = await buildApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/assets/asset_en_uso' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'asset_in_use' });
    expect(db.assets.has('asset_en_uso')).toBe(true);
    expect(db.documents.get('board_uno')).toBeDefined();
    expect(db.deletedObjects).toEqual([]);
    await app.close();
  });

  it('también protege un archivo que solo está en el documento vivo (el persistido va por detrás)', async () => {
    const asset = db.assetRow({ id: 'asset_vivo' });
    // El persistido no referencia nada todavía.
    db.documents.set('board_uno', Buffer.from(Y.encodeStateAsUpdate(createBoardDoc())));

    const live = createBoardDoc();
    addElement(live, 'image', { createdBy: 'ana', x: 0, y: 0, width: 200, assetId: asset.id }, 'test');
    collab.live = live;

    const app = await buildApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/assets/asset_vivo' });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('asset_in_use');
    expect(db.assets.has('asset_vivo')).toBe(true);
    await app.close();
  });

  it('la portada de un tablero también cuenta como uso', async () => {
    db.assetRow({ id: 'asset_portada' });
    db.boardRow('board_uno', { coverImageId: 'asset_portada' });

    const app = await buildApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/assets/asset_portada' });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('asset_in_use');
    expect(db.assets.has('asset_portada')).toBe(true);
    await app.close();
  });

  it('con `?force=true` borra igual (fila + objetos)', async () => {
    const asset = db.assetRow({ id: 'asset_forzado' });
    db.documents.set('board_uno', documentWithAsset(asset.id));

    const app = await buildApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/assets/asset_forzado?force=true' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(db.assets.has('asset_forzado')).toBe(false);
    expect(db.deletedObjects).toEqual([asset.storageKey, asset.thumbnailKey]);
    await app.close();
  });

  it('borra un archivo sin referencias como antes', async () => {
    const asset = db.assetRow({ id: 'asset_suelto' });

    const app = await buildApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/assets/asset_suelto' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(db.assets.has('asset_suelto')).toBe(false);
    expect(db.deletedObjects).toEqual([asset.storageKey, asset.thumbnailKey]);
    await app.close();
  });

  it('un asset ajeno sigue siendo 404 (no se filtra su existencia)', async () => {
    db.assetRow({ id: 'asset_ajeno', ownerId: 'user_caro' });

    const app = await buildApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/assets/asset_ajeno' });
    expect(response.statusCode).toBe(404);
    expect(db.assets.has('asset_ajeno')).toBe(true);
    await app.close();
  });
});

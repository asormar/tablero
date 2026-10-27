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
  /** Firmas pedidas al almacenamiento (clave y nombre de descarga forzada). */
  const signed: { key: string; downloadName: string | null }[] = [];
  /** Lecturas del árbol de tableros (el resumen por lotes solo las hace si hace falta). */
  const boardReads = { count: 0 };

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
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        [...assets.values()].filter((row) => where.id.in.includes(row.id)).map((row) => ({ ...row })),
      delete: async ({ where }: { where: { id: string } }) => {
        assets.delete(where.id);
        return { id: where.id };
      },
    },
    board: {
      findMany: async () => {
        boardReads.count += 1;
        return [...boards.values()].map((row) => ({ ...row }));
      },
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
    signed,
    boardReads,
    boardRow,
    assetRow,
    reset: () => {
      assets.clear();
      boards.clear();
      documents.clear();
      deletedObjects.length = 0;
      signed.length = 0;
      boardReads.count = 0;
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
  getCacheablePresignedGetUrl: async (key: string, options: { downloadName?: string | null } = {}) => {
    db.signed.push({ key, downloadName: options.downloadName ?? null });
    return { url: `https://minio.example/signed/${key}`, maxAgeSeconds: 540 };
  },
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

describe('GET /api/assets/:id/raw y /thumb', () => {
  it('redirige a la URL firmada y deja que el navegador la cachee hasta poco antes de que caduque', async () => {
    const asset = db.assetRow({ id: 'asset_foto' });

    const app = await buildApp();
    const raw = await app.inject({ method: 'GET', url: '/api/assets/asset_foto/raw' });
    expect(raw.statusCode).toBe(302);
    expect(raw.headers.location).toBe(`https://minio.example/signed/${asset.storageKey}`);
    expect(raw.headers['cache-control']).toBe('private, max-age=540');
    expect(raw.headers.vary).toMatch(/cookie/i);

    const thumb = await app.inject({ method: 'GET', url: '/api/assets/asset_foto/thumb' });
    expect(thumb.statusCode).toBe(302);
    expect(thumb.headers.location).toBe(`https://minio.example/signed/${asset.thumbnailKey}`);
    expect(thumb.headers['cache-control']).toBe('private, max-age=540');
    expect(thumb.headers.vary).toMatch(/cookie/i);
    await app.close();
  });

  it('sin miniatura propia /thumb sirve el original', async () => {
    const asset = db.assetRow({ id: 'asset_sin_thumb', thumbnailKey: null });

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/assets/asset_sin_thumb/thumb' });
    expect(response.statusCode).toBe(302);
    expect(db.signed).toEqual([{ key: asset.storageKey, downloadName: null }]);
    await app.close();
  });

  it('una imagen normal se sirve en línea y SVG/HTML siguen forzando la descarga', async () => {
    db.assetRow({ id: 'asset_png' });
    db.assetRow({ id: 'asset_svg', mime: 'image/svg+xml', originalName: 'dibujo.svg' });
    db.assetRow({ id: 'asset_html', mime: 'text/html', originalName: 'pagina.html' });

    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/api/assets/asset_png/raw' });
    await app.inject({ method: 'GET', url: '/api/assets/asset_svg/raw' });
    await app.inject({ method: 'GET', url: '/api/assets/asset_html/raw' });
    await app.inject({ method: 'GET', url: '/api/assets/asset_png/raw?download=1' });

    expect(db.signed.map((entry) => entry.downloadName)).toEqual([null, 'dibujo.svg', 'pagina.html', 'foto.png']);
    await app.close();
  });

  it('un asset ajeno sin acceso por tablero responde 404 y no firma nada', async () => {
    db.assetRow({ id: 'asset_ajeno', ownerId: 'user_caro' });

    const app = await buildApp();
    for (const suffix of ['raw', 'thumb']) {
      const response = await app.inject({ method: 'GET', url: `/api/assets/asset_ajeno/${suffix}` });
      expect(response.statusCode).toBe(404);
      expect(response.headers.location).toBeUndefined();
    }
    expect(db.signed).toEqual([]);
    await app.close();
  });
});

describe('GET /api/assets?ids= (resumen por lotes)', () => {
  const idsOf = (response: { json: () => unknown }): string[] =>
    (response.json() as { assets: { id: string }[] }).assets.map((asset) => asset.id);

  it('devuelve los archivos propios con la misma forma que el detalle y en el orden pedido', async () => {
    db.assetRow({ id: 'asset_a' });
    db.assetRow({ id: 'asset_b', mime: 'application/pdf', type: 'file', originalName: 'doc.pdf', thumbnailKey: null });
    db.assetRow({ id: 'asset_c' });

    const app = await buildApp();
    const batch = await app.inject({ method: 'GET', url: '/api/assets?ids=asset_c,asset_a,asset_b' });
    expect(batch.statusCode).toBe(200);
    expect(idsOf(batch)).toEqual(['asset_c', 'asset_a', 'asset_b']);

    // Misma forma que `GET /api/assets/:id` para cada archivo.
    for (const asset of (batch.json() as { assets: { id: string }[] }).assets) {
      const single = await app.inject({ method: 'GET', url: `/api/assets/${asset.id}` });
      expect(single.json()).toEqual({ asset });
    }
    // Un PDF sin miniatura no tiene `thumbnailUrl` (como en el detalle).
    expect((batch.json() as { assets: { id: string; thumbnailUrl: string | null }[] }).assets[2]!.thumbnailUrl).toBeNull();
    // Todo era propio: no hizo falta cargar el árbol de tableros.
    expect(db.boardReads.count).toBe(0);
    await app.close();
  });

  it('omite sin distinguir los ids inexistentes y los de archivos ajenos sin acceso', async () => {
    db.assetRow({ id: 'asset_mio' });
    db.assetRow({ id: 'asset_ajeno', ownerId: 'user_caro' });
    db.boardRow('board_de_caro', { ownerId: 'user_caro' });
    db.assetRow({ id: 'asset_ajeno_en_su_tablero', ownerId: 'user_caro', boardId: 'board_de_caro' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/assets?ids=asset_ajeno,asset_mio,no_existe,asset_ajeno_en_su_tablero',
    });
    expect(response.statusCode).toBe(200);
    expect(idsOf(response)).toEqual(['asset_mio']);
    await app.close();
  });

  it('incluye un archivo ajeno si el usuario tiene acceso a su tablero (igual que el detalle)', async () => {
    // `board_uno` es de Ana: sus miembros suben archivos ahí y ella debe verlos.
    db.assetRow({ id: 'asset_de_caro', ownerId: 'user_caro', boardId: 'board_uno' });

    const app = await buildApp();
    const batch = await app.inject({ method: 'GET', url: '/api/assets?ids=asset_de_caro' });
    expect(idsOf(batch)).toEqual(['asset_de_caro']);
    const single = await app.inject({ method: 'GET', url: '/api/assets/asset_de_caro' });
    expect(single.statusCode).toBe(200);
    await app.close();
  });

  it('ignora vacíos y repetidos; sin ids devuelve una lista vacía', async () => {
    db.assetRow({ id: 'asset_a' });

    const app = await buildApp();
    const repeated = await app.inject({ method: 'GET', url: '/api/assets?ids=asset_a,,asset_a, asset_a ,' });
    expect(idsOf(repeated)).toEqual(['asset_a']);

    const empty = await app.inject({ method: 'GET', url: '/api/assets?ids=' });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ assets: [] });
    await app.close();
  });

  it('acepta hasta 100 ids y rechaza más con 400 `too_many_ids`', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `asset_${index}`);
    db.assetRow({ id: 'asset_0' });

    const app = await buildApp();
    const ok = await app.inject({ method: 'GET', url: `/api/assets?ids=${ids.slice(0, 100).join(',')}` });
    expect(ok.statusCode).toBe(200);
    expect(idsOf(ok)).toEqual(['asset_0']);

    const tooMany = await app.inject({ method: 'GET', url: `/api/assets?ids=${ids.join(',')}` });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json()).toMatchObject({ code: 'too_many_ids' });
    await app.close();
  });

  it('un id con forma inválida es un 400, no una consulta', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: `/api/assets?ids=${'x'.repeat(65)}` });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
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

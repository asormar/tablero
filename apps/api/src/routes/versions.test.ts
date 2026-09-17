/**
 * Historial de versiones (rutas): listado, previsualización, instantánea manual
 * y restauración (con el cierre de conexiones delegado al servidor de collab).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { addElement, createBoardDoc, ensureTextFragment, getOrderedElements, writeTextParagraphs } from '@tablero/shared';
import * as Y from 'yjs';
import { ZodError } from 'zod';
import { formatZodError } from '@tablero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../lib/errors.js';

const db = vi.hoisted(() => {
  type VersionRow = {
    id: string;
    boardId: string;
    yjsState: Buffer;
    elementCount: number;
    sizeBytes: number;
    origin: string;
    createdAt: Date;
  };
  const versions: VersionRow[] = [];
  const documents = new Map<string, Buffer>();
  let counter = 0;

  const boards = [
    {
      id: 'board_uno',
      ownerId: 'user_ana',
      parentBoardId: 'root',
      title: 'Tablero con historial',
      icon: null,
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      trashedAt: null,
      favoriteAt: null,
      isUnsorted: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const prisma = {
    board: { findMany: async () => boards.map((row) => ({ ...row })) },
    boardMember: { findMany: async () => [] },
    boardVersion: {
      findFirst: async ({ where }: { where: { id?: string; boardId?: string } }) => {
        const found = versions
          .filter((row) => (where.id === undefined || row.id === where.id) && (where.boardId === undefined || row.boardId === where.boardId))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return found[0] ? { ...found[0] } : null;
      },
      findMany: async ({ where }: { where: { boardId: string } }) =>
        versions
          .filter((row) => row.boardId === where.boardId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((row) => ({ ...row })),
      create: async ({ data }: { data: Omit<VersionRow, 'id'> }) => {
        const row: VersionRow = { id: `ver_${++counter}`, ...data };
        versions.push(row);
        return { ...row };
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        let count = 0;
        for (const id of where.id.in) {
          const index = versions.findIndex((row) => row.id === id);
          if (index >= 0) {
            versions.splice(index, 1);
            count += 1;
          }
        }
        return { count };
      },
    },
    boardDocument: {
      findUnique: async ({ where }: { where: { boardId: string } }) => {
        const bytes = documents.get(where.boardId);
        return bytes ? { boardId: where.boardId, yjsState: bytes, updatedAt: new Date() } : null;
      },
      upsert: async ({ where, create, update }: { where: { boardId: string }; create: { boardId: string; yjsState: Buffer }; update: { yjsState: Buffer } }) => {
        const bytes = documents.has(where.boardId) ? update.yjsState : create.yjsState;
        documents.set(where.boardId, bytes);
        return { boardId: where.boardId, yjsState: bytes, updatedAt: new Date() };
      },
    },
    searchIndex: { deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) },
    $transaction: async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
  };

  const docState = (text: string): Buffer => {
    const doc = createBoardDoc();
    const id = addElement(doc, 'note', { createdBy: 'ana', x: 0, y: 0, width: 300 }, 'test');
    const fragment = ensureTextFragment(doc, id, 'test');
    if (fragment) writeTextParagraphs(fragment, text, 'test');
    return Buffer.from(Y.encodeStateAsUpdate(doc));
  };

  return {
    prisma,
    versions,
    documents,
    docState,
    reset: () => {
      versions.length = 0;
      documents.clear();
      counter = 0;
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

const collab = vi.hoisted(() => ({
  closeBoardConnections: vi.fn(async () => ({ connections: 2, unloaded: true, waitedMs: 12 })),
  beginBoardRestore: vi.fn(),
  finishBoardRestore: vi.fn(),
}));

vi.mock('../collab/server.js', () => collab);

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    currentUser: () => ({ id: 'user_ana', email: 'ana@tablero.test', name: 'Ana', avatarUrl: null, settings: {}, createdAt: new Date() }),
  };
});

const { versionsRoutes } = await import('./versions.js');

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
  await app.register(versionsRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

function decodeState(bytes: Buffer): Y.Doc {
  const doc = createBoardDoc();
  Y.applyUpdate(doc, new Uint8Array(bytes));
  return doc;
}

beforeEach(() => {
  db.reset();
  collab.closeBoardConnections.mockClear();
  collab.beginBoardRestore.mockClear();
  collab.finishBoardRestore.mockClear();
});

describe('GET /api/boards/:id/versions', () => {
  it('lista las instantáneas más nuevas primero', async () => {
    db.versions.push(
      { id: 'ver_vieja', boardId: 'board_uno', yjsState: db.docState('vieja'), elementCount: 1, sizeBytes: 100, origin: 'auto', createdAt: new Date('2026-09-17T10:00:00Z') },
      { id: 'ver_nueva', boardId: 'board_uno', yjsState: db.docState('nueva'), elementCount: 3, sizeBytes: 200, origin: 'manual', createdAt: new Date('2026-09-17T12:00:00Z') },
    );
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/boards/board_uno/versions' });
    expect(response.statusCode).toBe(200);
    const versions = response.json().versions as { id: string; origin: string }[];
    expect(versions.map((version) => version.id)).toEqual(['ver_nueva', 'ver_vieja']);
    expect(versions[0]!.origin).toBe('manual');
    await app.close();
  });

  it('404 si el tablero no existe o no hay acceso', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/boards/no_existe/versions' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /api/boards/:id/versions/:vid', () => {
  it('devuelve la previsualización con los tipos de elemento', async () => {
    const doc = createBoardDoc();
    addElement(doc, 'note', { createdBy: 'ana', x: 0, y: 0 }, 'test');
    addElement(doc, 'note', { createdBy: 'ana', x: 0, y: 100 }, 'test');
    addElement(doc, 'todo', { createdBy: 'ana', x: 0, y: 200, items: [] }, 'test');
    db.versions.push({
      id: 'ver_uno',
      boardId: 'board_uno',
      yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)),
      elementCount: 3,
      sizeBytes: 300,
      origin: 'auto',
      createdAt: new Date(),
    });

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/boards/board_uno/versions/ver_uno' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      version: { id: 'ver_uno', origin: 'auto' },
      preview: { title: 'Tablero con historial', elementCount: 3, types: { note: 2, todo: 1 } },
    });

    const missing = await app.inject({ method: 'GET', url: '/api/boards/board_uno/versions/no_existe' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /api/boards/:id/versions', () => {
  it('crea una instantánea manual aunque la última sea reciente', async () => {
    db.documents.set('board_uno', db.docState('estado actual'));
    db.versions.push({
      id: 'ver_reciente',
      boardId: 'board_uno',
      yjsState: db.docState('reciente'),
      elementCount: 1,
      sizeBytes: 50,
      origin: 'auto',
      createdAt: new Date(),
    });

    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/boards/board_uno/versions', payload: {} });
    expect(response.statusCode).toBe(201);
    expect(response.json().version).toMatchObject({ origin: 'manual', elementCount: 1 });
    expect(db.versions).toHaveLength(2);
    await app.close();
  });

  it('409 si el tablero todavía no tiene documento', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/boards/board_uno/versions', payload: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('missing_document');
    await app.close();
  });
});

describe('POST /api/boards/:id/versions/:vid/restore', () => {
  it('cierra las conexiones, guarda el estado previo y sustituye el documento', async () => {
    const estadoViejo = db.docState('versión vieja');
    db.versions.push({
      id: 'ver_vieja',
      boardId: 'board_uno',
      yjsState: estadoViejo,
      elementCount: 1,
      sizeBytes: 80,
      origin: 'manual',
      createdAt: new Date('2026-09-17T10:00:00Z'),
    });
    db.documents.set('board_uno', db.docState('versión nueva con más cosas'));

    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/boards/board_uno/versions/ver_vieja/restore', payload: {} });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ ok: true, connectionsClosed: 2, documentUnloaded: true, waitedMs: 12, elements: 1 });
    expect(String(body.previousVersionId)).toContain('ver_');
    expect(collab.beginBoardRestore).toHaveBeenCalledWith('board_uno');
    expect(collab.closeBoardConnections).toHaveBeenCalledWith('board_uno');
    expect(collab.finishBoardRestore).toHaveBeenCalledWith('board_uno');

    // El documento persistido es el de la instantánea y quedó una `pre-restore`.
    expect(db.documents.get('board_uno')).toEqual(estadoViejo);
    const preRestore = db.versions.find((version) => version.origin === 'pre-restore');
    expect(preRestore).toBeDefined();
    const texts = getOrderedElements(decodeState(db.documents.get('board_uno')!)).map(() => 'x');
    expect(texts).toHaveLength(1);
    await app.close();
  });

  it('404 si la versión no pertenece al tablero', async () => {
    db.documents.set('board_uno', db.docState('algo'));
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/boards/board_uno/versions/no_existe/restore', payload: {} });
    expect(response.statusCode).toBe(404);
    expect(collab.closeBoardConnections).not.toHaveBeenCalled();
    await app.close();
  });
});

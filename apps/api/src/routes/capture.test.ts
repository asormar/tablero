/**
 * Captura rápida (§7.8): token personal (cabecera, sin `Origin`), sesión como
 * alternativa, tipos soportados y creación de la bandeja «Sin ordenar».
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { createBoardDoc, fragmentToPlainText, getOrderedElements, getTextFragment } from '@tablero/shared';
import * as Y from 'yjs';
import { ZodError } from 'zod';
import { formatZodError } from '@tablero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../lib/errors.js';

const db = vi.hoisted(() => {
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
    trashedAt: Date | null;
    favoriteAt: Date | null;
    isUnsorted: boolean;
    createdAt: Date;
    updatedAt: Date;
  };

  const boards = new Map<string, BoardRow>();
  const documents = new Map<string, Buffer>();
  const users = new Map<string, { id: string; email: string; name: string; avatarUrl: string | null; settings: unknown; createdAt: Date; captureToken: string; passwordHash: string }>();
  let counter = 0;

  const now = () => new Date();

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { captureToken?: string; email?: string } }) => {
        const found = [...users.values()].find(
          (user) =>
            (where.captureToken === undefined || user.captureToken === where.captureToken) &&
            (where.email === undefined || user.email === where.email),
        );
        return found ? { ...found } : null;
      },
      create: async ({ data }: { data: { email: string; name: string; passwordHash: string } }) => {
        const row = {
          id: `user_${++counter}`,
          email: data.email,
          name: data.name,
          avatarUrl: null,
          settings: {},
          createdAt: now(),
          captureToken: `tok_${counter}`,
          passwordHash: data.passwordHash,
        };
        users.set(row.id, row);
        return { ...row };
      },
    },
    board: {
      findMany: async () => [...boards.values()].map((row) => ({ ...row })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = boards.get(where.id);
        return row ? { ...row } : null;
      },
      findFirst: async ({ where }: { where: { ownerId?: string; isUnsorted?: boolean } }) => {
        const row = [...boards.values()].find(
          (candidate) =>
            (where.ownerId === undefined || candidate.ownerId === where.ownerId) &&
            (where.isUnsorted === undefined || candidate.isUnsorted === where.isUnsorted),
        );
        return row ? { ...row } : null;
      },
      create: async ({ data }: { data: Partial<BoardRow> & { ownerId: string; title: string } }) => {
        const row: BoardRow = {
          id: `board_${++counter}`,
          ownerId: data.ownerId,
          parentBoardId: data.parentBoardId ?? null,
          title: data.title,
          icon: data.icon ?? null,
          color: data.color ?? null,
          coverImageId: null,
          isTemplate: false,
          publishedSlug: null,
          trashedAt: null,
          favoriteAt: null,
          isUnsorted: data.isUnsorted ?? false,
          createdAt: now(),
          updatedAt: now(),
        };
        boards.set(row.id, row);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: Partial<BoardRow> }) => {
        let count = 0;
        for (const id of where.id.in) {
          const row = boards.get(id);
          if (!row) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    },
    boardMember: { findMany: async () => [] },
    boardDocument: {
      create: async ({ data }: { data: { boardId: string; yjsState: Buffer } }) => {
        documents.set(data.boardId, data.yjsState);
        return { boardId: data.boardId, yjsState: data.yjsState, updatedAt: now() };
      },
      findUnique: async ({ where }: { where: { boardId: string } }) => {
        const bytes = documents.get(where.boardId);
        return bytes ? { boardId: where.boardId, yjsState: bytes, updatedAt: now() } : null;
      },
      upsert: async ({ where, create, update }: { where: { boardId: string }; create: { boardId: string; yjsState: Buffer }; update: { yjsState: Buffer } }) => {
        const bytes = documents.has(where.boardId) ? update.yjsState : create.yjsState;
        documents.set(where.boardId, bytes);
        return { boardId: where.boardId, yjsState: bytes, updatedAt: now() };
      },
    },
    searchIndex: { deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) },
    $transaction: async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
  };

  return {
    prisma,
    boards,
    documents,
    users,
    reset: () => {
      boards.clear();
      documents.clear();
      users.clear();
      counter = 0;
    },
    seedUser: (token = 'tok_valido_123456') => {
      const row = {
        id: 'user_ana',
        email: 'ana@tablero.test',
        name: 'Ana',
        avatarUrl: null,
        settings: {},
        createdAt: now(),
        captureToken: token,
        passwordHash: 'hash',
      };
      users.set(row.id, row);
      const root: BoardRow = {
        id: 'root',
        ownerId: 'user_ana',
        parentBoardId: null,
        title: 'Inicio',
        icon: '🏠',
        color: null,
        coverImageId: null,
        isTemplate: false,
        publishedSlug: null,
        trashedAt: null,
        favoriteAt: null,
        isUnsorted: false,
        createdAt: now(),
        updatedAt: now(),
      };
      boards.set(root.id, root);
      return row;
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

/** Sin servidor de colaboración: se ejercita el camino del estado persistido. */
vi.mock('../collab/server.js', () => ({
  transactBoardDocument: async () => false,
  closeBoardConnections: async () => ({ connections: 0, unloaded: false, waitedMs: 0 }),
  beginBoardRestore: () => undefined,
  finishBoardRestore: () => undefined,
}));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    resolveSession: async (token: string) =>
      token === 'sesion-valida'
        ? {
            user: { id: 'user_ana', email: 'ana@tablero.test', name: 'Ana', avatarUrl: null, settings: {}, createdAt: new Date() },
            expiresAt: new Date(Date.now() + 3_600_000),
          }
        : null,
  };
});

const { captureRoutes } = await import('./capture.js');

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
  await app.register(captureRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

function decode(bytes: Buffer): Y.Doc {
  const doc = createBoardDoc();
  Y.applyUpdate(doc, new Uint8Array(bytes));
  return doc;
}

beforeEach(() => {
  db.reset();
  db.seedUser();
});

describe('POST /api/capture', () => {
  it('crea la nota en «Sin ordenar» con el token personal y sin cabecera Origin', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/capture',
      headers: { authorization: 'Bearer tok_valido_123456' },
      payload: { type: 'note', text: 'Una idea desde el móvil' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ ok: true, boardTitle: 'Sin ordenar', type: 'note', live: false });

    // La bandeja se creó sola y la nota está en el documento persistido.
    const unsorted = [...db.boards.values()].find((board) => board.isUnsorted);
    expect(unsorted).toBeDefined();
    const doc = decode(db.documents.get(unsorted!.id)!);
    const texts = getOrderedElements(doc).map((element) => fragmentToPlainText(getTextFragment(doc, element.id)));
    expect(texts.join(' ')).toContain('Una idea desde el móvil');
    await app.close();
  });

  it('también acepta el token por X-Capture-Token', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/capture',
      headers: { 'x-capture-token': 'tok_valido_123456' },
      payload: { type: 'note', text: 'Desde un atajo' },
    });
    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it('rechaza un token inválido y las peticiones sin credencial', async () => {
    const app = await buildApp();
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/capture',
      headers: { authorization: 'Bearer token-que-no-existe' },
      payload: { type: 'note', text: 'nope' },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().code).toBe('invalid_capture_token');

    const anonymous = await app.inject({ method: 'POST', url: '/api/capture', payload: { type: 'note', text: 'nope' } });
    expect(anonymous.statusCode).toBe(401);
    await app.close();
  });

  it('acepta la sesión del navegador como alternativa al token', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/capture',
      headers: { cookie: 'tablero_session=sesion-valida' },
      payload: { type: 'link', url: 'https://example.com/nota', title: 'Enlace guardado' },
    });
    expect(response.statusCode).toBe(201);
    const unsorted = [...db.boards.values()].find((board) => board.isUnsorted)!;
    const doc = decode(db.documents.get(unsorted.id)!);
    const link = getOrderedElements(doc).find((element) => element.type === 'link') as { url?: string } | undefined;
    expect(link?.url).toBe('https://example.com/nota');
    await app.close();
  });

  it('valida el cuerpo: tipos no soportados y falta de texto', async () => {
    const app = await buildApp();
    const unsupported = await app.inject({
      method: 'POST',
      url: '/api/capture',
      headers: { authorization: 'Bearer tok_valido_123456' },
      payload: { type: 'image', imageDataUrl: 'data:image/png;base64,AAAA' },
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json().code).toBe('capture_unsupported_type');

    const empty = await app.inject({
      method: 'POST',
      url: '/api/capture',
      headers: { authorization: 'Bearer tok_valido_123456' },
      payload: { type: 'note', text: '   ' },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().code).toBe('capture_missing_text');

    const noUrl = await app.inject({
      method: 'POST',
      url: '/api/capture',
      headers: { authorization: 'Bearer tok_valido_123456' },
      payload: { type: 'link' },
    });
    expect(noUrl.statusCode).toBe(400);
    expect(noUrl.json().code).toBe('capture_missing_url');
    await app.close();
  });

  it('respeta el tablero indicado si hay permiso de edición', async () => {
    db.boards.set('board_proyecto', {
      id: 'board_proyecto',
      ownerId: 'user_ana',
      parentBoardId: 'root',
      title: 'Proyecto',
      icon: null,
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      trashedAt: null,
      favoriteAt: null,
      isUnsorted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/capture',
      headers: { authorization: 'Bearer tok_valido_123456' },
      payload: { type: 'note', text: 'Nota en Proyecto', boardId: 'board_proyecto' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().boardTitle).toBe('Proyecto');
    expect(db.documents.has('board_proyecto')).toBe(true);
    await app.close();
  });
});

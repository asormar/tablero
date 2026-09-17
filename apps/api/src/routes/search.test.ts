/**
 * Rutas de búsqueda: agrupado por tablero con fragmento resaltado, posición del
 * elemento y reindexado completo desde el documento persistido.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { addElement, createBoardDoc, ensureTextFragment, writeTextParagraphs } from '@tablero/shared';
import * as Y from 'yjs';
import { ZodError } from 'zod';
import { formatZodError } from '@tablero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../lib/errors.js';

const db = vi.hoisted(() => {
  const documents = new Map<string, Buffer>();
  let rawRows: { boardId: string; elementId: string; elementType: string; text: string; rank: number | null; headline: string | null }[] = [];
  const indexed: { boardId: string; elementId: string }[] = [];

  const board = (id: string, title: string, parentBoardId: string | null, isTemplate = false) => ({
    id,
    ownerId: 'user_ana',
    parentBoardId,
    title,
    icon: null,
    color: null,
    coverImageId: null,
    isTemplate,
    publishedSlug: null,
    trashedAt: null,
    favoriteAt: null,
    isUnsorted: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });

  const boards = [board('board_uno', 'Proyectos', null), board('board_dos', 'Notas', 'board_uno')];

  const prisma = {
    board: {
      findMany: async ({ where }: { where?: { id?: { in: string[] }; title?: { contains: string } } } = {}) => {
        let rows = boards;
        if (where?.id) rows = rows.filter((row) => where.id!.in.includes(row.id));
        if (where?.title) rows = rows.filter((row) => row.title.toLowerCase().includes(where.title!.contains.toLowerCase()));
        return rows.map((row) => ({ ...row }));
      },
    },
    boardMember: { findMany: async () => [] },
    boardDocument: {
      findMany: async ({ where }: { where: { boardId: { in: string[] } } }) =>
        where.boardId.in
          .filter((boardId) => documents.has(boardId))
          .map((boardId) => ({ boardId, yjsState: documents.get(boardId)! })),
      findUnique: async ({ where }: { where: { boardId: string } }) => {
        const bytes = documents.get(where.boardId);
        return bytes ? { boardId: where.boardId, yjsState: bytes, updatedAt: new Date() } : null;
      },
    },
    searchIndex: {
      deleteMany: async () => ({ count: 0 }),
      upsert: async ({ where }: { where: { boardId_elementId: { boardId: string; elementId: string } } }) => {
        indexed.push(where.boardId_elementId);
        return {};
      },
    },
    $queryRaw: async () => rawRows,
    $transaction: async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma)),
  };

  return {
    prisma,
    documents,
    indexed,
    setRows: (rows: typeof rawRows) => {
      rawRows = rows;
    },
    reset: () => {
      documents.clear();
      indexed.length = 0;
      rawRows = [];
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    currentUser: () => ({ id: 'user_ana', email: 'ana@tablero.test', name: 'Ana', avatarUrl: null, settings: {}, createdAt: new Date() }),
  };
});

const { searchRoutes } = await import('./search.js');

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
  await app.register(searchRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

function docWithNote(text: string, x = 100, y = 200): { id: string; state: Buffer } {
  const doc = createBoardDoc();
  const id = addElement(doc, 'note', { createdBy: 'ana', x, y, width: 300 }, 'test');
  const fragment = ensureTextFragment(doc, id, 'test');
  if (fragment) writeTextParagraphs(fragment, text, 'test');
  return { id, state: Buffer.from(Y.encodeStateAsUpdate(doc)) };
}

beforeEach(() => {
  db.reset();
});

describe('GET /api/search', () => {
  it('devuelve resultados agrupados con headline y posición', async () => {
    const note = docWithNote('Reunión de diseño el jueves', 320, 480);
    db.documents.set('board_uno', note.state);
    db.setRows([
      {
        boardId: 'board_uno',
        elementId: note.id,
        elementType: 'note',
        text: 'Reunión de diseño el jueves',
        rank: 0.5,
        headline: '\u0001Reunión\u0002 de diseño el jueves',
      },
    ]);

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/search?q=reunion' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ query: 'reunion', limit: 30, total: 1 });
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({ boardId: 'board_uno', boardTitle: 'Proyectos' });
    const hit = body.groups[0].hits[0];
    expect(hit).toMatchObject({ elementId: note.id, kind: 'element', boardId: 'board_uno' });
    expect(hit.headline).toContain('<mark>');
    expect(hit.position).toMatchObject({ x: 320, y: 480, width: 300 });
    await app.close();
  });

  it('valida la consulta (q obligatorio)', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/search?q=' });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('404 si el boardId pedido no es accesible', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/search?q=algo&boardId=board_ajeno' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /api/search/reindex', () => {
  it('reindexa todos los tableros accesibles desde el estado persistido', async () => {
    db.documents.set('board_uno', docWithNote('primera nota').state);
    db.documents.set('board_dos', docWithNote('segunda nota').state);

    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/search/reindex', payload: {} });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, boards: 2, elements: 2, skipped: 0 });
    expect(db.indexed.map((entry) => entry.boardId).sort()).toEqual(['board_dos', 'board_uno']);
    await app.close();
  });

  it('un tablero sin documento se informa como omitido', async () => {
    db.documents.set('board_uno', docWithNote('primera nota').state);

    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/search/reindex', payload: {} });
    expect(response.json()).toMatchObject({ boards: 2, elements: 1, skipped: 1 });
    await app.close();
  });

  it('un reindexado parcial exige acceso al tablero', async () => {
    db.documents.set('board_uno', docWithNote('primera nota').state);
    const app = await buildApp();
    const ok = await app.inject({ method: 'POST', url: '/api/search/reindex', payload: { boardId: 'board_uno' } });
    expect(ok.json()).toMatchObject({ boards: 1, elements: 1 });

    const foreign = await app.inject({ method: 'POST', url: '/api/search/reindex', payload: { boardId: 'board_ajeno' } });
    expect(foreign.statusCode).toBe(404);
    await app.close();
  });
});

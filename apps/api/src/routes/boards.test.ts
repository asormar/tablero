/**
 * Rutas de tableros: invariantes del árbol (una sola raíz por cuenta) y
 * validación de la actualización.
 *
 * La base se dobla con un Prisma en memoria (`vi.mock('../db.js')`): son tests
 * de la capa de rutas, no de Postgres. La sesión se dobla con un usuario fijo.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { formatZodError } from '@tablero/shared';

import { HttpError } from '../lib/errors.js';

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
  createdAt: Date;
  updatedAt: Date;
};

const db = vi.hoisted(() => {
  type Row = BoardRow;

  const boards = new Map<string, Row>();
  const documents = new Map<string, Buffer>();
  let counter = 0;

  const seed = (overrides: Partial<Row> & { title: string }): Row => {
    const now = new Date();
    const id = overrides.id ?? `board_${++counter}`;
    const row: Row = {
      id,
      ownerId: 'user_ana',
      parentBoardId: null,
      icon: null,
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    boards.set(id, row);
    return row;
  };

  const reset = (): void => {
    boards.clear();
    documents.clear();
    counter = 0;
  };

  const prisma = {
    board: {
      findMany: async () => [...boards.values()].map((row) => ({ ...row })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = boards.get(where.id);
        return row ? { ...row } : null;
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = boards.get(where.id);
        if (!row) throw new Error(`tablero ${where.id} inexistente`);
        return { ...row };
      },
      create: async ({ data }: { data: Partial<Row> & { ownerId: string; title: string } }) => {
        const now = new Date();
        const row: Row = {
          id: data.id ?? `board_${++counter}`,
          ownerId: data.ownerId,
          parentBoardId: data.parentBoardId ?? null,
          title: data.title,
          icon: data.icon ?? null,
          color: data.color ?? null,
          coverImageId: data.coverImageId ?? null,
          isTemplate: data.isTemplate ?? false,
          publishedSlug: data.publishedSlug ?? null,
          trashedAt: data.trashedAt ?? null,
          createdAt: now,
          updatedAt: now,
        };
        boards.set(row.id, row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = boards.get(where.id);
        if (!row) throw new Error(`tablero ${where.id} inexistente`);
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: { id: { in: string[] }; trashedAt: null }; data: Partial<Row> }) => {
        let count = 0;
        for (const id of where.id.in) {
          const row = boards.get(id);
          if (!row || row.trashedAt !== null) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    },
    share: { findMany: async () => [] },
    boardDocument: {
      create: async ({ data }: { data: { boardId: string; yjsState: Buffer } }) => {
        documents.set(data.boardId, data.yjsState);
        return { boardId: data.boardId, yjsState: data.yjsState, updatedAt: new Date() };
      },
      findUnique: async ({ where }: { where: { boardId: string } }) => {
        const bytes = documents.get(where.boardId);
        return bytes ? { boardId: where.boardId, yjsState: bytes, updatedAt: new Date() } : null;
      },
      upsert: async ({ where, create, update }: { where: { boardId: string }; create: { boardId: string; yjsState: Buffer }; update: { yjsState: Buffer } }) => {
        const bytes = documents.get(where.boardId) ?? create.yjsState;
        documents.set(where.boardId, update.yjsState ?? bytes);
        return { boardId: where.boardId, yjsState: documents.get(where.boardId)!, updatedAt: new Date() };
      },
    },
    template: { findUnique: async () => null },
    asset: { findUnique: async () => null },
    $transaction: async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: typeof prisma) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
  };

  return { boards, documents, prisma, seed, reset };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

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

const { boardsRoutes } = await import('./boards.js');

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
  await app.register(boardsRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

beforeEach(() => {
  db.reset();
  db.seed({ id: 'root', title: 'Inicio', icon: '🏠' });
  db.seed({ id: 'proyecto', title: 'Proyecto', parentBoardId: 'root' });
  db.seed({ id: 'referencias', title: 'Referencias', parentBoardId: 'proyecto' });
  db.seed({ id: 'personal', title: 'Personal', parentBoardId: 'root' });
});

describe('POST /boards/:id/move', () => {
  it('rechaza mover un tablero a parentBoardId null (no se crean raíces)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/move',
      payload: { parentBoardId: null },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'cannot_create_second_root' });
    // El tablero sigue colgando de la raíz: no quedó una segunda raíz inborrable.
    expect(db.boards.get('proyecto')?.parentBoardId).toBe('root');
    const list = await app.inject({ method: 'GET', url: '/api/boards?filter=recent' });
    const roots = (list.json().boards as { parentBoardId: string | null }[]).filter(
      (board) => board.parentBoardId === null,
    );
    expect(roots).toHaveLength(1);
    await app.close();
  });

  it('rechaza mover un tablero dentro de un descendiente', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/move',
      payload: { parentBoardId: 'referencias' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'cannot_move_into_descendant' });
    expect(db.boards.get('proyecto')?.parentBoardId).toBe('root');
    await app.close();
  });

  it('rechaza mover un tablero dentro de sí mismo', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/move',
      payload: { parentBoardId: 'proyecto' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'cannot_move_into_descendant' });
    await app.close();
  });

  it('sigue moviendo a otro tablero existente', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/move',
      payload: { parentBoardId: 'personal' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().board.parentBoardId).toBe('personal');
    expect(db.boards.get('proyecto')?.parentBoardId).toBe('personal');
    await app.close();
  });

  it('rechaza mover a un destino que está en la papelera', async () => {
    db.seed({ id: 'papelera', title: 'En papelera', parentBoardId: 'root', trashedAt: new Date() });
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/move',
      payload: { parentBoardId: 'papelera' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'target_trashed' });
    await app.close();
  });
});

describe('POST /boards/:id/duplicate', () => {
  it('anida la copia de la raíz dentro de la raíz y no crea otra raíz', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/root/duplicate',
      payload: { includeChildren: false },
    });

    expect(response.statusCode).toBe(201);
    const copy = response.json().board as { id: string; parentBoardId: string | null; title: string };
    expect(copy.parentBoardId).toBe('root');
    expect(copy.title).toBe('Inicio (copia)');
    expect(db.boards.get(copy.id)?.parentBoardId).toBe('root');

    const list = await app.inject({ method: 'GET', url: '/api/boards?filter=recent' });
    const roots = (list.json().boards as { id: string; parentBoardId: string | null }[]).filter(
      (board) => board.parentBoardId === null,
    );
    expect(roots.map((board) => board.id)).toEqual(['root']);
    await app.close();
  });

  it('mantiene el padre al duplicar un tablero común (incluidos sus hijos)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/duplicate',
      payload: { includeChildren: true },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      board: { id: string; parentBoardId: string | null };
      children: { id: string; parentBoardId: string | null }[];
    };
    expect(body.board.parentBoardId).toBe('root');
    expect(body.children).toHaveLength(1);
    expect(body.children[0]?.parentBoardId).toBe(body.board.id);
    expect(db.boards.get(body.children[0]!.id)?.parentBoardId).toBe(body.board.id);
    await app.close();
  });
});

describe('PATCH /boards/:id', () => {
  it('rechaza `settings` con 400 y un mensaje claro (no lo ignora en silencio)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/boards/proyecto',
      payload: { settings: { theme: 'dark' } },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { code: string; details: { path: string; message: string }[] };
    expect(body.code).toBe('validation_error');
    expect(JSON.stringify(body.details)).toContain('settings');
    await app.close();
  });

  it('sigue renombrando con PATCH normal', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/boards/proyecto',
      payload: { title: 'Proyecto renombrado', icon: '🎯' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().board.title).toBe('Proyecto renombrado');
    expect(db.boards.get('proyecto')?.title).toBe('Proyecto renombrado');
    await app.close();
  });
});

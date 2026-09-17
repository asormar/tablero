/**
 * Actividad y presencia (fase 5).
 *
 * La actividad la reporta el cliente por lotes y el servidor descarta lo que no
 * exista; la presencia es la ventana de 60 s de quien está mirando el tablero
 * (la alimentan el socket y estas rutas).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { addElement, createBoardDoc, cursorColor, formatZodError } from '@tablero/shared';
import * as Y from 'yjs';

import { HttpError } from '../lib/errors.js';
import { resetPresence, touchPresence } from '../lib/presence.js';

const db = vi.hoisted(() => {
  const boards = new Map<string, Record<string, unknown>>();
  const documents = new Map<string, Buffer>();
  const members = new Map<string, { boardId: string; userId: string; role: string }>();
  const activities: Record<string, unknown>[] = [];
  let counter = 0;

  const board = (id: string, overrides: Record<string, unknown> = {}) => {
    const now = new Date();
    const row = {
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
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    boards.set(id, row);
    return row;
  };

  const withUser = (data: Record<string, unknown>) => ({ id: `act_${++counter}`, createdAt: new Date(), ...data, user: { name: 'Ana' } });

  const prisma = {
    board: {
      findMany: async () => [...boards.values()],
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = boards.get(where.id);
        return row ? { ...row } : null;
      },
    },
    boardMember: {
      findMany: async ({ where }: { where: { userId?: string; boardId?: string } }) => {
        let rows = [...members.values()];
        if (where.boardId) rows = rows.filter((row) => row.boardId === where.boardId);
        if (where.userId) rows = rows.filter((row) => row.userId === where.userId);
        return rows;
      },
    },
    boardDocument: {
      findUnique: async ({ where }: { where: { boardId: string } }) => {
        const bytes = documents.get(where.boardId);
        return bytes ? { boardId: where.boardId, yjsState: bytes, updatedAt: new Date() } : null;
      },
      upsert: async ({ where }: { where: { boardId: string } }) => ({ boardId: where.boardId, updatedAt: new Date() }),
    },
    activity: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = withUser(data);
        activities.push(row);
        return row;
      },
      findMany: async ({
        where,
        take,
      }: {
        where: {
          boardId: string;
          elementId?: string;
          OR?: { createdAt?: { lt?: Date } | Date; id?: { lt: string } }[];
        };
        take?: number;
      }) => {
        let rows = activities
          .filter((row) => row.boardId === where.boardId)
          .filter((row) => (where.elementId ? row.elementId === where.elementId : true));
        // Paginación por cursor: las dos condiciones del `OR` del API.
        const byTime = where.OR?.find((condition) => condition.createdAt && typeof condition.createdAt === 'object' && (condition.createdAt as { lt?: Date }).lt)?.createdAt as { lt: Date } | undefined;
        const byId = where.OR?.find((condition) => condition.id && typeof condition.id === 'object' && condition.id.lt);
        if (byTime || byId) {
          rows = rows.filter((row) => {
            const at = (row.createdAt as Date).getTime();
            if (byTime && at < byTime.lt.getTime()) return true;
            if (byId) {
              const eq = typeof byId.createdAt === 'object' ? (byId.createdAt as { lt?: Date }).lt?.getTime() : undefined;
              if (eq !== undefined && at === eq && String(row.id) < byId.id!.lt) return true;
            }
            return false;
          });
        }
        return rows
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
          .slice(0, take ?? 50)
          .map((row) => ({ ...row, user: { name: 'Ana' } }));
      },
    },
    $transaction: async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[]),
  };

  return {
    boards,
    documents,
    members,
    activities,
    prisma,
    board,
    session: { id: 'user_ana' },
    reset: () => {
      boards.clear();
      documents.clear();
      members.clear();
      activities.length = 0;
      counter = 0;
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    currentUser: () => ({ id: db.session.id, email: 'ana@tablero.test', name: 'Ana', avatarUrl: null, settings: {}, createdAt: new Date() }),
  };
});

const { activityRoutes } = await import('./activity.js');

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
  await app.register(activityRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

beforeEach(() => {
  db.reset();
  resetPresence();
  db.board('inicio', { title: 'Inicio' });
  db.board('proyecto', { title: 'Proyecto', parentBoardId: 'inicio' });
  db.board('ajeno', { title: 'Ajeno', ownerId: 'user_caro' });
  db.session.id = 'user_ana';
});

describe('POST /api/boards/:id/activity', () => {
  it('acepta el lote (`entries`), guarda el actor de la sesión y descarta elementos inexistentes', async () => {
    const doc = createBoardDoc();
    const cardId = addElement(doc, 'note', { createdBy: 'user_ana', x: 0, y: 0 }, 'test');
    db.documents.set('proyecto', Buffer.from(Y.encodeStateAsUpdate(doc)));

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/activity',
      payload: {
        entries: [
          { action: 'element.create', elementId: cardId, elementType: 'note', meta: { title: 'Nueva nota' } },
          { action: 'element.edit', elementId: 'no-existe' },
          { action: 'board.publish', meta: { slug: 'abc' } },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { accepted: number; discarded: number; entries: { action: string; userName: string; userId: string }[] };
    expect(body.accepted).toBe(2);
    expect(body.discarded).toBe(1);
    expect(body.entries.map((entry) => entry.action)).toEqual(['element.create', 'board.publish']);
    // El actor sale de la sesión, no del cuerpo.
    expect(body.entries[0]).toMatchObject({ userId: 'user_ana', userName: 'Ana' });
    await app.close();
  });

  it('rechaza un lote vacío o con acciones desconocidas', async () => {
    const app = await buildApp();
    const empty = await app.inject({ method: 'POST', url: '/api/boards/proyecto/activity', payload: { entries: [] } });
    expect(empty.statusCode).toBe(400);
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/activity',
      payload: { entries: [{ action: 'hackeado' }] },
    });
    expect(unknown.statusCode).toBe(400);
    // La forma vieja (`events`) ya no se acepta.
    const legacy = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/activity',
      payload: { events: [{ action: 'element.edit' }] },
    });
    expect(legacy.statusCode).toBe(400);
    await app.close();
  });

  it('un ajeno no puede reportar actividad (404)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/ajeno/activity',
      payload: { entries: [{ action: 'element.edit' }] },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /api/boards/:id/activity', () => {
  it('lista lo más nuevo primero con `{ entries, nextCursor }` y avanza por cursor', async () => {
    const app = await buildApp();
    const base = Date.now();
    for (const [index, action] of ['element.create', 'element.edit', 'element.move'].entries()) {
      db.activities.push({
        id: `a_${index}`,
        boardId: 'proyecto',
        userId: 'user_ana',
        action,
        elementId: null,
        elementType: null,
        meta: {},
        createdAt: new Date(base + index * 1_000),
      });
    }
    const response = await app.inject({ method: 'GET', url: '/api/boards/proyecto/activity?limit=2' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { entries: { action: string }[]; nextCursor: string | null };
    expect(body.entries).toHaveLength(2);
    expect(body.entries.map((entry) => entry.action)).toEqual(['element.move', 'element.edit']);
    expect(typeof body.nextCursor).toBe('string');

    const second = await app.inject({
      method: 'GET',
      url: `/api/boards/proyecto/activity?limit=2&cursor=${encodeURIComponent(body.nextCursor!)}`,
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { entries: { action: string }[]; nextCursor: string | null };
    expect(secondBody.entries.map((entry) => entry.action)).toEqual(['element.create']);
    // Página incompleta: no hay más.
    expect(secondBody.nextCursor).toBeNull();
    await app.close();
  });
});

describe('GET /api/boards/:id/presence', () => {
  it('devuelve quién mira en la ventana de 60 s con el color derivado del id (`users` y `watchers`)', async () => {
    touchPresence('proyecto', { userId: 'user_ana', name: 'Ana', avatarUrl: null, role: 'owner' }, { socket: true });
    touchPresence('proyecto', { userId: 'user_beto', name: 'Beto', avatarUrl: null, role: 'viewer' }, { now: Date.now() - 10_000 });
    // Viejo: fuera de la ventana.
    touchPresence('proyecto', { userId: 'user_viejo', name: 'Viejo', avatarUrl: null, role: 'viewer' }, { now: Date.now() - 61_000 });

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/boards/proyecto/presence' });
    expect(response.statusCode).toBe(200);
    const users = response.json().users as { userId: string; name: string; color: string; connected: boolean; role: string }[];
    const watchers = response.json().watchers as { userId: string }[];
    expect(users.map((user) => user.userId).sort()).toEqual(['user_ana', 'user_beto']);
    expect(watchers.map((user) => user.userId)).toEqual(users.map((user) => user.userId));
    expect(users.find((user) => user.userId === 'user_ana')!.color).toBe(cursorColor('user_ana'));
    expect(users.find((user) => user.userId === 'user_ana')!.connected).toBe(true);
    expect(users.find((user) => user.userId === 'user_beto')!.connected).toBe(false);
    await app.close();
  });
});

/**
 * Notificaciones (fase 5): listado, contador, marcar como leídas y el barrido
 * de tareas vencidas (una notificación por tarea y día).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { addElement, createBoardDoc, formatZodError } from '@tablero/shared';
import * as Y from 'yjs';

import { HttpError } from '../lib/errors.js';

const db = vi.hoisted(() => {
  const boards = new Map<string, Record<string, unknown>>();
  const documents = new Map<string, Buffer>();
  const members = new Map<string, { boardId: string; userId: string; role: string }>();
  const notifications = new Map<string, Record<string, unknown>>();
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

  const notification = (overrides: Record<string, unknown>) => {
    const row = {
      id: `notif_${++counter}`,
      userId: 'user_ana',
      kind: 'mention',
      boardId: null,
      elementId: null,
      actorId: null,
      meta: {},
      dedupeKey: null,
      readAt: null,
      createdAt: new Date(),
      ...overrides,
    };
    notifications.set(row.id, row);
    return row;
  };

  const prisma = {
    board: {
      findMany: async () => [...boards.values()],
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = boards.get(where.id);
        return row ? { ...row, owner: { name: 'Ana' } } : null;
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
      findMany: async () => [...documents.keys()].map((boardId) => ({ boardId })),
    },
    notification: {
      findUnique: async ({ where }: { where: { dedupeKey: string } }) =>
        [...notifications.values()].find((row) => row.dedupeKey === where.dedupeKey) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => notification(data),
      findMany: async ({ where, take }: { where: { userId: string; readAt?: null }; take?: number }) =>
        [...notifications.values()]
          .filter((row) => row.userId === where.userId)
          .filter((row) => (where.readAt === null ? row.readAt === null : true))
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
          .slice(0, take ?? 50)
          .map((row) => ({
            ...row,
            actor: row.actorId ? { name: 'Ana' } : null,
            board: row.boardId ? { title: 'Proyecto', publishedSlug: null } : null,
          })),
      count: async ({ where }: { where: { userId: string; readAt?: null } }) =>
        [...notifications.values()]
          .filter((row) => row.userId === where.userId)
          .filter((row) => (where.readAt === null ? row.readAt === null : true)).length,
      updateMany: async ({ where, data }: { where: { userId: string; readAt: null; id?: { in: string[] } }; data: { readAt: Date } }) => {
        let count = 0;
        for (const row of notifications.values()) {
          if (row.userId !== where.userId || row.readAt !== null) continue;
          if (where.id && !where.id.in.includes(row.id as string)) continue;
          row.readAt = data.readAt;
          count += 1;
        }
        return { count };
      },
    },
    activity: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'act', ...data }), findMany: async () => [] },
    $transaction: async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[]),
  };

  return {
    boards,
    documents,
    members,
    notifications,
    prisma,
    board,
    notification,
    session: { id: 'user_ana' },
    reset: () => {
      boards.clear();
      documents.clear();
      members.clear();
      notifications.clear();
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

const { notificationsRoutes, resetPanelSweepThrottle } = await import('./notifications.js');

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
  await app.register(notificationsRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

/** Documento con una tarea vencida (ayer) y otra para hoy. */
function seedOverdueDocument(boardId: string): void {
  const doc = createBoardDoc();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  addElement(
    doc,
    'todo',
    {
      createdBy: 'user_ana',
      x: 0,
      y: 0,
      title: 'Tareas',
      items: [{ id: 'item-1', text: 'Entregar informe', checked: false, children: [], dueDate: yesterday, priority: 'high' }],
    },
    'test',
  );
  db.documents.set(boardId, Buffer.from(Y.encodeStateAsUpdate(doc)));
}

beforeEach(() => {
  db.reset();
  resetPanelSweepThrottle();
  db.board('inicio', { title: 'Inicio' });
  db.board('proyecto', { title: 'Proyecto', parentBoardId: 'inicio' });
  db.members.set('proyecto:user_beto', { boardId: 'proyecto', userId: 'user_beto', role: 'editor' });
  db.session.id = 'user_ana';
});

describe('GET /api/notifications', () => {
  it('lista con tablero y actor, y el contador de no leídas cuadra', async () => {
    db.notification({ kind: 'mention', boardId: 'proyecto', actorId: 'user_beto', meta: { body: 'te mencioné' } });
    db.notification({ kind: 'comment', boardId: 'proyecto' });
    db.notification({ kind: 'task-overdue', boardId: 'proyecto', readAt: new Date() });

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      notifications: { kind: string; boardTitle: string | null; actorName: string | null; readAt: number | null }[];
      count: { unread: number; total: number };
      unread: number;
      total: number;
    };
    expect(body.notifications).toHaveLength(3);
    expect(body.count).toEqual({ unread: 2, total: 3 });
    // `unread` de nivel superior: es lo que lee la campana de la web.
    expect(body.unread).toBe(2);
    expect(body.total).toBe(3);
    expect(body.notifications[0]!.boardTitle).toBe('Proyecto');

    const unread = await app.inject({ method: 'GET', url: '/api/notifications?filter=unread' });
    expect((unread.json().notifications as unknown[]).length).toBe(2);
    expect(unread.json().unread).toBe(2);
    await app.close();
  });

  it('GET /notifications/count devuelve el contador con `unread` en el nivel superior', async () => {
    db.notification({ kind: 'mention' });
    db.notification({ kind: 'reply', readAt: new Date() });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/notifications/count' });
    expect(response.statusCode).toBe(200);
    expect(response.json().unread).toBe(1);
    expect(response.json().total).toBe(2);
    expect(response.json().count).toEqual({ unread: 1, total: 2 });
    await app.close();
  });
});

describe('POST /api/notifications/read', () => {
  it('marca por ids, con `{ all: true }` y con `{}` (todas, como manda la web)', async () => {
    const first = db.notification({ kind: 'mention' });
    db.notification({ kind: 'reply' });
    db.notification({ kind: 'comment' });

    const app = await buildApp();
    const byIds = await app.inject({ method: 'POST', url: '/api/notifications/read', payload: { ids: [first.id] } });
    expect(byIds.statusCode).toBe(200);
    expect(byIds.json()).toMatchObject({ marked: 1 });
    expect(byIds.json().unread).toBe(2);

    const all = await app.inject({ method: 'POST', url: '/api/notifications/read', payload: { all: true } });
    expect(all.json()).toMatchObject({ marked: 2 });
    expect(all.json().unread).toBe(0);

    // `{}` = todas: es el cuerpo que manda `markNotificationsRead(null)`.
    const again = db.notification({ kind: 'mention' });
    expect(again.id).toBeTruthy();
    const empty = await app.inject({ method: 'POST', url: '/api/notifications/read', payload: {} });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().unread).toBe(0);
    await app.close();
  });
});

describe('barrido de tareas vencidas', () => {
  it('crea una notificación por tarea y día, sin duplicar al repetir el barrido', async () => {
    seedOverdueDocument('proyecto');
    const app = await buildApp();

    const first = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(first.statusCode).toBe(200);
    const rows = db.notifications.values ? [...db.notifications.values()] : [];
    const overdue = rows.filter((row) => row.kind === 'task-overdue');
    // Avisa al dueño y a la miembro del tablero (no hay asignado).
    expect(overdue.map((row) => row.userId).sort()).toEqual(['user_ana', 'user_beto']);
    const today = new Date().toISOString().slice(0, 10);
    expect(String(overdue[0]!.dedupeKey)).toMatch(/^task-overdue:proyecto:.+:item-1:\d{4}-\d{2}-\d{2}:user_(ana|beto)$/);
    expect(String(overdue[0]!.dedupeKey)).toContain(`:${today}:`);
    // `meta.dueDate` es el vencimiento real de la tarea (ayer), no el día del
    // barrido: el aviso tiene que decir cuándo venció.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const meta = overdue[0]!.meta as { dueDate: string };
    expect(meta.dueDate).toBe(yesterday);
    expect(meta.dueDate).not.toBe(today);

    // Segundo barrido (se reinicia el throttle del panel): no duplica.
    resetPanelSweepThrottle();
    await app.inject({ method: 'GET', url: '/api/notifications' });
    expect([...db.notifications.values()].filter((row) => row.kind === 'task-overdue')).toHaveLength(2);
    await app.close();
  });
});

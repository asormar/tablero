/**
 * GET /api/tasks: aplanado, filtros y orden de la vista global de tareas.
 *
 * Prisma se dobla (`vi.mock('../db.js')`) y los documentos Yjs se mockean en
 * `lib/documents.js`: se construyen documentos **reales** con `createBoardDoc` +
 * `addElement`, así el test recorre el mismo camino que producción (Yjs real,
 * dominio real de `@tablero/shared`) sin tocar Postgres ni la red.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { addDays, addElement, createBoardDoc, formatZodError, todayIso, type TodoItem } from '@tablero/shared';
import type * as Y from 'yjs';

import { HttpError } from '../lib/errors.js';
import { tasksResponseSchema } from '../lib/tasks.js';

const db = vi.hoisted(() => {
  const boards: {
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
  }[] = [];

  const seed = (overrides: Partial<(typeof boards)[number]> & { id: string; title: string }): void => {
    const now = new Date();
    boards.push({
      ownerId: 'user_ana',
      parentBoardId: null,
      icon: null,
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      trashedAt: null,
      favoriteAt: null,
      isUnsorted: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  };

  const prisma = {
    board: { findMany: async () => boards.map((row) => ({ ...row })) },
    boardMember: { findMany: async () => [] },
  };

  return { boards, seed, reset: () => (boards.length = 0), prisma };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

const documents = vi.hoisted(() => ({ docs: new Map<string, Y.Doc>(), broken: new Set<string>() }));

vi.mock('../lib/documents.js', () => ({
  loadBoardDoc: async (boardId: string) => {
    // Los bytes de ese tablero no se pueden aplicar (documento corrupto).
    if (documents.broken.has(boardId)) throw new Error('documento ilegible');
    return documents.docs.get(boardId) ?? null;
  },
}));

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

const { tasksRoutes } = await import('./tasks.js');

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
  await app.register(tasksRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

function item(id: string, text: string, extra: Partial<TodoItem> = {}): TodoItem {
  return { id, text, checked: false, children: [], dueDate: null, priority: 'none', ...extra };
}

/** Documento con un elemento `todo` (lista de tareas) por cada entrada. */
function makeDoc(boardId: string, lists: { id: string; title: string; items: TodoItem[] }[]): void {
  const doc = createBoardDoc();
  for (const list of lists) {
    addElement(doc, 'todo', { id: list.id, createdBy: 'test', x: 0, y: 0, title: list.title, items: list.items }, 'test');
  }
  documents.docs.set(boardId, doc);
}

const TODAY = todayIso();

beforeEach(() => {
  db.reset();
  documents.docs.clear();
  documents.broken.clear();
  db.seed({ id: 'root', title: 'Inicio' });
  db.seed({ id: 'board_a', title: 'Proyecto A', parentBoardId: 'root' });
  db.seed({ id: 'board_b', title: 'Proyecto B', parentBoardId: 'root' });
  db.seed({ id: 'ajeno', title: 'De otro usuario', ownerId: 'user_beto' });
});

describe('GET /api/tasks', () => {
  it('aplana las listas con boardId, listId, itemId, depth y order', async () => {
    makeDoc('board_a', [
      {
        id: 'list_a',
        title: 'Pendientes',
        items: [
          item('t1', 'Primera', { dueDate: addDays(TODAY, 3) }),
          item('t2', 'Con subtarea', {
            children: [item('t2a', 'Subtarea', { dueDate: TODAY })],
          }),
        ],
      },
    ]);

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/tasks' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { filter: string; tasks: Record<string, unknown>[] };
    expect(body.filter).toBe('all');
    // La respuesta cumple el contrato declarado.
    expect(() => tasksResponseSchema.parse(body)).not.toThrow();

    const subtask = body.tasks.find((task) => task.itemId === 't2a');
    expect(subtask).toMatchObject({
      boardId: 'board_a',
      boardTitle: 'Proyecto A',
      elementId: 'list_a',
      elementTitle: 'Pendientes',
      listId: 'list_a',
      parentId: 't2',
      text: 'Subtarea',
      checked: false,
      depth: 1,
      bucket: 'today',
    });
    expect(typeof subtask?.order).toBe('number');
    const first = body.tasks.find((task) => task.itemId === 't1');
    expect(first).toMatchObject({ depth: 0, parentId: null, bucket: 'upcoming' });
    await app.close();
  });

  it('filter=all deja afuera las completadas; done devuelve solo esas', async () => {
    makeDoc('board_a', [
      {
        id: 'list_a',
        title: 'Pendientes',
        items: [
          item('abierta', 'Abierta'),
          item('hecha', 'Hecha', { checked: true, dueDate: addDays(TODAY, -1), completedAt: Date.now() }),
        ],
      },
    ]);

    const app = await buildApp();
    const all = await app.inject({ method: 'GET', url: '/api/tasks?filter=all' });
    expect((all.json().tasks as { itemId: string }[]).map((task) => task.itemId)).toEqual(['abierta']);

    const done = await app.inject({ method: 'GET', url: '/api/tasks?filter=done' });
    const doneTasks = done.json().tasks as { itemId: string; bucket: string }[];
    expect(doneTasks.map((task) => task.itemId)).toEqual(['hecha']);
    expect(doneTasks[0]?.bucket).toBe('done');
    await app.close();
  });

  it('reparte los cubos overdue, today, upcoming y done como la web', async () => {
    makeDoc('board_a', [
      {
        id: 'list_a',
        title: 'Fechas',
        items: [
          item('vencida', 'Vencida', { dueDate: addDays(TODAY, -3) }),
          item('hoy', 'Para hoy', { dueDate: TODAY }),
          item('manana', 'Para mañana', { dueDate: addDays(TODAY, 1) }),
          item('semana', 'La semana que viene', { dueDate: addDays(TODAY, 6) }),
          item('sin-fecha', 'Sin fecha'),
          item('hecha', 'Hecha', { checked: true }),
        ],
      },
    ]);

    const app = await buildApp();
    const ids = async (filter: string) => {
      const response = await app.inject({ method: 'GET', url: `/api/tasks?filter=${filter}` });
      expect(response.statusCode).toBe(200);
      return (response.json().tasks as { itemId: string }[]).map((task) => task.itemId);
    };

    expect(await ids('overdue')).toEqual(['vencida']);
    expect(await ids('today')).toEqual(['vencida', 'hoy']);
    expect(await ids('upcoming')).toEqual(['vencida', 'hoy', 'manana', 'semana']);
    expect(await ids('all')).toEqual(['vencida', 'hoy', 'manana', 'semana', 'sin-fecha']);
    expect(await ids('done')).toEqual(['hecha']);

    const buckets = (await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks as {
      itemId: string;
      bucket: string;
    }[];
    expect(Object.fromEntries(buckets.map((task) => [task.itemId, task.bucket]))).toEqual({
      vencida: 'overdue',
      hoy: 'today',
      manana: 'tomorrow',
      semana: 'upcoming',
      'sin-fecha': 'someday',
    });
    await app.close();
  });

  it('ordena con sortTasks: vencidas primero y después por fecha', async () => {
    makeDoc('board_a', [
      {
        id: 'list_a',
        title: 'Fechas',
        items: [
          item('sin-fecha', 'Sin fecha'),
          item('semana', 'La semana que viene', { dueDate: addDays(TODAY, 6) }),
          item('vencida', 'Vencida', { dueDate: addDays(TODAY, -3) }),
          item('hoy', 'Para hoy', { dueDate: TODAY }),
        ],
      },
    ]);

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/tasks' });
    const tasks = response.json().tasks as { itemId: string; dueDate: string | null }[];
    expect(tasks.map((task) => task.itemId)).toEqual(['vencida', 'hoy', 'semana', 'sin-fecha']);
    await app.close();
  });

  it('acota a un tablero con boardId y 404 si no es accesible', async () => {
    makeDoc('board_a', [{ id: 'list_a', title: 'A', items: [item('t-a', 'De A')] }]);
    makeDoc('board_b', [{ id: 'list_b', title: 'B', items: [item('t-b', 'De B')] }]);

    const app = await buildApp();
    const scoped = await app.inject({ method: 'GET', url: '/api/tasks?boardId=board_b' });
    expect(scoped.statusCode).toBe(200);
    const tasks = scoped.json().tasks as { boardId: string; itemId: string }[];
    expect(tasks.map((task) => task.itemId)).toEqual(['t-b']);
    expect(tasks.every((task) => task.boardId === 'board_b')).toBe(true);

    const ajeno = await app.inject({ method: 'GET', url: '/api/tasks?boardId=ajeno' });
    expect(ajeno.statusCode).toBe(404);
    await app.close();
  });

  it('respeta limit y valida el filtro', async () => {
    makeDoc('board_a', [
      { id: 'list_a', title: 'A', items: [item('t1', 'Uno'), item('t2', 'Dos'), item('t3', 'Tres')] },
    ]);

    const app = await buildApp();
    const limited = await app.inject({ method: 'GET', url: '/api/tasks?limit=2' });
    expect(limited.statusCode).toBe(200);
    expect(limited.json().tasks).toHaveLength(2);

    const invalid = await app.inject({ method: 'GET', url: '/api/tasks?filter=urgente' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('validation_error');
    await app.close();
  });

  it('ignora listas sin texto, tableros sin documento y documentos ilegibles', async () => {
    makeDoc('board_a', [
      {
        id: 'list_a',
        title: 'A',
        items: [item('vacia', '   '), item('con-texto', 'Con texto')],
      },
    ]);
    documents.broken.add('board_b');

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/tasks' });
    expect(response.statusCode).toBe(200);
    expect((response.json().tasks as { itemId: string }[]).map((task) => task.itemId)).toEqual(['con-texto']);
    await app.close();
  });
});

/**
 * Comentarios (fase 5): extracción desde el documento, forma plana del listado,
 * resolver, borrar y menciones que crean notificación.
 *
 * El documento Yjs es la fuente de verdad: los comentarios viven en
 * `doc.getMap('comments')` como `Y.Map` planos (los mismos ayudantes de
 * `@tablero/shared` y de la web). El test arma el hilo y lo deja como estado
 * persistido; las rutas lo extraen a la tabla (`Comment`) y responden con las
 * filas planas. Sin servidor de colaboración en el proceso de test, el camino
 * que se ejercita es el persistido (el mismo que usa una API sin Hocuspocus).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { addComment, addElement, createBoardDoc, formatZodError, readComments } from '@tablero/shared';
import * as Y from 'yjs';

import { HttpError } from '../lib/errors.js';

const db = vi.hoisted(() => {
  const boards = new Map<string, Record<string, unknown>>();
  const documents = new Map<string, Buffer>();
  const members = new Map<string, { boardId: string; userId: string; role: string }>();
  const comments = new Map<string, Record<string, unknown>>();
  const notifications: Record<string, unknown>[] = [];
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

  const users = new Map<string, { id: string; email: string; name: string; avatarUrl: string | null }>([
    ['user_ana', { id: 'user_ana', email: 'ana@tablero.test', name: 'Ana', avatarUrl: null }],
    ['user_beto', { id: 'user_beto', email: 'beto@tablero.test', name: 'Beto', avatarUrl: null }],
    ['user_caro', { id: 'user_caro', email: 'caro@tablero.test', name: 'Caro', avatarUrl: null }],
  ]);

  const prisma = {
    board: {
      findMany: async () => [...boards.values()],
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = boards.get(where.id);
        return row ? { ...row, owner: users.get(row.ownerId as string) ?? null } : null;
      },
    },
    boardMember: {
      findMany: async ({ where }: { where: { userId?: string; boardId?: string } }) => {
        let rows = [...members.values()];
        if (where.boardId) rows = rows.filter((row) => row.boardId === where.boardId);
        if (where.userId) rows = rows.filter((row) => row.userId === where.userId);
        return rows.map((row) => ({ ...row, user: users.get(row.userId) ?? null }));
      },
    },
    boardDocument: {
      findUnique: async ({ where }: { where: { boardId: string } }) => {
        const bytes = documents.get(where.boardId);
        return bytes ? { boardId: where.boardId, yjsState: bytes, updatedAt: new Date() } : null;
      },
      upsert: async ({ where, create, update }: { where: { boardId: string }; create: { yjsState: Buffer }; update: { yjsState: Buffer } }) => {
        const bytes = documents.get(where.boardId) ?? create.yjsState;
        documents.set(where.boardId, update.yjsState ?? bytes);
        return { boardId: where.boardId, yjsState: documents.get(where.boardId)!, updatedAt: new Date() };
      },
    },
    comment: {
      deleteMany: async ({ where }: { where: { boardId: string; id?: { notIn: string[] } } }) => {
        let count = 0;
        for (const [id, row] of comments) {
          if (row.boardId !== where.boardId) continue;
          if (where.id?.notIn && where.id.notIn.includes(id)) continue;
          comments.delete(id);
          count += 1;
        }
        return { count };
      },
      upsert: async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = comments.get(where.id);
        const row = existing ? { ...existing, ...update } : { ...create, id: where.id };
        comments.set(where.id, row);
        return row;
      },
      findMany: async ({ where }: { where: { boardId: string; elementId?: string; resolvedAt?: null | { not: null } } }) => {
        return [...comments.values()]
          .filter((row) => row.boardId === where.boardId)
          .filter((row) => (where.elementId ? row.elementId === where.elementId : true))
          .filter((row) => (where.resolvedAt === null ? row.resolvedAt === null : true))
          .filter((row) => (where.resolvedAt && typeof where.resolvedAt === 'object' ? row.resolvedAt !== null : true))
          .map((row) => ({ ...row, author: users.get(row.authorId as string) ?? { name: '?' } }));
      },
      findUnique: async ({ where }: { where: { id: string } }) => comments.get(where.id) ?? null,
      count: async ({ where }: { where: { boardId: string; resolvedAt?: null } }) =>
        [...comments.values()].filter((row) => row.boardId === where.boardId && (where.resolvedAt === null ? row.resolvedAt === null : true)).length,
    },
    notification: {
      findUnique: async ({ where }: { where: { dedupeKey: string } }) =>
        notifications.find((row) => row.dedupeKey === where.dedupeKey) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `notif_${++counter}`, ...data };
        notifications.push(row);
        return row;
      },
      findMany: async () => [],
      count: async () => 0,
      updateMany: async () => ({ count: 0 }),
    },
    activity: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'act', ...data }), findMany: async () => [] },
    $transaction: async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: typeof prisma) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
  };

  return {
    boards,
    documents,
    members,
    comments,
    notifications,
    prisma,
    board,
    users,
    session: { id: 'user_ana' },
    reset: () => {
      boards.clear();
      documents.clear();
      members.clear();
      comments.clear();
      notifications.length = 0;
      counter = 0;
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    currentUser: () => {
      const user = db.users.get(db.session.id)!;
      return { ...user, settings: {}, createdAt: new Date() };
    },
  };
});

const { commentsRoutes } = await import('./comments.js');

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
  await app.register(commentsRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

/** Documento persistido con una nota y un comentario raíz anclado a ella. */
function seedDocument(boardId: string): { cardId: string; rootId: string } {
  const doc = createBoardDoc();
  const cardId = addElement(doc, 'note', { createdBy: 'user_ana', x: 10, y: 10 }, 'test');
  const rootId = addComment(
    doc,
    {
      elementId: cardId,
      x: null,
      y: null,
      authorId: 'user_ana',
      authorName: 'Ana',
      body: '¿Lo revisás, @beto?',
      mentions: ['user_beto'],
    },
    'test',
  );
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  db.documents.set(boardId, state);
  return { cardId, rootId };
}

beforeEach(() => {
  db.reset();
  db.board('inicio', { title: 'Inicio' });
  db.board('proyecto', { title: 'Proyecto', parentBoardId: 'inicio' });
  db.members.set('proyecto:user_beto', { boardId: 'proyecto', userId: 'user_beto', role: 'editor' });
  db.members.set('proyecto:user_caro', { boardId: 'proyecto', userId: 'user_caro', role: 'viewer' });
});

describe('GET /api/boards/:id/comments', () => {
  it('extrae el comentario del documento con la forma plana y crea la mención', async () => {
    const { cardId, rootId } = seedDocument('proyecto');
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/boards/proyecto/comments' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      comments: {
        id: string;
        parentCommentId: string | null;
        body: string;
        elementId: string | null;
        authorId: string;
        authorName: string;
        createdAt: number;
        x: number | null;
        y: number | null;
        resolvedAt: number | null;
        resolvedBy: string | null;
        mentions: string[];
      }[];
      open: number;
      synced: { upserted: number };
    };
    expect(body.comments).toHaveLength(1);
    // Forma plana: la web mapea `parentCommentId` a su `parentId`.
    expect(body.comments[0]).toMatchObject({
      id: rootId,
      parentCommentId: null,
      elementId: cardId,
      authorId: 'user_ana',
      authorName: 'Ana',
      body: '¿Lo revisás, @beto?',
      x: null,
      y: null,
      resolvedAt: null,
      resolvedBy: null,
      mentions: ['user_beto'],
    });
    expect(body.comments[0]!.createdAt).toBeTypeOf('number');
    expect(body.open).toBe(1);
    expect(body.synced.upserted).toBe(1);

    // La mención resolvió (por id) contra los miembros y quedó registrada.
    const mentions = db.notifications.filter((row) => row.kind === 'mention');
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({ userId: 'user_beto', boardId: 'proyecto', actorId: 'user_ana' });

    // Sincronizar otra vez no duplica la mención (clave por comentario y usuario).
    const again = await app.inject({ method: 'GET', url: '/api/boards/proyecto/comments' });
    expect(again.statusCode).toBe(200);
    expect(db.notifications.filter((row) => row.kind === 'mention')).toHaveLength(1);
    await app.close();
  });

  it('devuelve las respuestas como filas planas y filtra por abiertos/resueltos', async () => {
    const doc = createBoardDoc();
    const cardId = addElement(doc, 'note', { createdBy: 'user_ana', x: 0, y: 0 }, 'test');
    const rootId = addComment(
      doc,
      { elementId: cardId, authorId: 'user_ana', authorName: 'Ana', body: 'Duda' },
      'test',
    );
    const replyId = addComment(
      doc,
      { parentId: rootId, elementId: cardId, authorId: 'user_beto', authorName: 'Beto', body: 'Lo miro' },
      'test',
    );
    db.documents.set('proyecto', Buffer.from(Y.encodeStateAsUpdate(doc)));

    const app = await buildApp();
    const all = await app.inject({ method: 'GET', url: '/api/boards/proyecto/comments' });
    const rows = all.json().comments as { id: string; parentCommentId: string | null; body: string }[];
    expect(rows).toHaveLength(2);
    const reply = rows.find((row) => row.id === replyId)!;
    expect(reply).toMatchObject({ parentCommentId: rootId, body: 'Lo miro' });

    // La respuesta generó el aviso de respuesta para el autor del hilo.
    expect(db.notifications.filter((row) => row.kind === 'reply')).toHaveLength(1);

    const resolved = await app.inject({ method: 'PATCH', url: `/api/comments/${rootId}/resolve`, payload: { resolved: true } });
    expect(resolved.statusCode).toBe(200);
    const rootRow = resolved.json().comment as { resolvedAt: number | null; resolvedBy: string | null };
    expect(rootRow.resolvedAt).toBeTypeOf('number');
    expect(rootRow.resolvedBy).toBe('user_ana');

    // El hilo resuelto sale entero del filtro de abiertos (la respuesta también).
    const open = await app.inject({ method: 'GET', url: '/api/boards/proyecto/comments?filter=open' });
    expect(open.json().comments).toHaveLength(0);
    const onlyResolved = await app.inject({ method: 'GET', url: '/api/boards/proyecto/comments?filter=resolved' });
    expect(onlyResolved.json().comments).toHaveLength(2);
    await app.close();
  });

  it('un ajeno no ve los comentarios (404, sin filtrar la existencia)', async () => {
    seedDocument('proyecto');
    const app = await buildApp();
    // Caro es lector; el tablero ajeno de otra cuenta no existe para ella.
    db.members.delete('proyecto:user_caro');
    const response = await app.inject({ method: 'GET', url: '/api/boards/ajeno/comments' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('DELETE /api/comments/:id', () => {
  it('el autor borra su hilo y desaparece del documento y de la tabla', async () => {
    const { rootId } = seedDocument('proyecto');
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/api/boards/proyecto/comments' });
    expect(db.comments.has(rootId)).toBe(true);

    const response = await app.inject({ method: 'DELETE', url: `/api/comments/${rootId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, changed: true });
    expect(db.comments.has(rootId)).toBe(false);

    // Y el documento persistido ya no tiene el comentario.
    const probe = createBoardDoc();
    Y.applyUpdate(probe, new Uint8Array(db.documents.get('proyecto')!));
    expect(readComments(probe)).toHaveLength(0);
    await app.close();
  });

  it('un lector no puede borrar el comentario de otro', async () => {
    const { rootId } = seedDocument('proyecto');
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/api/boards/proyecto/comments' });

    // Caro es lectora: no es autora ni dueña del tablero.
    db.session.id = 'user_caro';
    const response = await app.inject({ method: 'DELETE', url: `/api/comments/${rootId}` });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('forbidden_comment');
    await app.close();
  });
});

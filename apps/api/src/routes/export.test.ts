/**
 * Exportación (rutas): la exportación de un tablero exige rol **editor** (o
 * dueño). El JSON y el ZIP llevan el `document.state` completo: un lector con
 * acceso responde 403 `forbidden_role`.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { addElement, createBoardDoc, ensureTextFragment, formatZodError, writeTextParagraphs } from '@tablero/shared';
import * as Y from 'yjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../lib/errors.js';

const db = vi.hoisted(() => {
  const boards = new Map<string, Record<string, unknown>>();
  const members = new Map<string, { boardId: string; userId: string; role: string }>();
  const documents = new Map<string, Buffer>();

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

  const prisma = {
    board: {
      findMany: async () => [...boards.values()].map((row) => ({ ...row })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = boards.get(where.id);
        return row ? { ...row } : null;
      },
    },
    boardMember: {
      findMany: async ({ where }: { where: { userId?: string } }) => {
        const rows = [...members.values()];
        return where?.userId ? rows.filter((row) => row.userId === where.userId) : rows;
      },
    },
    boardDocument: {
      findUnique: async ({ where }: { where: { boardId: string } }) => {
        const bytes = documents.get(where.boardId);
        return bytes ? { boardId: where.boardId, yjsState: bytes, updatedAt: new Date() } : null;
      },
    },
    asset: { findMany: async () => [] },
  };

  return {
    prisma,
    boards,
    members,
    documents,
    board,
    session: { id: 'user_ana' },
    reset: () => {
      boards.clear();
      members.clear();
      documents.clear();
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

vi.mock('../lib/storage.js', () => ({
  getObjectStream: async () => null,
  deleteObject: async () => undefined,
  headObject: async () => null,
  ensureBucket: async () => true,
}));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    currentUser: () => ({ id: db.session.id, email: 'quien@tablero.test', name: 'Quien', avatarUrl: null, settings: {}, createdAt: new Date() }),
  };
});

const { exportRoutes } = await import('./export.js');

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
  await app.register(exportRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

/** Tablero con una nota con texto (el contenido que exportan los formatos). */
function seedDocument(boardId: string): void {
  const doc = createBoardDoc();
  const note = addElement(doc, 'note', { createdBy: 'user_ana', x: 0, y: 0, width: 300 }, 'test');
  const fragment = ensureTextFragment(doc, note, 'test');
  if (fragment) writeTextParagraphs(fragment, 'Contenido exportable', 'test');
  db.documents.set(boardId, Buffer.from(Y.encodeStateAsUpdate(doc)));
}

beforeEach(() => {
  db.reset();
  db.session.id = 'user_ana';
  db.board('board_uno', { title: 'Proyecto' });
  seedDocument('board_uno');
});

describe('POST /api/boards/:id/export', () => {
  it('el dueño exporta en Markdown y en JSON (con el estado Yjs)', async () => {
    const app = await buildApp();

    const markdown = await app.inject({ method: 'POST', url: '/api/boards/board_uno/export?format=markdown' });
    expect(markdown.statusCode).toBe(200);
    expect(markdown.headers['content-type']).toContain('text/markdown');
    expect(markdown.body).toContain('Contenido exportable');

    const json = await app.inject({ method: 'POST', url: '/api/boards/board_uno/export?format=json' });
    expect(json.statusCode).toBe(200);
    expect(json.json()).toMatchObject({ format: 'tablero.board' });
    expect(typeof json.json().document.state).toBe('string');
    await app.close();
  });

  it('un lector con acceso NO puede exportar el estado completo: 403 `forbidden_role`', async () => {
    db.session.id = 'user_caro';
    db.members.set('m1', { boardId: 'board_uno', userId: 'user_caro', role: 'viewer' });

    const app = await buildApp();
    const json = await app.inject({ method: 'POST', url: '/api/boards/board_uno/export?format=json' });
    expect(json.statusCode).toBe(403);
    expect(json.json().code).toBe('forbidden_role');
    expect(json.body).not.toContain('document');

    // Tampoco los formatos de texto (la ruta entera pide edición).
    const markdown = await app.inject({ method: 'POST', url: '/api/boards/board_uno/export?format=markdown' });
    expect(markdown.statusCode).toBe(403);
    await app.close();
  });

  it('un editor sí exporta (puede editar el documento que se lleva)', async () => {
    db.session.id = 'user_beto';
    db.members.set('m2', { boardId: 'board_uno', userId: 'user_beto', role: 'editor' });

    const app = await buildApp();
    const json = await app.inject({ method: 'POST', url: '/api/boards/board_uno/export?format=json' });
    expect(json.statusCode).toBe(200);
    expect(json.json().document.state.length).toBeGreaterThan(0);
    await app.close();
  });

  it('un ajeno sigue viendo 404 (no se filtra la existencia)', async () => {
    db.session.id = 'user_caro';

    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/boards/board_uno/export?format=json' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

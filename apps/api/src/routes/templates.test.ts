/**
 * Plantillas (rutas): catálogo, instanciar (con remapeo de tarjetas de tablero)
 * y «guardar tablero como plantilla».
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { addElement, createBoardDoc, ensureTextFragment, getOrderedElements, writeTextParagraphs } from '@tablero/shared';
import * as Y from 'yjs';
import { ZodError } from 'zod';
import { formatZodError } from '@tablero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  favoriteAt: Date | null;
  isUnsorted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const db = vi.hoisted(() => {
  const boards = new Map<string, BoardRow>();
  const documents = new Map<string, Buffer>();
  const templates = new Map<string, { id: string; ownerId: string | null; boardId: string; category: string; name: string; description: string | null; createdAt: Date }>();
  let counter = 0;

  const now = () => new Date();

  const boardRow = (data: Partial<BoardRow> & { ownerId: string; title: string }): BoardRow => ({
    id: data.id ?? `board_${++counter}`,
    ownerId: data.ownerId,
    parentBoardId: data.parentBoardId ?? null,
    title: data.title,
    icon: data.icon ?? null,
    color: data.color ?? null,
    coverImageId: null,
    isTemplate: data.isTemplate ?? false,
    publishedSlug: null,
    trashedAt: null,
    favoriteAt: null,
    isUnsorted: false,
    createdAt: now(),
    updatedAt: now(),
  });

  const prisma = {
    board: {
      findMany: async ({ where }: { where?: { parentBoardId?: { in: string[] } } } = {}) => {
        let rows = [...boards.values()];
        if (where?.parentBoardId) rows = rows.filter((row) => where.parentBoardId!.in.includes(row.parentBoardId ?? ''));
        return rows.map((row) => ({ ...row }));
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = boards.get(where.id);
        return row ? { ...row } : null;
      },
      create: async ({ data }: { data: Partial<BoardRow> & { ownerId: string; title: string } }) => {
        const row = boardRow(data);
        boards.set(row.id, row);
        return { ...row };
      },
    },
    share: { findMany: async () => [] },
    boardDocument: {
      findMany: async ({ where }: { where: { boardId: { in: string[] } } }) =>
        where.boardId.in
          .filter((boardId) => documents.has(boardId))
          .map((boardId) => ({ boardId, yjsState: documents.get(boardId)! })),
      findUnique: async ({ where }: { where: { boardId: string } }) => {
        const bytes = documents.get(where.boardId);
        return bytes ? { boardId: where.boardId, yjsState: bytes } : null;
      },
      create: async ({ data }: { data: { boardId: string; yjsState: Buffer } }) => {
        documents.set(data.boardId, data.yjsState);
        return { boardId: data.boardId, yjsState: data.yjsState };
      },
    },
    template: {
      findMany: async ({ where }: { where?: { OR?: { ownerId: string | null }[] } } = {}) =>
        [...templates.values()]
          .filter((row) => !where?.OR || where.OR.some((condition) => condition.ownerId === row.ownerId))
          .map((row) => ({ ...row })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = templates.get(where.id);
        return row ? { ...row } : null;
      },
      create: async ({ data }: { data: { ownerId: string | null; boardId: string; category: string; name: string; description?: string | null } }) => {
        const row = {
          id: `tpl_${++counter}`,
          ownerId: data.ownerId,
          boardId: data.boardId,
          category: data.category,
          name: data.name,
          description: data.description ?? null,
          createdAt: now(),
        };
        templates.set(row.id, row);
        return { ...row };
      },
    },
    $transaction: async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
  };

  return {
    prisma,
    boards,
    documents,
    templates,
    reset: () => {
      boards.clear();
      documents.clear();
      templates.clear();
      counter = 0;
    },
    seedBoard: (row: BoardRow) => boards.set(row.id, row),
    boardRow,
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

const { templatesRoutes } = await import('./templates.js');

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
  await app.register(templatesRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

/** Documento con una nota con texto y una tarjeta que apunta a otro tablero. */
function templateDoc(childBoardId: string, text: string): Buffer {
  const doc = createBoardDoc();
  const noteId = addElement(doc, 'note', { createdBy: 'system', x: 0, y: 0, width: 300 }, 'template');
  const fragment = ensureTextFragment(doc, noteId, 'template');
  if (fragment) writeTextParagraphs(fragment, text, 'template');
  addElement(doc, 'board', { createdBy: 'system', x: 0, y: 200, width: 280, boardId: childBoardId, showPreview: true }, 'template');
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

function decode(bytes: Buffer): Y.Doc {
  const doc = createBoardDoc();
  Y.applyUpdate(doc, new Uint8Array(bytes));
  return doc;
}

beforeEach(() => {
  db.reset();
  // Raíz del usuario.
  db.seedBoard(db.boardRow({ id: 'root', ownerId: 'user_ana', title: 'Inicio', icon: '🏠' }));
  // Plantilla del sistema con un subtablero.
  db.seedBoard(db.boardRow({ id: 'tpl_root', ownerId: 'user_sistema', title: 'Planificador de proyecto (kanban)', icon: '📋', isTemplate: true }));
  db.seedBoard(db.boardRow({ id: 'tpl_child', ownerId: 'user_sistema', parentBoardId: 'tpl_root', title: 'Reuniones', isTemplate: true }));
  db.documents.set('tpl_root', templateDoc('tpl_child', 'Por hacer: definir el alcance'));
  db.documents.set('tpl_child', templateDoc('', 'Decisiones abiertas'));
  db.templates.set('tpl_sistema', {
    id: 'tpl_sistema',
    ownerId: null,
    boardId: 'tpl_root',
    category: 'planificación',
    name: 'Planificador de proyecto (kanban)',
    description: 'Plantilla del sistema',
    createdAt: new Date('2026-09-01T00:00:00Z'),
  });
  db.templates.set('tpl_ajena', {
    id: 'tpl_ajena',
    ownerId: 'user_beto',
    boardId: 'board_ajeno',
    category: 'general',
    name: 'Ajena',
    description: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
  });
});

describe('GET /api/templates', () => {
  it('lista las del sistema y las propias con sus categorías y cantidad de tarjetas', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/templates' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0]).toMatchObject({ id: 'tpl_sistema', system: true, elementCount: 2, category: 'planificación' });
    expect(body.categories).toEqual([{ category: 'planificación', count: 1 }]);
    await app.close();
  });
});

describe('POST /api/templates/:id/instantiate', () => {
  it('copia el documento y remapea la tarjeta de tablero a la copia del subtablero', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/templates/tpl_sistema/instantiate', payload: {} });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    const newRootId = String(body.board.id);
    const children = body.children as { id: string; title: string; parentBoardId: string }[];
    expect(children).toHaveLength(1);
    expect(children[0]!.parentBoardId).toBe(newRootId);
    expect(body.template).toMatchObject({ id: 'tpl_sistema' });

    const rootDoc = decode(db.documents.get(newRootId)!);
    const elements = getOrderedElements(rootDoc);
    expect(elements).toHaveLength(2);
    const card = elements.find((element) => element.type === 'board') as { boardId?: string };
    expect(card.boardId).toBe(children[0]!.id);
    expect(card.boardId).not.toBe('tpl_child');
    // El subtablero copiado también tiene su documento.
    expect(db.documents.has(children[0]!.id)).toBe(true);
    expect(db.boards.get(children[0]!.id)?.ownerId).toBe('user_ana');
    await app.close();
  });

  it('no deja instanciar la plantilla de otra cuenta', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/templates/tpl_ajena/instantiate', payload: {} });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('usa el título pedido y acepta un tablero destino', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates/tpl_sistema/instantiate',
      payload: { title: 'Mi proyecto', parentBoardId: 'root' },
    });
    expect(response.statusCode).toBe(201);
    const newRootId = String(response.json().board.id);
    expect(db.boards.get(newRootId)?.title).toBe('Mi proyecto');
    expect(db.boards.get(newRootId)?.parentBoardId).toBe('root');
    await app.close();
  });
});

describe('POST /api/templates/from-board/:id', () => {
  it('guarda el tablero y sus subtableros como plantilla propia', async () => {
    db.seedBoard(db.boardRow({ id: 'board_mio', ownerId: 'user_ana', parentBoardId: 'root', title: 'Proyecto propio' }));
    db.seedBoard(db.boardRow({ id: 'board_hijo', ownerId: 'user_ana', parentBoardId: 'board_mio', title: 'Sprints' }));
    db.documents.set('board_mio', templateDoc('board_hijo', 'texto del proyecto'));
    db.documents.set('board_hijo', templateDoc('', 'texto del sprint'));

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates/from-board/board_mio',
      payload: { name: 'Mi plantilla', category: 'planificación' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.template).toMatchObject({ name: 'Mi plantilla', system: false, category: 'planificación' });
    expect(body.boards).toBe(2);
    const templateBoard = db.boards.get(String(body.template.boardId))!;
    expect(templateBoard.isTemplate).toBe(true);
    expect(templateBoard.ownerId).toBe('user_ana');
    // El hijo copiado también quedó marcado como plantilla y colgando de la copia.
    const copyChild = [...db.boards.values()].find((board) => board.parentBoardId === templateBoard.id)!;
    expect(copyChild.isTemplate).toBe(true);
    // Y la tarjeta de la copia apunta a la copia del hijo, no al original.
    const copyDoc = decode(db.documents.get(templateBoard.id)!);
    const card = getOrderedElements(copyDoc).find((element) => element.type === 'board') as { boardId?: string };
    expect(card.boardId).toBe(copyChild.id);
    await app.close();
  });

  it('rechaza un tablero sin acceso', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/templates/from-board/no_existe', payload: { name: 'X' } });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('valida el nombre', async () => {
    db.seedBoard(db.boardRow({ id: 'board_mio', ownerId: 'user_ana', parentBoardId: 'root', title: 'Proyecto propio' }));
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/templates/from-board/board_mio', payload: { name: '' } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

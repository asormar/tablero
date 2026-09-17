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
import { addElement, createBoardDoc, ensureTextFragment, formatZodError, writeTextParagraphs } from '@tablero/shared';
import * as Y from 'yjs';

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
  type Row = BoardRow;

  const boards = new Map<string, Row>();
  const documents = new Map<string, Buffer>();
  const searchRows = new Map<string, { boardId: string; elementId: string; elementType: string; text: string; textNorm: string }>();
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
      favoriteAt: null,
      isUnsorted: false,
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
    searchRows.clear();
    counter = 0;
  };

  const prisma = {
    board: {
      findMany: async () => [...boards.values()].map((row) => ({ ...row })),
      findFirst: async ({ where }: { where: { ownerId?: string; isUnsorted?: boolean } }) => {
        const row = [...boards.values()].find(
          (candidate) =>
            (where.ownerId === undefined || candidate.ownerId === where.ownerId) &&
            (where.isUnsorted === undefined || candidate.isUnsorted === where.isUnsorted),
        );
        return row ? { ...row } : null;
      },
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
          favoriteAt: data.favoriteAt ?? null,
          isUnsorted: data.isUnsorted ?? false,
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
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] }; trashedAt?: null | { not: null } };
        data: Partial<Row>;
      }) => {
        let count = 0;
        for (const id of where.id.in) {
          const row = boards.get(id);
          if (!row) continue;
          if (where.trashedAt === null && row.trashedAt !== null) continue;
          if (where.trashedAt !== null && where.trashedAt !== undefined && row.trashedAt === null) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        let count = 0;
        for (const id of where.id.in) {
          if (boards.delete(id)) count += 1;
        }
        return { count };
      },
    },
    boardMember: { findMany: async () => [] },
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
    searchIndex: {
      deleteMany: async ({ where }: { where: { boardId: string; elementId?: { notIn: string[] } } }) => {
        for (const [key, row] of [...searchRows]) {
          if (row.boardId !== where.boardId) continue;
          if (where.elementId?.notIn && where.elementId.notIn.includes(row.elementId)) continue;
          searchRows.delete(key);
        }
        return { count: 0 };
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { boardId_elementId: { boardId: string; elementId: string } };
        create: { boardId: string; elementId: string; elementType: string; text: string; textNorm: string };
        update: { elementType: string; text: string; textNorm: string };
      }) => {
        const { boardId, elementId } = where.boardId_elementId;
        const previous = searchRows.get(`${boardId}:${elementId}`);
        const row = { ...create, ...(previous ? update : {}) };
        searchRows.set(`${boardId}:${elementId}`, row);
        return { ...row };
      },
    },
    template: { findUnique: async () => null },
    asset: { findUnique: async () => null },
    $transaction: async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: typeof prisma) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
  };

  return { boards, documents, searchRows, prisma, seed, reset };
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

  it('indexa la copia al instante: la búsqueda encuentra el contenido nuevo sin reindex manual', async () => {
    // El origen tiene una nota con texto: la copia se lleva los mismos bytes.
    const doc = createBoardDoc();
    const noteId = addElement(doc, 'note', { createdBy: 'user_ana', x: 0, y: 0, width: 300 }, 'test');
    const fragment = ensureTextFragment(doc, noteId, 'test');
    if (fragment) writeTextParagraphs(fragment, 'Contenido de la copia', 'test');
    db.documents.set('proyecto', Buffer.from(Y.encodeStateAsUpdate(doc)));
    db.searchRows.clear();

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/duplicate',
      payload: { includeChildren: false },
    });
    expect(response.statusCode).toBe(201);
    const copy = response.json().board as { id: string };

    // Sin llamar a `POST /api/search/reindex`: la copia ya está en el índice
    // (el texto que lee `GET /api/search` vive en `SearchIndex`).
    const rows = [...db.searchRows.values()].filter((row) => row.boardId === copy.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.text.includes('Contenido de la copia'))).toBe(true);
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

  it('marca y desmarca el favorito escribiendo `favoriteAt`', async () => {
    const app = await buildApp();
    const marked = await app.inject({
      method: 'PATCH',
      url: '/api/boards/proyecto',
      payload: { favorite: true },
    });

    expect(marked.statusCode).toBe(200);
    expect(marked.json().board.favorited).toBe(true);
    expect(db.boards.get('proyecto')?.favoriteAt).toBeInstanceOf(Date);

    const cleared = await app.inject({
      method: 'PATCH',
      url: '/api/boards/proyecto',
      payload: { favorite: false },
    });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().board.favorited).toBe(false);
    expect(db.boards.get('proyecto')?.favoriteAt).toBeNull();
    await app.close();
  });

  it('rechaza un `favorite` que no sea booleano', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/boards/proyecto',
      payload: { favorite: 'sí' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('validation_error');
    await app.close();
  });
});

describe('GET /boards?filter=', () => {
  it('`all` (por defecto) deja afuera la bandeja «Sin ordenar»', async () => {
    db.seed({ id: 'bandeja', title: 'Sin ordenar', parentBoardId: 'root', isUnsorted: true });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/boards' });

    expect(response.statusCode).toBe(200);
    const ids = (response.json().boards as { id: string }[]).map((board) => board.id);
    expect(ids).toContain('proyecto');
    expect(ids).not.toContain('bandeja');
    await app.close();
  });

  it('`favorites` devuelve solo los marcados, el más reciente primero', async () => {
    db.seed({ id: 'viejo', title: 'Favorito viejo', parentBoardId: 'root', favoriteAt: new Date('2026-01-01T00:00:00Z') });
    db.seed({ id: 'nuevo', title: 'Favorito nuevo', parentBoardId: 'root', favoriteAt: new Date('2026-06-01T00:00:00Z') });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/boards?filter=favorites' });

    expect(response.statusCode).toBe(200);
    const boards = response.json().boards as { id: string; favorited: boolean }[];
    expect(boards.map((board) => board.id)).toEqual(['nuevo', 'viejo']);
    expect(boards.every((board) => board.favorited)).toBe(true);
    await app.close();
  });

  it('`recent` ordena por última modificación', async () => {
    db.seed({ id: 'antiguo', title: 'Antiguo', parentBoardId: 'root', updatedAt: new Date(Date.now() - 86_400_000) });
    db.seed({ id: 'flamante', title: 'Flamante', parentBoardId: 'root', updatedAt: new Date(Date.now() + 86_400_000) });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/boards?filter=recent' });

    expect(response.statusCode).toBe(200);
    const boards = response.json().boards as { id: string; updatedAt: number }[];
    expect(boards[0]?.id).toBe('flamante');
    const times = boards.map((board) => board.updatedAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    await app.close();
  });
});

describe('GET /boards/unsorted', () => {
  it('crea la bandeja «Sin ordenar» la primera vez y la reutiliza después', async () => {
    const app = await buildApp();
    const first = await app.inject({ method: 'GET', url: '/api/boards/unsorted' });

    expect(first.statusCode).toBe(200);
    expect(first.json().created).toBe(true);
    const board = first.json().board as { id: string; title: string; parentBoardId: string; favorited: boolean };
    expect(board.title).toBe('Sin ordenar');
    // Cuelga de la raíz: nunca una segunda raíz.
    expect(board.parentBoardId).toBe('root');
    expect(board.favorited).toBe(false);
    expect(db.documents.has(board.id)).toBe(true);

    const second = await app.inject({ method: 'GET', url: '/api/boards/unsorted' });
    expect(second.statusCode).toBe(200);
    expect(second.json().created).toBe(false);
    expect((second.json().board as { id: string }).id).toBe(board.id);
    expect([...db.boards.values()].filter((row) => row.isUnsorted)).toHaveLength(1);
    await app.close();
  });

  it('rechaza mandar la bandeja a la papelera', async () => {
    const app = await buildApp();
    const created = await app.inject({ method: 'GET', url: '/api/boards/unsorted' });
    const bandeja = (created.json().board as { id: string }).id;

    const response = await app.inject({ method: 'DELETE', url: `/api/boards/${bandeja}` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'cannot_trash_unsorted' });
    expect(db.boards.get(bandeja)?.trashedAt).toBeNull();
    await app.close();
  });

  it('devuelve la bandeja aunque estuviera en la papelera', async () => {
    db.seed({ id: 'bandeja', title: 'Sin ordenar', parentBoardId: 'root', isUnsorted: true, trashedAt: new Date() });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/boards/unsorted' });

    expect(response.statusCode).toBe(200);
    expect(response.json().created).toBe(false);
    expect((response.json().board as { id: string }).id).toBe('bandeja');
    expect(db.boards.get('bandeja')?.trashedAt).toBeNull();
    await app.close();
  });
});

describe('papelera de tableros', () => {
  it('GET /trash lista lo caído con título, icono, color y padre (lo último primero)', async () => {
    db.seed({
      id: 'vieja',
      title: 'Vieja',
      parentBoardId: 'root',
      icon: '🧪',
      color: 'blue',
      trashedAt: new Date('2026-03-01T00:00:00Z'),
    });
    db.seed({ id: 'reciente', title: 'Reciente', parentBoardId: 'root', trashedAt: new Date('2026-08-01T00:00:00Z') });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/trash' });

    expect(response.statusCode).toBe(200);
    const boards = response.json().boards as { id: string; trashedAt: number | null }[];
    expect(boards.map((board) => board.id)).toEqual(['reciente', 'vieja']);
    expect(boards.every((board) => board.trashedAt !== null)).toBe(true);
    expect(response.json().boards[1]).toMatchObject({
      title: 'Vieja',
      icon: '🧪',
      color: 'blue',
      parentBoardId: 'root',
    });

    // El listado normal y el de recientes no muestran lo que está en la papelera.
    const normal = await app.inject({ method: 'GET', url: '/api/boards' });
    expect((normal.json().boards as { id: string }[]).map((board) => board.id)).not.toContain('vieja');
    await app.close();
  });

  it('restaurar devuelve el lote completo (el tablero y lo que cayó con él)', async () => {
    const app = await buildApp();
    const trashed = await app.inject({ method: 'DELETE', url: '/api/boards/proyecto' });
    expect(trashed.statusCode).toBe(200);
    expect(db.boards.get('referencias')?.trashedAt).not.toBeNull();

    const restored = await app.inject({ method: 'POST', url: '/api/trash/proyecto/restore' });
    expect(restored.statusCode).toBe(200);
    expect((restored.json().board as { trashedAt: number | null }).trashedAt).toBeNull();
    expect(db.boards.get('proyecto')?.trashedAt).toBeNull();
    expect(db.boards.get('referencias')?.trashedAt).toBeNull();
    await app.close();
  });

  it('deja en la papelera lo que se borró por separado (otra marca de tiempo)', async () => {
    const older = new Date(Date.now() - 60_000);
    db.seed({ id: 'hijo-solo', title: 'Borrado aparte', parentBoardId: 'proyecto', trashedAt: older });
    const app = await buildApp();
    await app.inject({ method: 'DELETE', url: '/api/boards/proyecto' });

    const restored = await app.inject({ method: 'POST', url: '/api/trash/proyecto/restore' });
    expect(restored.statusCode).toBe(200);
    expect(db.boards.get('proyecto')?.trashedAt).toBeNull();
    expect(db.boards.get('hijo-solo')?.trashedAt?.getTime()).toBe(older.getTime());
    await app.close();
  });

  it('rechaza restaurar lo que no está en la papelera', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/trash/proyecto/restore' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'board_not_trashed' });
    await app.close();
  });

  it('exige restaurar el padre antes que el hijo', async () => {
    const app = await buildApp();
    await app.inject({ method: 'DELETE', url: '/api/boards/proyecto' });

    const response = await app.inject({ method: 'POST', url: '/api/trash/referencias/restore' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'parent_trashed' });
    expect(db.boards.get('referencias')?.trashedAt).not.toBeNull();

    // Y si se restaura el padre, vuelve también el hijo.
    await app.inject({ method: 'POST', url: '/api/trash/proyecto/restore' });
    expect(db.boards.get('referencias')?.trashedAt).toBeNull();
    await app.close();
  });

  it('restaurar un id inexistente responde 404', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/trash/no-existe/restore' });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('DELETE /trash/:id borra el lote definitivamente', async () => {
    const app = await buildApp();
    await app.inject({ method: 'DELETE', url: '/api/boards/proyecto' });

    const response = await app.inject({ method: 'DELETE', url: '/api/trash/proyecto' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, deleted: 2 });
    expect(db.boards.has('proyecto')).toBe(false);
    expect(db.boards.has('referencias')).toBe(false);

    const list = await app.inject({ method: 'GET', url: '/api/trash' });
    expect(list.json().boards).toHaveLength(0);
    await app.close();
  });

  it('DELETE /trash/:id rechaza lo que no está en la papelera', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/trash/proyecto' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'board_not_trashed' });
    expect(db.boards.has('proyecto')).toBe(true);
    await app.close();
  });
});

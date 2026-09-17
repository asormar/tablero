/**
 * Publicación de tableros (fase 5): slug inadvertible, contraseña con argon2,
 * subtableros, lectura sin sesión y nada de datos privados.
 *
 * Las rutas públicas se registran sin el hook de sesión (como en `index.ts`) y
 * las de gestión con la sesión doblada: la gracia de esta fase es justamente
 * que el visitante anónimo lee sin credenciales, pero sin ver la cuenta.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Readable } from 'node:stream';

import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { addComment, addElement, createBoardDoc, ensureTextFragment, formatZodError, readComments, writeTextParagraphs } from '@tablero/shared';
import * as Y from 'yjs';

import { HttpError } from '../lib/errors.js';

const db = vi.hoisted(() => {
  const boards = new Map<string, Record<string, unknown>>();
  const documents = new Map<string, { yjsState: Buffer; updatedAt: Date }>();
  const assets = new Map<string, Record<string, unknown>>();
  const members: Record<string, unknown>[] = [];
  let counter = 0;

  const board = (id: string, overrides: Record<string, unknown> = {}) => {
    const now = new Date();
    const row: Record<string, unknown> = {
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
      owner: { name: 'Ana' },
      ...overrides,
    };
    boards.set(id, row);
    return row;
  };

  const prisma = {
    board: {
      findMany: async ({ where }: { where?: { parentBoardId?: string } } = {}) =>
        [...boards.values()].filter((row) => (where?.parentBoardId ? row.parentBoardId === where.parentBoardId : true)),
      findUnique: async ({ where }: { where: { id?: string; publishedSlug?: string } }) => {
        const rows = [...boards.values()];
        if (where.publishedSlug !== undefined) return rows.find((row) => row.publishedSlug === where.publishedSlug) ?? null;
        return rows.find((row) => row.id === where.id) ?? null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = boards.get(where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    boardMember: {
      findMany: async () => members,
    },
    boardDocument: {
      findUnique: async ({ where }: { where: { boardId: string } }) => documents.get(where.boardId) ?? null,
    },
    asset: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        [...assets.values()].filter((row) => where.id.in.includes(row.id as string)),
      findUnique: async ({ where }: { where: { id: string } }) => assets.get(where.id) ?? null,
    },
    $transaction: async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[]),
  };

  return {
    boards,
    documents,
    assets,
    prisma,
    board,
    session: { id: 'user_ana' },
    reset: () => {
      boards.clear();
      documents.clear();
      assets.clear();
      members.length = 0;
      counter = 0;
    },
    nextId: () => `asset_${++counter}`,
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    currentUser: () => ({ id: db.session.id, email: 'ana@tablero.test', name: 'Ana', avatarUrl: null, settings: {}, createdAt: new Date() }),
    readSessionToken: () => null,
    resolveSession: async () => null,
  };
});

// El almacenamiento se dobla: los enlaces públicos son firmas HMAC propias y
// el objeto se sirve en streaming, así que el test no toca MinIO.
vi.mock('../lib/storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/storage.js')>();
  return {
    ...actual,
    getObjectStream: async () => ({ body: Readable.from([Buffer.from('PNGDATA')]), size: 7, contentType: 'image/png' }),
    putObject: async () => undefined,
    deleteObject: async () => undefined,
  };
});

const { publishRoutes, publicViewRoutes } = await import('./public-boards.js');

async function buildApp(withSession: boolean): Promise<FastifyInstance> {
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
  await app.register(withSession ? publishRoutes : publicViewRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

/** Documento con una nota, una imagen con asset y un hilo de comentario. */
function seedDocument(boardId: string, assetId?: string): void {
  const doc = createBoardDoc();
  const noteId = addElement(doc, 'note', { createdBy: 'user_ana', x: 10, y: 10 }, 'test');
  const fragment = ensureTextFragment(doc, noteId);
  if (fragment) writeTextParagraphs(fragment, 'Contenido público de la nota', 'test');
  if (assetId) addElement(doc, 'image', { createdBy: 'user_ana', x: 20, y: 20, assetId }, 'test');
  addComment(doc, { elementId: noteId, authorId: 'user_ana', authorName: 'Ana', body: 'nota privada @beto' }, 'test');
  db.documents.set(boardId, { yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)), updatedAt: new Date() });
}

beforeEach(() => {
  db.reset();
  db.board('inicio', { title: 'Inicio' });
  db.board('proyecto', { title: 'Proyecto', parentBoardId: 'inicio' });
  db.board('referencias', { title: 'Referencias', parentBoardId: 'proyecto' });
  db.board('otro', { title: 'Otro' });
  db.session.id = 'user_ana';
});

describe('POST /api/boards/:id/publish', () => {
  it('publica con slug inadvertible y devuelve el enlace', async () => {
    const app = await buildApp(true);
    const response = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: {} });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { slug: string; url: string; publishedAt: number; includeSubBoards: boolean; requiresPassword: boolean };
    expect(body.slug).toMatch(/^[1-9A-HJ-NP-Za-km-z]{12}$/);
    expect(body.url).toContain(`/p/${body.slug}`);
    expect(body.includeSubBoards).toBe(false);
    expect(body.requiresPassword).toBe(false);
    expect(db.boards.get('proyecto')!.publishedAt).toBeInstanceOf(Date);
    await app.close();
  });

  it('guarda la contraseña con argon2 (nunca en claro) y permite quitarla', async () => {
    const app = await buildApp(true);
    const published = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/publish',
      payload: { password: 'un-secreto-largo', includeSubBoards: true },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ requiresPassword: true, includeSubBoards: true });

    const hash = db.boards.get('proyecto')!.publishedPasswordHash as string;
    expect(hash.startsWith('$argon2')).toBe(true);
    expect(hash).not.toContain('un-secreto-largo');

    const cleared = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: { password: null } });
    expect(cleared.json().requiresPassword).toBe(false);
    expect(db.boards.get('proyecto')!.publishedPasswordHash).toBeNull();
    await app.close();
  });

  it('rota el slug cuando se pide (el enlace anterior deja de existir)', async () => {
    const app = await buildApp(true);
    const first = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: {} });
    const rotated = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: { rotateSlug: true } });
    expect(rotated.json().slug).not.toBe(first.json().slug);

    const stale = await app.inject({ method: 'GET', url: `/api/public/boards/${first.json().slug}` });
    expect(stale.statusCode).toBe(404);
    await app.close();
  });

  it('solo el dueño publica; un editor recibe 404 (sin filtrar la existencia)', async () => {
    const app = await buildApp(true);
    db.boards.get('proyecto')!.ownerId = 'user_otro';
    db.prisma.boardMember.findMany = async () => [{ boardId: 'proyecto', userId: 'user_ana', role: 'editor' }];
    const response = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: {} });
    // Un no-dueño (miembro o ajeno) recibe la misma respuesta que un tablero
    // inexistente: el endpoint no revela la relación del llamador con el tablero.
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('DELETE despublica y GET informa el estado', async () => {
    const app = await buildApp(true);
    await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: { includeSubBoards: true } });
    const status = await app.inject({ method: 'GET', url: '/api/boards/proyecto/publish' });
    expect(status.json()).toMatchObject({ published: true, includeSubBoards: true });

    const removed = await app.inject({ method: 'DELETE', url: '/api/boards/proyecto/publish' });
    expect(removed.statusCode).toBe(200);
    expect(db.boards.get('proyecto')!.publishedSlug).toBeNull();
    const after = await app.inject({ method: 'GET', url: '/api/boards/proyecto/publish' });
    expect(after.json().published).toBe(false);
    await app.close();
  });
});

describe('GET /api/public/boards/:slug (sin sesión)', () => {
  it('devuelve el resumen sin datos privados y con noindex', async () => {
    const app = await buildApp(true);
    const published = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: { includeSubBoards: true } });
    const slug = published.json().slug as string;
    await app.close();

    const publicApp = await buildApp(false);
    const response = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-robots-tag']).toContain('noindex');

    const body = response.json().board as Record<string, unknown>;
    expect(body).toMatchObject({ slug, title: 'Proyecto', authorName: 'Ana', includeSubBoards: true, requiresPassword: false });
    // Cada subtablero publicado lleva su slug compuesto (`padre~hijo`) y viaja
    // también en el nivel superior (`boards` / `children`, que es donde la web los lee).
    expect(body.subBoards).toEqual([{ id: 'referencias', slug: `${slug}~referencias`, title: 'Referencias', icon: null, color: null }]);
    expect(response.json().boards).toEqual(body.subBoards);
    expect(response.json().children).toEqual(body.subBoards);
    expect(response.json().requiresPassword).toBe(false);

    const raw = response.body;
    expect(raw).not.toContain('@tablero.test');
    expect(raw).not.toContain('user_ana');
    expect(raw).not.toContain('user_beto');
    expect(raw).not.toContain('ownerId');
    await publicApp.close();
  });

  it('un subtablero se resuelve por su slug compuesto y sin sesión', async () => {
    seedDocument('proyecto');
    seedDocument('referencias');
    const app = await buildApp(true);
    const published = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: { includeSubBoards: true } });
    const slug = published.json().slug as string;
    await app.close();

    const publicApp = await buildApp(false);
    const child = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}~referencias` });
    expect(child.statusCode).toBe(200);
    expect(child.json().board).toMatchObject({ boardId: 'referencias', title: 'Referencias' });

    // El documento del hijo también sale con su slug compuesto.
    const document = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}~referencias/document` });
    expect(document.statusCode).toBe(200);
    expect(document.json().boardId).toBe('referencias');
    expect(typeof document.json().state).toBe('string');

    // Un id que no cuelga de la publicación no se sirve.
    const foreign = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}~ajeno` });
    expect(foreign.statusCode).toBe(404);
    await publicApp.close();
  });

  it('sin el ajuste, los subtableros no se listan', async () => {
    const app = await buildApp(true);
    const published = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: {} });
    const slug = published.json().slug as string;
    await app.close();

    const publicApp = await buildApp(false);
    const response = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}` });
    expect((response.json().board as { subBoards: unknown[] }).subBoards).toHaveLength(0);
    await publicApp.close();
  });

  it('pide la contraseña, la valida y responde 404 si la publicación no existe', async () => {
    const app = await buildApp(true);
    const published = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/publish',
      payload: { password: 'clave-de-prueba' },
    });
    const slug = published.json().slug as string;
    await app.close();

    const publicApp = await buildApp(false);
    const missing = await publicApp.inject({ method: 'GET', url: '/api/public/boards/zzzzzzzzzzzz' });
    expect(missing.statusCode).toBe(404);

    const withoutPassword = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}` });
    expect(withoutPassword.statusCode).toBe(401);
    expect(withoutPassword.json().code).toBe('public_password_required');

    const wrong = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}?password=otra-cosa` });
    expect(wrong.statusCode).toBe(401);

    const right = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}?password=clave-de-prueba` });
    expect(right.statusCode).toBe(200);
    await publicApp.close();
  });

  it('un tablero en la papelera no está publicado', async () => {
    const app = await buildApp(true);
    const published = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: {} });
    const slug = published.json().slug as string;
    db.boards.get('proyecto')!.trashedAt = new Date();
    await app.close();

    const publicApp = await buildApp(false);
    expect((await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}` })).statusCode).toBe(404);
    await publicApp.close();
  });
});

describe('GET /api/public/boards/:slug/document', () => {
  it('sirve el documento saneado con assets firmados', async () => {
    const assetId = db.nextId();
    db.assets.set(assetId, {
      id: assetId,
      ownerId: 'user_ana',
      type: 'image',
      mime: 'image/png',
      size: 10,
      storageKey: `assets/user_ana/${assetId}.png`,
      thumbnailKey: null,
      width: 100,
      height: 50,
      duration: null,
      originalName: 'foto.png',
    });
    seedDocument('proyecto', assetId);

    const app = await buildApp(true);
    const published = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: {} });
    const slug = published.json().slug as string;
    await app.close();

    const publicApp = await buildApp(false);
    const response = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}/document` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-robots-tag']).toContain('noindex');

    const document = response.json().document as {
      boardId: string;
      title: string;
      state: string;
      assets: Record<string, { url: string; mime: string; originalName: string }>;
      breadcrumbs: { id: string; title: string }[];
    };
    expect(document.boardId).toBe('proyecto');
    expect(document.breadcrumbs).toEqual([{ id: 'proyecto', title: 'Proyecto' }]);
    expect(Object.keys(document.assets)).toEqual([assetId]);
    expect(document.assets[assetId]!.url).toContain(`/api/public/boards/${slug}/assets/${assetId}?token=`);
    expect(document.assets[assetId]!.mime).toBe('image/png');

    // La clave del objeto lleva el id del dueño: no puede salir en el payload.
    expect(response.body).not.toContain('assets/user_ana');
    expect(response.body).not.toContain('X-Amz-Signature');

    // El asset firmado se sirve por el API (sin exponer el almacenamiento).
    const served = await publicApp.inject({ method: 'GET', url: document.assets[assetId]!.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.body).toBe('PNGDATA');

    const tampered = await publicApp.inject({ method: 'GET', url: document.assets[assetId]!.url.replace(/token=[^&]+/, 'token=9999999999999.aaa') });
    expect(tampered.statusCode).toBe(403);
    expect(tampered.json().code).toBe('public_asset_forbidden');

    // El estado que sale NO es el documento real: sin hilos de comentario y sin
    // ids de autor (la conversación y la autoría son privadas).
    const probe = createBoardDoc();
    Y.applyUpdate(probe, new Uint8Array(Buffer.from(document.state, 'base64')));
    expect(readComments(probe)).toHaveLength(0);
    expect(response.body).not.toContain('nota privada');
    expect(response.body).not.toContain('user_ana');
    for (const element of [...probe.getMap('elements').values()]) {
      expect((element as Y.Map<unknown>).get('createdBy')).toBeUndefined();
    }
    // El contenido de la nota sí viaja (el estado es binario Yjs: se comprueba
    // sobre los bytes decodificados).
    expect(Buffer.from(document.state, 'base64').toString('utf8')).toContain('Contenido público de la nota');
    await publicApp.close();
  });

  it('los subtableros se leen solo si el ajuste lo permite y son descendientes', async () => {
    seedDocument('proyecto');
    seedDocument('referencias');

    const app = await buildApp(true);
    const published = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: { includeSubBoards: true } });
    const slug = published.json().slug as string;
    await app.close();

    const publicApp = await buildApp(false);
    const child = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}/document?boardId=referencias` });
    expect(child.statusCode).toBe(200);
    const document = child.json().document as { boardId: string; breadcrumbs: { title: string }[] };
    expect(document.boardId).toBe('referencias');
    expect(document.breadcrumbs.map((crumb) => crumb.title)).toEqual(['Proyecto', 'Referencias']);

    // Un tablero que no es descendiente no se sirve nunca.
    const stranger = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}/document?boardId=otro` });
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json().code).toBe('public_board_not_found');
    await publicApp.close();
  });

  it('sin el ajuste, el subtablero tampoco se sirve', async () => {
    seedDocument('proyecto');
    seedDocument('referencias');
    const app = await buildApp(true);
    const published = await app.inject({ method: 'POST', url: '/api/boards/proyecto/publish', payload: {} });
    const slug = published.json().slug as string;
    await app.close();

    const publicApp = await buildApp(false);
    const response = await publicApp.inject({ method: 'GET', url: `/api/public/boards/${slug}/document?boardId=referencias` });
    expect(response.statusCode).toBe(404);
    await publicApp.close();
  });
});

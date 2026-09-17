/**
 * Servidor de colaboración: guardas del handshake.
 *
 * - El upgrade con cookie de sesión solo se acepta desde un Origin permitido
 *   (el guardia CSRF del REST no ve `/collab`).
 * - `onAuthenticate` rechaza los tableros en la papelera, igual que
 *   `GET /api/boards/:id/document` (409 `board_trashed`).
 *
 * La base se dobla con un Prisma en memoria y la sesión con un token fijo: el
 * servidor es el real (Hocuspocus sobre un http.Server) y los clientes también
 * (WebSocket crudo para el upgrade, `@hocuspocus/provider` para la auth).
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { addComment, addElement, readComments } from '@tablero/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';

const db = vi.hoisted(() => {
  type Row = {
    id: string;
    ownerId: string;
    parentBoardId: string | null;
    title: string;
    icon: string | null;
    color: string | null;
    coverImageId: string | null;
    isTemplate: boolean;
    publishedSlug: string | null;
    publishedPasswordHash: string | null;
    publishedAt: Date | null;
    publicIncludeSubBoards: boolean;
    trashedAt: Date | null;
    favoriteAt: Date | null;
    isUnsorted: boolean;
    createdAt: Date;
    updatedAt: Date;
  };

  const boards = new Map<string, Row>();
  const documents = new Map<string, { boardId: string; yjsState: Buffer; updatedAt: Date }>();
  const members = new Map<string, { boardId: string; userId: string; role: 'viewer' | 'commenter' | 'editor' }>();
  const sessions = new Map<string, { id: string; email: string; name: string }>();

  const addBoard = (id: string, options: { trashedAt?: Date | null; ownerId?: string } = {}): Row => {
    const now = new Date();
    const row: Row = {
      id,
      ownerId: options.ownerId ?? 'user_ana',
      parentBoardId: 'root',
      title: id,
      icon: null,
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      publishedPasswordHash: null,
      publishedAt: null,
      publicIncludeSubBoards: false,
      trashedAt: options.trashedAt ?? null,
      createdAt: now,
      updatedAt: now,
      favoriteAt: null,
      isUnsorted: false,
    };
    boards.set(id, row);
    return row;
  };

  const addMember = (boardId: string, userId: string, role: 'viewer' | 'commenter' | 'editor'): void => {
    members.set(`${boardId}:${userId}`, { boardId, userId, role });
  };

  const addSession = (token: string, user: { id: string; email: string; name: string }): void => {
    sessions.set(token, user);
  };

  const prisma = {
    board: { findMany: async () => [...boards.values()] },
    boardMember: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        [...members.values()]
          .filter((member) => member.userId === where.userId)
          .map((member) => ({ boardId: member.boardId, role: member.role })),
    },
    boardDocument: {
      create: async ({ data }: { data: { boardId: string; yjsState: Buffer } }) => {
        const row = { boardId: data.boardId, yjsState: data.yjsState, updatedAt: new Date() };
        documents.set(row.boardId, row);
        return row;
      },
      findUnique: async ({ where }: { where: { boardId: string } }) => documents.get(where.boardId) ?? null,
      upsert: async ({
        where,
        update,
      }: {
        where: { boardId: string };
        create: { boardId: string; yjsState: Buffer };
        update: { yjsState: Buffer };
      }) => {
        const existing = documents.get(where.boardId);
        const row = {
          boardId: where.boardId,
          yjsState: update.yjsState,
          updatedAt: new Date(),
          ...(existing ? {} : {}),
        };
        documents.set(where.boardId, row);
        return row;
      },
    },
    searchIndex: { deleteMany: async () => ({ count: 0 }), upsert: async () => ({}) },
    // La sincronización de comentarios valida los autores contra `User`.
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })),
    },
    $transaction: async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
  };

  return {
    boards,
    documents,
    members,
    sessions,
    prisma,
    addBoard,
    addMember,
    addSession,
    reset: () => {
      boards.clear();
      documents.clear();
      members.clear();
      sessions.clear();
    },
  };
});

const SESSION_TOKEN = 'token-de-prueba-de-colaboracion-aaaaaaaa';
const VIEWER_TOKEN = 'token-de-prueba-de-lector-bbbbbbbbbbbb';
const EDITOR_TOKEN = 'token-de-prueba-de-editor-cccccccccccc';

vi.mock('../db.js', () => ({ prisma: db.prisma }));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    resolveSession: async (token: string) => {
      const user = db.sessions.get(token);
      if (!user) return null;
      return {
        user: { ...user, avatarUrl: null, settings: {}, createdAt: new Date() },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      };
    },
  };
});

const { COLLAB_PATH, createCollabServer, closeBoardConnectionsWithCode, FORBIDDEN_CODE } = await import('./server.js');
const { boardPresence, resetPresence } = await import('../lib/presence.js');

const ALLOWED_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';

let httpServer: Server;
let collab: ReturnType<typeof createCollabServer>;
let port = 0;

beforeAll(async () => {
  collab = createCollabServer();
  httpServer = createServer((_request, response) => {
    response.writeHead(404);
    response.end('not found');
  });
  collab.attach(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await collab.destroy();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

const ANA = { id: 'user_ana', email: 'ana@tablero.test', name: 'Ana' };
const BETO = { id: 'user_beto', email: 'beto@tablero.test', name: 'Beto' };
const CARO = { id: 'user_caro', email: 'caro@tablero.test', name: 'Caro' };

/** Las sesiones viven en el doble de `resolveSession` (una por token). */
function seedSessions(): void {
  db.addSession(SESSION_TOKEN, ANA);
  db.addSession(VIEWER_TOKEN, BETO);
  db.addSession(EDITOR_TOKEN, CARO);
}

beforeEach(() => {
  seedSessions();
  resetPresence();
});

afterEach(() => {
  db.reset();
  seedSessions();
});

type HandshakeResult = { opened: boolean; status?: number; error?: string };

/** WebSocket crudo: solo interesa cómo responde el upgrade HTTP. */
function rawHandshake(headers: Record<string, string>): Promise<HandshakeResult> {
  return new Promise<HandshakeResult>((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${COLLAB_PATH}`, { headers });
    socket.on('open', () => {
      resolve({ opened: true });
      socket.close();
    });
    socket.on('unexpected-response', (_request, response) => {
      resolve({ opened: false, status: response.statusCode });
      response.resume();
    });
    socket.on('error', (error) => resolve({ opened: false, error: error.message }));
  });
}

/** Provider real: cookie en el handshake y token que dispara la autenticación. */
function createProvider(boardId: string, sessionToken: string = SESSION_TOKEN): { provider: HocuspocusProvider; close: () => void } {
  class CookieWebSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, {
        headers: { Cookie: `tablero_session=${sessionToken}`, Origin: ALLOWED_ORIGIN },
      });
    }
  }
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${port}${COLLAB_PATH}`,
    WebSocketPolyfill: CookieWebSocket as unknown as typeof WebSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: boardId,
    document: new Y.Doc(),
    token: 'cookie-session',
    broadcast: false,
    quiet: true,
  });
  return {
    provider,
    close: () => {
      provider.destroy();
      websocketProvider.destroy();
    },
  };
}

function waitFor(predicate: () => boolean, timeoutMs = 15_000, intervalMs = 100): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(timer);
        resolve(false);
      }
    }, intervalMs);
  });
}

describe('upgrade del WebSocket (Origin)', () => {
  it('rechaza el upgrade con cookie desde un Origin ajeno', async () => {
    const result = await rawHandshake({
      Cookie: `tablero_session=${SESSION_TOKEN}`,
      Origin: 'http://evil.example',
    });
    expect(result).toMatchObject({ opened: false, status: 403 });
  });

  it('rechaza el upgrade con cookie sin cabecera Origin', async () => {
    const result = await rawHandshake({ Cookie: `tablero_session=${SESSION_TOKEN}` });
    expect(result).toMatchObject({ opened: false, status: 403 });
  });

  it('acepta el upgrade con cookie desde el Origin permitido', async () => {
    const result = await rawHandshake({
      Cookie: `tablero_session=${SESSION_TOKEN}`,
      Origin: ALLOWED_ORIGIN,
    });
    expect(result.opened).toBe(true);
  });
});

describe('autenticación por WebSocket', () => {
  it('sincroniza un tablero activo (caso normal)', async () => {
    db.addBoard('board_activo');
    const { provider, close } = createProvider('board_activo');

    const synced = await waitFor(() => provider.synced);
    expect(synced).toBe(true);
    expect(provider.synced).toBe(true);

    close();
  });

  it('rechaza un tablero en la papelera, igual que el REST (409 board_trashed)', async () => {
    db.addBoard('board_papelera', { trashedAt: new Date() });
    const { provider, close } = createProvider('board_papelera');

    let failed = false;
    provider.on('authenticationFailed', () => {
      failed = true;
    });

    const observed = await waitFor(() => failed || provider.synced);
    expect(observed).toBe(true);
    expect(failed).toBe(true);
    expect(provider.synced).toBe(false);

    close();
  });

  it('rechaza un tablero sin acceso para el usuario', async () => {
    const { provider, close } = createProvider('board_inexistente');

    let failed = false;
    provider.on('authenticationFailed', () => {
      failed = true;
    });

    const observed = await waitFor(() => failed || provider.synced);
    expect(observed).toBe(true);
    expect(failed).toBe(true);
    expect(provider.synced).toBe(false);

    close();
  });
});

describe('permisos por rol en el socket', () => {
  it('un lector se conecta en solo lectura y el servidor descarta sus updates', async () => {
    db.addBoard('board_compartido');
    db.addMember('board_compartido', 'user_beto', 'viewer');

    const { provider, close } = createProvider('board_compartido', VIEWER_TOKEN);
    const synced = await waitFor(() => provider.synced);
    expect(synced).toBe(true);
    // El servidor autentica el canal como solo lectura (scope del protocolo).
    expect(provider.authorizedScope).toBe('readonly');

    // El lector escribe en su copia local; el servidor no debe aplicarlo.
    provider.document.getMap('lector').set('intento', 'escribir');
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const serverDocument = collab.hocuspocus.documents.get('board_compartido');
    expect(serverDocument).toBeDefined();
    expect(serverDocument!.getMap('lector').get('intento')).toBeUndefined();
    close();
  });

  it('un comentarista crea comentarios por el socket y no puede editar una nota', async () => {
    db.addBoard('board_comentarista');
    db.addMember('board_comentarista', 'user_beto', 'commenter');

    const { provider, close } = createProvider('board_comentarista', VIEWER_TOKEN);
    const synced = await waitFor(() => provider.synced);
    expect(synced).toBe(true);
    // El scope del protocolo sigue siendo «solo lectura»: el permiso de
    // comentar es una excepción por mensaje, no una escritura libre.
    expect(provider.authorizedScope).toBe('readonly');

    // 1) Un comentario: el update toca solo `comments` y el servidor lo aplica.
    const commentId = addComment(
      provider.document,
      { elementId: null, x: 40, y: 60, authorId: 'user_beto', authorName: 'Beto', body: 'Comentario del comentarista' },
      'test',
    );
    const applied = await waitFor(() => {
      const serverDocument = collab.hocuspocus.documents.get('board_comentarista');
      return serverDocument ? readComments(serverDocument).some((entry) => entry.id === commentId) : false;
    });
    expect(applied).toBe(true);

    // 2) Una nota: el update toca `elements` y se descarta.
    const noteId = addElement(provider.document, 'note', { createdBy: 'user_beto', x: 10, y: 10 }, 'test');
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const serverDocument = collab.hocuspocus.documents.get('board_comentarista')!;
    expect(serverDocument.getMap('elements').get(noteId)).toBeUndefined();

    // El descarte no cierra la conexión (el cliente puede tener cambios
    // locales): el canal sigue vivo para lo que sí puede hacer.
    expect(provider.isConnected).toBe(true);
    close();
  });

  it('un lector no puede comentar (el update de `comments` se descarta)', async () => {
    db.addBoard('board_lector_comentarios');
    db.addMember('board_lector_comentarios', 'user_beto', 'viewer');

    const { provider, close } = createProvider('board_lector_comentarios', VIEWER_TOKEN);
    const synced = await waitFor(() => provider.synced);
    expect(synced).toBe(true);

    const commentId = addComment(
      provider.document,
      { elementId: null, x: 0, y: 0, authorId: 'user_beto', authorName: 'Beto', body: 'No debería entrar' },
      'test',
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const serverDocument = collab.hocuspocus.documents.get('board_lector_comentarios');
    expect(serverDocument).toBeDefined();
    expect(readComments(serverDocument!).some((entry) => entry.id === commentId)).toBe(false);
    close();
  });

  it('un editor escribe y el documento del servidor lo recibe', async () => {
    db.addBoard('board_editable');
    db.addMember('board_editable', 'user_caro', 'editor');

    const { provider, close } = createProvider('board_editable', EDITOR_TOKEN);
    const synced = await waitFor(() => provider.synced);
    expect(synced).toBe(true);
    expect(provider.authorizedScope).toBe('read-write'); // el servidor lo autoriza a escribir

    provider.document.getMap('editor').set('cambio', 'sí');
    const applied = await waitFor(() => {
      const serverDocument = collab.hocuspocus.documents.get('board_editable');
      return serverDocument?.getMap('editor').get('cambio') === 'sí';
    });
    expect(applied).toBe(true);
    close();
  });

  it('el dueño del tablero escribe (rol owner)', async () => {
    db.addBoard('board_propio');
    const { provider, close } = createProvider('board_propio');
    const synced = await waitFor(() => provider.synced);
    expect(synced).toBe(true);
    provider.document.getMap('dueño').set('ok', true);
    const applied = await waitFor(() => collab.hocuspocus.documents.get('board_propio')?.getMap('dueño').get('ok') === true);
    expect(applied).toBe(true);
    close();
  });

  it('un lector ve el tablero compartido (la lectura también se autoriza)', async () => {
    db.addBoard('board_lectura');
    db.addMember('board_lectura', 'user_beto', 'commenter');
    const { provider, close } = createProvider('board_lectura', VIEWER_TOKEN);
    const synced = await waitFor(() => provider.synced);
    expect(synced).toBe(true);
    close();
  });

  it('expulsar a un miembro cierra su conexión con 4403 (Forbidden), reabrible', async () => {
    db.addBoard('board_expulsion');
    db.addMember('board_expulsion', 'user_caro', 'editor');

    const { provider, close } = createProvider('board_expulsion', EDITOR_TOKEN);
    await waitFor(() => provider.synced);

    const closes: { code: number; reason: string }[] = [];
    provider.on('close', ({ event }: { event: { code: number; reason: string } }) => {
      closes.push({ code: event.code, reason: event.reason });
    });

    const closed = closeBoardConnectionsWithCode('board_expulsion', { userIds: ['user_caro'] });
    expect(closed).toBe(1);

    const observed = await waitFor(() => closes.length > 0);
    expect(observed).toBe(true);
    expect(closes[0]).toMatchObject({ code: FORBIDDEN_CODE });
    close();
  });

  it('registra la presencia de quien se conecta y la suelta al desconectar', async () => {
    db.addBoard('board_presencia');
    db.addMember('board_presencia', 'user_beto', 'viewer');

    const { provider, close } = createProvider('board_presencia', VIEWER_TOKEN);
    await waitFor(() => provider.synced);

    const seen = boardPresence('board_presencia');
    expect(seen.map((user) => user.userId)).toContain('user_beto');
    expect(seen.find((user) => user.userId === 'user_beto')?.connected).toBe(true);
    // Nombre en el estado: el indicador no necesita otra consulta.
    expect(seen.find((user) => user.userId === 'user_beto')?.name).toBe('Beto');

    close();
    const released = await waitFor(() => boardPresence('board_presencia').every((user) => !user.connected), 5_000, 100);
    expect(released).toBe(true);
  });
});

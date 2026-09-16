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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
    trashedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };

  const boards = new Map<string, Row>();
  const documents = new Map<string, { boardId: string; yjsState: Buffer; updatedAt: Date }>();

  const addBoard = (id: string, options: { trashedAt?: Date | null } = {}): Row => {
    const now = new Date();
    const row: Row = {
      id,
      ownerId: 'user_ana',
      parentBoardId: 'root',
      title: id,
      icon: null,
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      trashedAt: options.trashedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    boards.set(id, row);
    return row;
  };

  const prisma = {
    board: { findMany: async () => [...boards.values()] },
    share: { findMany: async () => [] },
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
    $transaction: async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
  };

  return { boards, documents, prisma, addBoard, reset: () => { boards.clear(); documents.clear(); } };
});

const SESSION_TOKEN = 'token-de-prueba-de-colaboracion';

vi.mock('../db.js', () => ({ prisma: db.prisma }));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    resolveSession: async (token: string) =>
      token === SESSION_TOKEN
        ? {
            user: {
              id: 'user_ana',
              email: 'ana@tablero.test',
              name: 'Ana',
              avatarUrl: null,
              settings: {},
              createdAt: new Date(),
            },
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          }
        : null,
  };
});

const { COLLAB_PATH, createCollabServer } = await import('./server.js');

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

afterEach(() => {
  db.reset();
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
function createProvider(boardId: string): { provider: HocuspocusProvider; close: () => void } {
  class CookieWebSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, {
        headers: { Cookie: `tablero_session=${SESSION_TOKEN}`, Origin: ALLOWED_ORIGIN },
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

/**
 * Tiempo real (Hocuspocus) montado sobre el MISMO servidor HTTP de Fastify.
 *
 * - Ruta de upgrade: `/collab` (el nombre del documento es el id del tablero y
 *   viaja en el protocolo, no en la URL).
 * - Autenticación: cookie `tablero_session` de las cabeceras del handshake.
 *   Como respaldo para clientes no navegador se acepta también el `token` del
 *   protocolo, pero NUNCA por query string. Un tablero en la papelera se
 *   rechaza igual que en `GET /api/boards/:id/document` (409 `board_trashed`).
 * - Origen: si el handshake trae cookie de sesión, el `Origin` tiene que ser
 *   uno de los permitidos (el guardia CSRF del REST no ve los upgrades).
 * - Persistencia: `BoardDocument.yjsState` en Postgres, con debounce de 2 s y
 *   tope de 10 s (`maxDebounce`).
 */

import type { IncomingMessage, Server as HttpServer } from 'node:http';

import { Hocuspocus } from '@hocuspocus/server';
import { canEdit, canView } from '@tablero/shared';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';

import { prisma } from '../db.js';
import { env } from '../env.js';
import { boardAccessFor } from '../lib/boards.js';
import { syncSearchIndex } from '../lib/documents.js';
import { SESSION_COOKIE, parseCookieHeader, resolveSession } from '../lib/session.js';

export const COLLAB_PATH = '/collab';

export type CollabContext = {
  userId: string;
  boardId: string;
  role: string;
  canWrite: boolean;
};

export type CollabServer = {
  hocuspocus: Hocuspocus;
  attach: (httpServer: HttpServer) => void;
  destroy: () => Promise<void>;
};

/** Origen normalizado de una cabecera (`null` si falta o no es una URL). */
function originOf(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Defensa en profundidad: el guardia CSRF no ve el upgrade (`/collab` no pasa
 * por Fastify). Con cookie de sesión en el handshake, el `Origin` tiene que
 * estar entre los permitidos; sin cookie no hay nada que proteger (el hook
 * `onAuthenticate` exige una sesión válida de todos modos).
 */
function upgradeOriginAllowed(request: IncomingMessage): boolean {
  const cookieToken = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE];
  if (!cookieToken) return true;
  const origin = originOf(request.headers.origin);
  return origin !== null && env.allowedOrigins.has(origin);
}

export function createCollabServer(options: { log?: (message: string) => void } = {}): CollabServer {
  const log = options.log ?? (() => undefined);

  const hocuspocus = new Hocuspocus({
    name: 'tablero',
    quiet: true,
    debounce: 2000,
    maxDebounce: 10_000,
    // El apagado lo maneja el servidor Fastify (onClose), no las señales del SO.
    stopOnSignals: false,

    async onAuthenticate(data): Promise<CollabContext> {
      const cookieToken = parseCookieHeader(data.requestHeaders.cookie)[SESSION_COOKIE];
      const protocolToken = typeof data.token === 'string' && data.token.length >= 32 ? data.token : null;
      const token = cookieToken ?? protocolToken;
      if (!token) throw new Error('No autenticado');
      const session = await resolveSession(token);
      if (!session) throw new Error('Sesión inválida o expirada');
      const { role, trashedAt } = await boardAccessFor(session.user.id, data.documentName);
      if (!role || !canView(role)) throw new Error('Sin acceso al tablero');
      // Coherencia con `GET /api/boards/:id/document` (409 board_trashed): un
      // tablero en la papelera no se sincroniza ni se edita por WebSocket.
      if (trashedAt) throw new Error('El tablero está en la papelera');
      const writable = canEdit(role);
      data.connection.readOnly = !writable;
      log(`collab: ${session.user.id} → ${data.documentName} (${role}${writable ? '' : ', solo lectura'})`);
      return { userId: session.user.id, boardId: data.documentName, role, canWrite: writable };
    },

    async onLoadDocument({ documentName, document }) {
      const row = await prisma.boardDocument.findUnique({ where: { boardId: documentName } });
      if (!row) {
        // La fila se crea vacía: el documento existe desde la primera conexión.
        await prisma.boardDocument.create({
          data: { boardId: documentName, yjsState: Buffer.from(Y.encodeStateAsUpdate(document)) },
        });
        return;
      }
      Y.applyUpdate(document, new Uint8Array(row.yjsState));
    },

    async onStoreDocument({ documentName, document }) {
      const state = Y.encodeStateAsUpdate(document);
      await prisma.boardDocument.upsert({
        where: { boardId: documentName },
        create: { boardId: documentName, yjsState: Buffer.from(state) },
        update: { yjsState: Buffer.from(state) },
      });
      try {
        const indexed = await syncSearchIndex(documentName, document);
        log(`collab: ${documentName} persistido (${state.byteLength} bytes, ${indexed} elementos indexados)`);
      } catch (error) {
        // La persistencia ya ocurrió: un fallo de índice no debe propagarse.
        log(`collab: fallo al indexar ${documentName}: ${String(error)}`);
      }
    },
  });

  const webSocketServer = new WebSocketServer({ noServer: true });

  webSocketServer.on('connection', (socket, request) => {
    socket.on('error', (error) => log(`collab: error de websocket: ${String(error)}`));
    hocuspocus.handleConnection(socket, request);
  });

  const attach = (httpServer: HttpServer): void => {
    httpServer.on('upgrade', (request, socket, head) => {
      const rawUrl = request.url ?? '';
      const pathname = rawUrl.split('?')[0] ?? '';
      if (pathname !== COLLAB_PATH) return;
      // Un cliente que corta la conexión a mitad del handshake (o justo después
      // de recibir un 403) emite `error` con ECONNRESET sobre este socket. Sin
      // manejador, Node lo trata como error no capturado y **tumba el proceso**:
      // era un apagado remoto a un solo request.
      socket.on('error', (error) => {
        log(`collab: conexión de upgrade cortada: ${String(error)}`);
      });
      if (!upgradeOriginAllowed(request)) {
        log(`collab: upgrade rechazado (Origin no permitido: ${String(request.headers.origin ?? 'sin Origin')})`);
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.end();
        return;
      }
      void (async () => {
        try {
          await hocuspocus.hooks('onUpgrade', { request, socket, head, instance: hocuspocus });
          webSocketServer.handleUpgrade(request, socket, head, (ws) => {
            webSocketServer.emit('connection', ws, request);
          });
        } catch (error) {
          log(`collab: upgrade rechazado: ${String(error)}`);
          socket.destroy();
        }
      })();
    });
  };

  const destroy = async (): Promise<void> => {
    for (const client of webSocketServer.clients) client.close(1001, 'server shutting down');
    await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
    await hocuspocus.destroy();
  };

  return { hocuspocus, attach, destroy };
}

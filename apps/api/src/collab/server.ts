/**
 * Tiempo real (Hocuspocus) montado sobre el MISMO servidor HTTP de Fastify.
 *
 * - Ruta de upgrade: `/collab` (el nombre del documento es el id del tablero y
 *   viaja en el protocolo, no en la URL).
 * - Autenticación: cookie `tablero_session` de las cabeceras del handshake.
 *   Como respaldo para clientes no navegador se acepta también el `token` del
 *   protocolo, pero NUNCA por query string.
 * - Persistencia: `BoardDocument.yjsState` en Postgres, con debounce de 2 s y
 *   tope de 10 s (`maxDebounce`).
 */

import type { Server as HttpServer } from 'node:http';

import { Hocuspocus } from '@hocuspocus/server';
import { canEdit, canView } from '@tablero/shared';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';

import { prisma } from '../db.js';
import { roleOnBoard } from '../lib/boards.js';
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
      const role = await roleOnBoard(session.user.id, data.documentName);
      if (!role || !canView(role)) throw new Error('Sin acceso al tablero');
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

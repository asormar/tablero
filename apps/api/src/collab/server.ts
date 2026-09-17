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
import { canEdit, canView, elementCount } from '@tablero/shared';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';

import { prisma } from '../db.js';
import { env } from '../env.js';
import { boardAccessFor } from '../lib/boards.js';
import { syncSearchIndex } from '../lib/documents.js';
import { SESSION_COOKIE, parseCookieHeader, resolveSession } from '../lib/session.js';
import { pruneVersions, recordVersion } from '../lib/versions.js';

export const COLLAB_PATH = '/collab';

/**
 * Instancia activa del servidor de colaboración (una por proceso).
 *
 * Las rutas la necesitan para dos cosas que solo se pueden hacer sobre el
 * documento *vivo*: cerrar las conexiones de un tablero (restaurar una versión)
 * y escribir en él sin un cliente conectado (captura rápida).
 */
let activeServer: Hocuspocus | null = null;

export function getActiveCollabServer(): Hocuspocus | null {
  return activeServer;
}

/** Código de cierre «Reset Connection» del protocolo (Hocuspocus 4205): el cliente reconecta. */
const RESET_CONNECTION_CODE = 4205;
const RESET_CONNECTION_REASON = 'Reset Connection';

/**
 * Ventana de guardia tras restaurar una versión: mientras está activa, las
 * conexiones a ese tablero se cierran con «Reset Connection».
 *
 * Por qué: un cliente que todavía tiene el documento *anterior* en memoria lo
 * reenvía al reconectar y la fusión CRDT volvería a meter el contenido que el
 * usuario acaba de descartar. Con la guardia, esa reconexión no llega a
 * sincronizar; el cliente reintenta (el código 4205 es reabrible) y, según su
 * contrato, vuelve a cargar el documento para traer la versión restaurada.
 */
const RESTORE_GUARD_MS = 8_000;
const restoreGuards = new Map<string, number>();

/** Cierra la puerta mientras se restaura (la espera del guardado puede tardar). */
export function beginBoardRestore(boardId: string): void {
  restoreGuards.set(boardId, Date.now() + 30_000);
}

/** Deja la guardia activa un rato más, ya con el estado restaurado persistido. */
export function finishBoardRestore(boardId: string): void {
  restoreGuards.set(boardId, Date.now() + RESTORE_GUARD_MS);
}

function guardActive(boardId: string): boolean {
  const until = restoreGuards.get(boardId);
  if (until === undefined) return false;
  if (until <= Date.now()) {
    restoreGuards.delete(boardId);
    return false;
  }
  return true;
}

/**
 * Cierra las conexiones de un tablero y **espera a que se vacíe el guardado
 * pendiente** antes de descargar el documento.
 *
 * Por qué la espera: Hocuspocus guarda con debounce; si cerráramos las
 * conexiones y escribiéramos la versión restaurada enseguida, el guardado en
 * vuelo (hasta `maxDebounce`, 10 s) reescribiría el estado viejo encima del
 * restaurado. Con las conexiones cerradas y el debounce vaciado, se descarga el
 * documento y la próxima conexión lo relee de Postgres.
 */
export async function closeBoardConnections(
  boardId: string,
): Promise<{ connections: number; unloaded: boolean; waitedMs: number }> {
  const server = activeServer;
  if (!server) return { connections: 0, unloaded: false, waitedMs: 0 };
  const started = Date.now();
  const connections = server.documents.get(boardId)?.getConnectionsCount() ?? 0;
  server.closeConnections(boardId);

  const deadline = started + server.configuration.maxDebounce + 2_000;
  while (Date.now() < deadline) {
    const pending = server.debouncer.isDebounced(`onStoreDocument-${boardId}`);
    const document = server.documents.get(boardId);
    if (!pending) {
      if (!document) return { connections, unloaded: true, waitedMs: Date.now() - started };
      if (document.getConnectionsCount() === 0) {
        await server.unloadDocument(document);
        return { connections, unloaded: !server.documents.has(boardId), waitedMs: Date.now() - started };
      }
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { connections, unloaded: !server.documents.has(boardId), waitedMs: Date.now() - started };
}

/**
 * Transacción sobre el documento vivo (si hay servidor). Devuelve `false`
 * cuando no hay servidor: el llamador decide el camino alternativo.
 */
export async function transactBoardDocument(
  boardId: string,
  fn: (doc: Y.Doc) => void,
  context: unknown = {},
): Promise<boolean> {
  const server = activeServer;
  if (!server) return false;
  const connection = await server.openDirectConnection(boardId, context);
  try {
    await connection.transact((document) => {
      fn(document as unknown as Y.Doc);
    });
  } finally {
    await connection.disconnect();
  }
  return true;
}

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

    /**
     * Guardia de restauración: mientras un tablero está recién restaurado, las
     * conexiones se cierran con «Reset Connection» (código 4205, reabrible) para
     * que ningún cliente reenvíe el documento anterior y lo reviva por fusión.
     */
    async onConnect(data) {
      if (guardActive(data.documentName)) {
        const error = new Error(
          'El tablero se restauró a una versión anterior: reconectá para traer el estado restaurado',
        ) as Error & { code?: number; reason?: string };
        error.code = RESET_CONNECTION_CODE;
        error.reason = RESET_CONNECTION_REASON;
        log(`collab: conexión a ${data.documentName} rechazada (restauración en curso)`);
        throw error;
      }
    },

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
      try {
        // Historial de versiones: una instantánea cada 10 minutos de actividad.
        const snapshot = await recordVersion({
          boardId: documentName,
          state,
          elementCount: elementCount(document),
          origin: 'auto',
        });
        if (snapshot) {
          const pruned = await pruneVersions(documentName);
          log(`collab: ${documentName} → instantánea ${snapshot.id}${pruned > 0 ? ` (podadas ${pruned})` : ''}`);
        }
      } catch (error) {
        // Igual que el índice: la persistencia no se cae por el historial.
        log(`collab: fallo al guardar la instantánea de ${documentName}: ${String(error)}`);
      }
    },
  });

  activeServer = hocuspocus;

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
    if (activeServer === hocuspocus) activeServer = null;
  };

  return { hocuspocus, attach, destroy };
}

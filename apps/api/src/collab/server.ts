/**
 * Tiempo real (Hocuspocus) montado sobre el MISMO servidor HTTP de Fastify.
 *
 * - Ruta de upgrade: `/collab` (el nombre del documento es el id del tablero y
 *   viaja en el protocolo, no en la URL).
 * - Autenticación: cookie `tablero_session` de las cabeceras del handshake.
 *   Como respaldo para clientes no navegador se acepta también el `token` del
 *   protocolo, pero NUNCA por query string. Un tablero en la papelera se
 *   rechaza igual que en `GET /api/boards/:id/document` (409 `board_trashed`).
 * - **Permisos por rol**: los resuelve `resolveBoardAccess` (la misma función
 *   que usan las rutas REST). El rol viaja en el estado de la conexión y un
 *   `viewer` (o `commenter`) no puede aplicar updates: el servidor los descarta
 *   (`readOnly` del protocolo más una segunda barrera en `beforeHandleMessage`).
 *   Los cierres usan **solo** los códigos del protocolo: 4401 `Unauthorized`
 *   (sin sesión), 4403 `Forbidden` (sin permiso o permiso perdido) y 4205
 *   `Reset Connection` (guardia de restauración). 4403 y 4205 son reabribles.
 * - **Presencia**: al conectar se registra nombre, rol y color (derivado del id)
 *   en `lib/presence.ts`; `GET /api/boards/:id/presence` la expone.
 * - Origen: si el handshake trae cookie de sesión, el `Origin` tiene que ser
 *   uno de los permitidos (el guardia CSRF del REST no ve los upgrades).
 * - Persistencia: `BoardDocument.yjsState` en Postgres, con debounce de 2 s y
 *   tope de 10 s (`maxDebounce`). El mismo hook extrae los comentarios a
 *   `Comment` (upsert + borrado), igual que el índice de búsqueda.
 */

import type { IncomingMessage, Server as HttpServer } from 'node:http';

import { Hocuspocus, IncomingMessage as HocuspocusMessage, MessageType } from '@hocuspocus/server';
import type { EffectiveRole } from '@tablero/shared';
import { canEdit, canView, cursorColor, elementCount } from '@tablero/shared';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';

import { prisma } from '../db.js';
import { env } from '../env.js';
import { resolveBoardAccess } from '../lib/access.js';
import { syncBoardComments } from '../lib/comments.js';
import { syncSearchIndex } from '../lib/documents.js';
import { releasePresence, touchPresence } from '../lib/presence.js';
import { SESSION_COOKIE, parseCookieHeader, resolveSession } from '../lib/session.js';
import { pruneVersions, recordVersion } from '../lib/versions.js';

export const COLLAB_PATH = '/collab';

/**
 * Códigos de cierre del protocolo: son **los únicos** que usa el servidor.
 *
 *   - 4401 `Unauthorized`: la conexión no tiene sesión válida.
 *   - 4403 `Forbidden`: la sesión no tiene permiso (o perdió el que tenía).
 *   - 4205 `Reset Connection`: guardia de restauración (reabrible).
 *
 * 4403 y 4205 son reabribles: al reconectar, el handshake vuelve a decidir con
 * el permiso vigente; si ya no hay acceso, `onAuthenticate` cierra con 4401.
 */
export const UNAUTHORIZED_CODE = 4401;
export const FORBIDDEN_CODE = 4403;
export const ACCESS_CHANGED_REASON = 'Forbidden';

/**
 * Instancia activa del servidor de colaboración (una por proceso).
 *
 * Las rutas la necesitan para tres cosas que solo se pueden hacer sobre el
 * documento *vivo*: cerrar las conexiones de un tablero (restaurar una versión,
 * expulsar a alguien), escribir en él sin un cliente conectado (captura rápida,
 * comentarios) y forzar su persistencia antes de leer el estado.
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
 * Cierra las conexiones de un tablero con el código de «permiso cambiado».
 * Lo usan las rutas de miembros al expulsar a alguien o al bajarle el rol: el
 * socket se cae en el acto y el cliente reconecta (y ya no podrá escribir).
 *
 * `userIds` acota el cierre a esas cuentas; sin él se cierran todas las del
 * tablero (por ejemplo, al despublicar).
 */
export function closeBoardConnectionsWithCode(
  boardId: string,
  options: { userIds?: string[]; code?: number; reason?: string } = {},
): number {
  const server = activeServer;
  if (!server) return 0;
  const document = server.documents.get(boardId);
  if (!document) return 0;
  const code = options.code ?? FORBIDDEN_CODE;
  const reason = options.reason ?? ACCESS_CHANGED_REASON;
  let closed = 0;
  for (const connection of document.getConnections()) {
    const userId = (connection.context as CollabContext | undefined)?.userId;
    if (options.userIds && (userId === undefined || !options.userIds.includes(userId))) continue;
    connection.close({ code, reason });
    closed += 1;
  }
  return closed;
}

/** Usuarios con un socket abierto en un tablero (para presencia y avisos). */
export function boardConnectionUserIds(boardId: string): string[] {
  const server = activeServer;
  if (!server) return [];
  const document = server.documents.get(boardId);
  if (!document) return [];
  const ids = new Set<string>();
  for (const connection of document.getConnections()) {
    const userId = (connection.context as CollabContext | undefined)?.userId;
    if (userId) ids.add(userId);
  }
  return [...ids];
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

/**
 * Abre el documento (si hay servidor) y lo cierra: el hook de persistencia
 * corre al desconectar la conexión directa, así que el estado en Postgres queda
 * al día sin esperar el debounce. Devuelve si había servidor.
 */
export async function flushBoardDocument(boardId: string): Promise<boolean> {
  const server = activeServer;
  if (!server) return false;
  const connection = await server.openDirectConnection(boardId, { source: 'flush' });
  await connection.disconnect();
  return true;
}

export type CollabContext = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  boardId: string;
  role: EffectiveRole;
  canWrite: boolean;
  /** Color del cursor derivado del id (los ocho tokens de la paleta). */
  color: string;
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

/** Error de protocolo con código propio: Hocuspocus cierra con él (reabrible). */
function protocolError(message: string, code: number, reason: string): Error {
  const error = new Error(message) as Error & { code?: number; reason?: string };
  error.code = code;
  error.reason = reason;
  return error;
}

/** Subtipos del mensaje de sincronización que *escriben* en el documento. */
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

/**
 * ¿El mensaje entrante trae cambios de documento? Se lee la cabecera del
 * protocolo (nombre del documento + tipo + subtipo) sin depender de internals:
 * awareness y sync-step1 no escriben, sync-step2 y update sí.
 */
function isDocumentWrite(update: Uint8Array): boolean {
  try {
    const message = new HocuspocusMessage(update);
    message.readVarString();
    const type = message.readVarUint();
    if (type !== MessageType.Sync) return false;
    const subType = message.readVarUint();
    return subType === SYNC_STEP2 || subType === SYNC_UPDATE;
  } catch {
    return false;
  }
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
        log(`collab: conexión a ${data.documentName} rechazada (restauración en curso)`);
        throw protocolError(
          'El tablero se restauró a una versión anterior: reconectá para traer el estado restaurado',
          RESET_CONNECTION_CODE,
          RESET_CONNECTION_REASON,
        );
      }
    },

    /**
     * Autenticación y **autorización de lectura**: sin rol en el tablero no hay
     * conexión. El rol queda en el estado de la conexión y decide la escritura.
     */
    async onAuthenticate(data): Promise<CollabContext> {
      const cookieToken = parseCookieHeader(data.requestHeaders.cookie)[SESSION_COOKIE];
      const protocolToken = typeof data.token === 'string' && data.token.length >= 32 ? data.token : null;
      const token = cookieToken ?? protocolToken;
      // Sin sesión: 4401 `Unauthorized` (el cliente no vuelve a reintentar solo).
      if (!token) throw protocolError('No autenticado', UNAUTHORIZED_CODE, 'Unauthorized');
      const session = await resolveSession(token);
      if (!session) throw protocolError('Sesión inválida o expirada', UNAUTHORIZED_CODE, 'Unauthorized');

      const resolution = await resolveBoardAccess(session.user.id, data.documentName);
      if (!resolution.allowed || !canView(resolution.role === 'none' ? null : resolution.role)) {
        throw protocolError('Sin acceso al tablero', FORBIDDEN_CODE, ACCESS_CHANGED_REASON);
      }
      // Coherencia con `GET /api/boards/:id/document` (409 board_trashed): un
      // tablero en la papelera no se sincroniza ni se edita por WebSocket.
      if (resolution.trashedAt) {
        throw protocolError('El tablero está en la papelera', FORBIDDEN_CODE, ACCESS_CHANGED_REASON);
      }

      const role = resolution.role as EffectiveRole;
      const writable = canEdit(role);
      data.connection.readOnly = !writable;
      touchPresence(
        data.documentName,
        { userId: session.user.id, name: session.user.name, avatarUrl: session.user.avatarUrl, role },
        { socket: true },
      );
      log(`collab: ${session.user.id} → ${data.documentName} (${role}${writable ? '' : ', solo lectura'})`);
      return {
        userId: session.user.id,
        name: session.user.name,
        avatarUrl: session.user.avatarUrl,
        boardId: data.documentName,
        role,
        canWrite: writable,
        color: cursorColor(session.user.id),
      };
    },

    /**
     * Segunda comprobación de lectura: el documento se carga para una conexión
     * autenticada (o para una conexión directa del propio servidor, que trae
     * `userId` en el contexto cuando viene de una ruta con sesión).
     */
    async onLoadDocument(data) {
      const context = data.context as Partial<CollabContext> & { source?: string };
      if (typeof context?.userId === 'string') {
        const resolution = await resolveBoardAccess(context.userId, data.documentName);
        if (!resolution.allowed) {
          throw protocolError('Sin acceso al tablero', FORBIDDEN_CODE, ACCESS_CHANGED_REASON);
        }
        if (resolution.trashedAt) {
          throw protocolError('El tablero está en la papelera', FORBIDDEN_CODE, ACCESS_CHANGED_REASON);
        }
        if (context.name) {
          touchPresence(data.documentName, {
            userId: context.userId,
            name: context.name,
            avatarUrl: context.avatarUrl ?? null,
            role: (context.role as EffectiveRole) ?? 'viewer',
          });
        }
      }

      const row = await prisma.boardDocument.findUnique({ where: { boardId: data.documentName } });
      if (!row) {
        // La fila se crea vacía: el documento existe desde la primera conexión.
        await prisma.boardDocument.create({
          data: { boardId: data.documentName, yjsState: Buffer.from(Y.encodeStateAsUpdate(data.document)) },
        });
        return;
      }
      Y.applyUpdate(data.document, new Uint8Array(row.yjsState));
    },

    /**
     * Tercera barrera al aplicar updates: el protocolo ya descarta los cambios
     * de un canal de solo lectura (`readOnly`), acá queda el registro de que el
     * intento llegó y se descartó (y la comprobación explícita de que el canal
     * no tiene permiso de escritura).
     *
     * No se cierra la conexión: el cliente del lector puede tener cambios
     * locales sin sincronizar y cerrarle el socket lo dejaría reconectando en
     * bucle. El cierre con 4403 `Forbidden` se reserva para cuando el permiso
     * *cambia* (expulsión, cambio de rol, tablero a la papelera).
     */
    async beforeHandleMessage({ connection, update, documentName }) {
      const context = connection.context as CollabContext | undefined;
      // Sin sesión en el contexto (no debería pasar: el handshake lo exige) la
      // conexión se cierra con 4401 `Unauthorized`.
      if (!context || typeof context.userId !== 'string') {
        throw protocolError('No autenticado', UNAUTHORIZED_CODE, 'Unauthorized');
      }
      if (context.canWrite) return;
      if (!isDocumentWrite(update)) return;
      log(`collab: ${context.userId} intentó escribir en ${documentName} como ${context.role}: update descartado`);
    },

    /** Suelta la presencia del usuario cuando se va su última conexión. */
    async onDisconnect(data) {
      const context = data.context as CollabContext | undefined;
      if (context?.userId) releasePresence(data.documentName, context.userId);
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
        // Los comentarios viven en el documento: acá se extraen a su tabla.
        const comments = await syncBoardComments(documentName, document);
        if (comments.upserted > 0 || comments.removed > 0) {
          log(
            `collab: ${documentName} comentarios → ${comments.upserted} filas` +
              `${comments.removed > 0 ? `, ${comments.removed} borradas` : ''}` +
              `${comments.mentions > 0 ? `, ${comments.mentions} menciones` : ''}`,
          );
        }
      } catch (error) {
        // Igual que el índice: la persistencia no se cae por los comentarios.
        log(`collab: fallo al sincronizar comentarios de ${documentName}: ${String(error)}`);
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

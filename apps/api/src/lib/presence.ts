/**
 * Presencia: quién está mirando cada tablero (fase 5).
 *
 * El registro vive en memoria del proceso (hay una sola instancia de API en
 * desarrollo y el producto es autoalojado). Lo alimentan dos caminos:
 *
 *   - el servidor de colaboración, al autenticar una conexión y en cada
 *     mensaje de awareness (mientras el socket siga abierto);
 *   - las rutas REST por tablero, que tocan presencia con el usuario de la
 *     sesión: el indicador también funciona «aunque no haya socket».
 *
 * `GET /api/boards/:id/presence` devuelve los usuarios vistos en los últimos
 * 60 s (`PRESENCE_WINDOW_MS`), con el color de cursor derivado de su id.
 */

import type { AccessLevel, PresenceUser } from '@tablero/shared';
import { cursorColor, PRESENCE_WINDOW_MS } from '@tablero/shared';

export type PresenceContact = {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  role: AccessLevel;
};

type PresenceEntry = {
  name: string;
  avatarUrl: string | null;
  role: AccessLevel;
  lastSeenAt: number;
  /** Conexiones de socket abiertas (el REST deja esto en 0). */
  connections: number;
};

const boards = new Map<string, Map<string, PresenceEntry>>();

/** Deja constancia de que el usuario está mirando el tablero. */
export function touchPresence(boardId: string, contact: PresenceContact, options: { socket?: boolean; now?: number } = {}): void {
  const now = options.now ?? Date.now();
  let board = boards.get(boardId);
  if (!board) {
    board = new Map();
    boards.set(boardId, board);
  }
  const entry = board.get(contact.userId);
  if (entry) {
    entry.name = contact.name;
    entry.avatarUrl = contact.avatarUrl ?? entry.avatarUrl;
    entry.role = contact.role;
    entry.lastSeenAt = now;
    if (options.socket) entry.connections += 1;
    return;
  }
  board.set(contact.userId, {
    name: contact.name,
    avatarUrl: contact.avatarUrl ?? null,
    role: contact.role,
    lastSeenAt: now,
    connections: options.socket ? 1 : 0,
  });
}

/**
 * Suelta una conexión de socket del usuario. La entrada no se borra: el
 * indicador mantiene a quien cerró la pestaña recién hasta que caduque la
 * ventana de 60 s (y así el «se está yendo» no parpadea).
 */
export function releasePresence(boardId: string, userId: string, options: { now?: number } = {}): void {
  const board = boards.get(boardId);
  const entry = board?.get(userId);
  if (!board || !entry) return;
  entry.connections = Math.max(0, entry.connections - 1);
  entry.lastSeenAt = options.now ?? Date.now();
  if (entry.connections === 0 && board.size > 64) board.delete(userId);
}

/** Usuarios vistos en la ventana de presencia, el último visto primero. */
export function boardPresence(boardId: string, options: { now?: number; windowMs?: number } = {}): PresenceUser[] {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? PRESENCE_WINDOW_MS;
  const board = boards.get(boardId);
  if (!board) return [];
  const users: PresenceUser[] = [];
  for (const [userId, entry] of board) {
    if (now - entry.lastSeenAt > windowMs) {
      board.delete(userId);
      continue;
    }
    users.push({
      userId,
      name: entry.name,
      avatarUrl: entry.avatarUrl,
      color: cursorColor(userId),
      role: entry.role,
      lastSeenAt: entry.lastSeenAt,
      connected: entry.connections > 0,
    });
  }
  return users.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/** Olvida un tablero (borrado definitivo o apagado del servidor). */
export function forgetPresence(boardId: string): void {
  boards.delete(boardId);
}

/** Vacía el registro (tests). */
export function resetPresence(): void {
  boards.clear();
}

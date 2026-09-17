/**
 * Presencia y cursores ajenos (punto 4 de la fase 5).
 *
 * El estado de presencia viaja por `awareness` de Yjs (el mismo canal del
 * documento, así que funciona sin endpoints extra). Cada cliente publica:
 *
 *   { user: { id, name, color }, cursor: { x, y } | null, selection: string[],
 *     editingId: string | null, boardId, at }
 *
 * `cursor` va en **coordenadas de mundo**: cada uno tiene su propio viewport, y
 * el cursor ajeno se dibuja transformando con el viewport local.
 *
 * El color sale del `id` del usuario contra ocho tokens de la paleta, para que
 * dos usuarios no se pisen el color y sea estable entre sesiones.
 */

import { type ColorToken, type Point, type Viewport, shades, worldToScreen } from '@tablero/shared';

/** Los ocho tokens de la paleta que se reparten entre usuarios. */
export const CURSOR_TOKENS: ColorToken[] = [
  'blue',
  'green',
  'orange',
  'purple',
  'pink',
  'teal',
  'red',
  'indigo',
];

/** Hash estable (FNV-1a de 32 bits) de un id de usuario. */
export function hashUserId(userId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Token de color del cursor de un usuario (estable, reparte los ocho). */
export function cursorTokenFor(userId: string): ColorToken {
  const index = hashUserId(userId) % CURSOR_TOKENS.length;
  return CURSOR_TOKENS[index] ?? 'blue';
}

/** Color del cursor en el tema activo. */
export function cursorColorFor(userId: string, mode: 'light' | 'dark' = 'light'): string {
  return shades(cursorTokenFor(userId), mode).strong;
}

/** Color de fondo de la etiqueta del cursor (mismo tono, legible sobre él). */
export function cursorLabelColorFor(userId: string, mode: 'light' | 'dark' = 'light'): string {
  return shades(cursorTokenFor(userId), mode).soft;
}

export type PresenceUser = { id: string; name: string; color: string | null };

export type RemotePresence = {
  /** `clientId` de awareness (identifica la pestaña, no al usuario). */
  clientId: number;
  userId: string;
  name: string;
  color: string | null;
  /** Posición del puntero en coordenadas de mundo. */
  cursor: Point | null;
  /** Tarjetas que el otro cliente tiene seleccionadas. */
  selection: string[];
  editingId: string | null;
  /** Instante (ms) del último latido recibido en este cliente. */
  at: number;
};

/** Edad a partir de la cual una presencia se considera vencida (2 min). */
export const PRESENCE_TTL_MS = 120_000;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const x = record['x'];
  const y = record['y'];
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * Lee los estados de awareness y devuelve las presencias ajenas. Defensivo:
 * cualquier campo con forma inesperada se descarta en vez de romper el render.
 */
export function readRemotePresence(
  states: Map<number, unknown>,
  selfClientId: number | null,
  now = Date.now(),
): RemotePresence[] {
  const result: RemotePresence[] = [];
  for (const [clientId, raw] of states) {
    if (selfClientId !== null && clientId === selfClientId) continue;
    if (!raw || typeof raw !== 'object') continue;
    const state = raw as Record<string, unknown>;
    const user = (state['user'] ?? {}) as Record<string, unknown>;
    const userId = asString(user['id']);
    if (!userId) continue;
    const at = typeof state['at'] === 'number' ? state['at'] : now;
    const selection = Array.isArray(state['selection'])
      ? state['selection'].filter((id): id is string => typeof id === 'string')
      : [];
    result.push({
      clientId,
      userId,
      name: asString(user['name']) ?? 'Alguien',
      color: asString(user['color']),
      cursor: asPoint(state['cursor']),
      selection,
      editingId: asString(state['editingId']),
      at,
    });
  }
  return result.sort((a, b) => a.clientId - b.clientId);
}

/** Descarta presencias sin latido reciente. */
export function livePresence(presence: RemotePresence[], now = Date.now()): RemotePresence[] {
  return presence.filter((entry) => now - entry.at <= PRESENCE_TTL_MS);
}

/**
 * Una entrada por usuario (la pestaña más reciente manda): el indicador de
 * «quién está mirando» no puede repetir a la misma persona dos veces.
 */
export function uniqueByUser(presence: RemotePresence[]): RemotePresence[] {
  const byUser = new Map<string, RemotePresence>();
  for (const entry of presence) {
    const current = byUser.get(entry.userId);
    if (!current || current.at <= entry.at) byUser.set(entry.userId, entry);
  }
  return [...byUser.values()].sort((a, b) => a.userId.localeCompare(b.userId));
}

/** Posición en pantalla (relativa al lienzo) del cursor ajeno. */
export function cursorScreenPoint(cursor: Point, viewport: Viewport): Point {
  return worldToScreen(viewport, cursor);
}

export function presenceInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

/** «Ana», «Ana y Bruno», «Ana y 2 más». */
export function watchersLabel(names: string[]): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 2) return `${unique[0]} y ${unique[1]}`;
  return `${unique[0]} y ${unique.length - 1} más`;
}

/** ¿El cursor ajeno está dentro del viewport ampliado por un margen? */
export function cursorVisible(point: Point, viewport: Viewport, size: { width: number; height: number }, margin = 80): boolean {
  const screen = cursorScreenPoint(point, viewport);
  return (
    screen.x >= -margin &&
    screen.y >= -margin &&
    screen.x <= size.width + margin &&
    screen.y <= size.height + margin
  );
}

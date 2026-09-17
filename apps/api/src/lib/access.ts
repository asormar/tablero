/**
 * Autorización por tablero, en un solo lugar (fase 5).
 *
 * `resolveBoardAccess(userId, boardId)` devuelve el rol efectivo del usuario en
 * un tablero: `owner | editor | commenter | viewer | none`. La usan **todas** las
 * rutas por tablero y el servidor de colaboración; ninguna ruta decide permisos
 * por su cuenta.
 *
 * Herencia: el rol propio (fila explícita de `BoardMember`) manda; si no hay,
 * sube por la cadena de ancestros y gana la primera fila explícita que
 * encuentre. Un tablero propio del usuario es `owner`; un ancestro propio se
 * hereda como `editor` (heredar propiedad equivale a poder editar). Sin ninguna
 * fila en la cadena: `none`.
 *
 * La resolución trabaja sobre el árbol que ya carga `loadBoardAccess` (una
 * cuenta personal maneja cientos de tableros y el árbol entero se resuelve sin
 * consultas por nodo), pero expone una función suelta para los caminos que solo
 * tienen el `boardId` (por ejemplo, el handshake del WebSocket).
 */

import type { AccessLevel, BoardRole, EffectiveRole } from '@tablero/shared';
import { canComment, canEdit, canView, roleAtLeast } from '@tablero/shared';

import { loadBoardAccess, type BoardAccess, type BoardRecord } from './boards.js';
import { conflict, forbidden, notFound } from './errors.js';

export type BoardAccessResolution = {
  /** `owner | editor | commenter | viewer | none`. */
  role: AccessLevel;
  allowed: boolean;
  /** Tablero resuelto (`null` si no existe). */
  board: BoardRecord | null;
  trashedAt: Date | null;
  exists: boolean;
};

const NO_ACCESS: BoardAccessResolution = { role: 'none', allowed: false, board: null, trashedAt: null, exists: false };

/** Resolución a partir del árbol ya cargado (el camino sin consultas extra). */
export function resolveBoardAccessFrom(access: BoardAccess, boardId: string): BoardAccessResolution {
  const board = access.get(boardId);
  if (!board) return NO_ACCESS;
  const role = access.roleOf(boardId) ?? 'none';
  return { role, allowed: role !== 'none', board, trashedAt: board.trashedAt, exists: true };
}

/** Rol efectivo del usuario en un tablero, con herencia por ancestros. */
export async function resolveBoardAccess(userId: string, boardId: string): Promise<BoardAccessResolution> {
  const access = await loadBoardAccess(userId);
  return resolveBoardAccessFrom(access, boardId);
}

/** ¿Puede al menos mirarlo? */
export function canViewBoard(resolution: BoardAccessResolution): boolean {
  return canView(resolution.role === 'none' ? null : resolution.role);
}

/** ¿Puede comentar (rol comentarista o superior)? */
export function canCommentOnBoard(resolution: BoardAccessResolution): boolean {
  return canComment(resolution.role === 'none' ? null : resolution.role);
}

/** ¿Puede editar (rol editor o dueño)? */
export function canEditBoard(resolution: BoardAccessResolution): boolean {
  return canEdit(resolution.role === 'none' ? null : resolution.role);
}

const ROLE_MESSAGES: Record<BoardRole | 'owner', string> = {
  owner: 'Necesitás ser el dueño del tablero',
  editor: 'Necesitás rol de editor en este tablero',
  commenter: 'Necesitás rol de comentarista en este tablero',
  viewer: 'Necesitás acceso al tablero',
};

export type RequiredBoardAccess = {
  board: BoardRecord;
  role: EffectiveRole;
  resolution: BoardAccessResolution;
};

/**
 * Tablero con el mínimo de acceso verificado. 404 cuando no existe o no hay
 * ningún rol (no se filtra la existencia) y 403 cuando el rol no alcanza.
 * `allowTrashed` deja pasar la papelera para las rutas que la manejan.
 */
export function requireBoardAccess(
  resolution: BoardAccessResolution,
  minimum: BoardRole | 'owner' = 'viewer',
  options: { allowTrashed?: boolean } = {},
): RequiredBoardAccess {
  const { board, role } = resolution;
  if (!board || role === 'none') throw notFound('El tablero no existe o no tenés acceso');
  if (!roleAtLeast(role, minimum)) {
    throw forbidden(ROLE_MESSAGES[minimum], minimum === 'editor' ? 'forbidden_role' : 'forbidden_access');
  }
  if (!options.allowTrashed && board.trashedAt) {
    throw conflict('El tablero está en la papelera', 'board_trashed');
  }
  return { board, role, resolution };
}

/** Solo lectura obligatoria en la papelera: el llamador decide (`board_trashed`). */
export function requireBoardView(resolution: BoardAccessResolution, options: { allowTrashed?: boolean } = {}): RequiredBoardAccess {
  return requireBoardAccess(resolution, 'viewer', options);
}

/** Edición obligatoria (dueño o editor). */
export function requireBoardEditor(resolution: BoardAccessResolution, options: { allowTrashed?: boolean } = {}): RequiredBoardAccess {
  return requireBoardAccess(resolution, 'editor', options);
}

/** Comentar obligatorio (dueño, editor o comentarista). */
export function requireBoardCommenter(resolution: BoardAccessResolution): RequiredBoardAccess {
  return requireBoardAccess(resolution, 'commenter');
}

/** Gestión del tablero (miembros, publicación): solo el dueño. */
export function requireBoardOwner(resolution: BoardAccessResolution): RequiredBoardAccess {
  return requireBoardAccess(resolution, 'owner');
}

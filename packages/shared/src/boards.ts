/**
 * Tableros: metadatos (PostgreSQL), jerarquía y permisos.
 *
 * El contenido del lienzo vive en Yjs; aquí está lo relacional: árbol de
 * tableros, migas de pan, roles y publicación.
 */

export const BOARD_ROLES = ['viewer', 'commenter', 'editor'] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];
export type EffectiveRole = BoardRole | 'owner';

export type BoardSummary = {
  id: string;
  ownerId: string;
  parentBoardId: string | null;
  title: string;
  icon: string | null;
  color: string | null;
  coverImageId: string | null;
  isTemplate: boolean;
  publishedSlug: string | null;
  publishedAt?: number | null;
  shareToken?: string | null;
  trashedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Metadatos agregados que la API añade en las listas. */
  elementCount?: number;
  childrenCount?: number;
  favorited?: boolean;
  role?: EffectiveRole;
};

export const ROOT_BOARD_TITLE = 'Inicio';

/** Camino desde la raíz hasta el tablero actual (migas de pan). */
export function buildBreadcrumbPath(boards: BoardSummary[], currentId: string): BoardSummary[] {
  const byId = new Map(boards.map((board) => [board.id, board]));
  const path: BoardSummary[] = [];
  const visited = new Set<string>();
  let cursor: string | null = currentId;
  while (cursor) {
    if (visited.has(cursor)) break; // protección ante ciclos
    visited.add(cursor);
    const board = byId.get(cursor);
    if (!board) break;
    path.unshift(board);
    cursor = board.parentBoardId;
  }
  return path;
}

/** ids de todos los antecesores, del más cercano al raíz. */
export function ancestorIds(boards: BoardSummary[], boardId: string): string[] {
  const path = buildBreadcrumbPath(boards, boardId);
  return path
    .slice(0, -1)
    .reverse()
    .map((board) => board.id);
}

export function childrenOf(boards: BoardSummary[], parentId: string | null): BoardSummary[] {
  return boards.filter((board) => board.parentBoardId === parentId && board.trashedAt === null);
}

/** Subárbol completo (incluido el propio tablero), sin ciclos. */
export function subtreeIds(boards: BoardSummary[], rootId: string): string[] {
  const result: string[] = [];
  const queue = [rootId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    for (const child of boards) {
      if (child.parentBoardId === current) queue.push(child.id);
    }
  }
  return result;
}

/**
 * ¿Se puede mover `boardId` dentro de `targetId`? Evita mover un tablero
 * dentro de uno de sus descendientes.
 */
export function canMoveBoard(boards: BoardSummary[], boardId: string, targetId: string | null): boolean {
  if (boardId === targetId) return false;
  if (targetId === null) return true;
  return !subtreeIds(boards, boardId).includes(targetId);
}

/** Rol efectivo: el propio prevalece; los hijos heredan si no hay concesión directa. */
export function effectiveRole(
  directRole: BoardRole | null | undefined,
  inheritedRole: BoardRole | null | undefined,
  ownerId: string,
  userId: string,
): EffectiveRole | null {
  if (ownerId === userId) return 'owner';
  if (directRole) return directRole;
  if (inheritedRole) return inheritedRole;
  return null;
}

const ROLE_RANK: Record<EffectiveRole, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

export function roleAtLeast(role: EffectiveRole | null, minimum: BoardRole | 'owner'): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const canEdit = (role: EffectiveRole | null) => roleAtLeast(role, 'editor');
export const canComment = (role: EffectiveRole | null) => roleAtLeast(role, 'commenter');
export const canView = (role: EffectiveRole | null) => roleAtLeast(role, 'viewer');

/** Slug estable para la URL pública `/p/:slug`. */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function boardIcon(board: BoardSummary): string {
  return board.icon ?? '';
}

export const FALLBACK_BOARD_ICON = '📋';

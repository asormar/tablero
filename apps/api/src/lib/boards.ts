/**
 * Acceso a tableros: árbol, roles efectivos y proyección a `BoardSummary`.
 *
 * El árbol se carga entero (select acotado) porque una cuenta personal maneja
 * cientos de tableros y así se resuelven herencia de roles, migas de pan y
 * conteos sin consultas por nodo. Si el volumen creciera, el reemplazo natural
 * es una CTE recursiva en Postgres.
 */

import type { BoardSummary, BoardRole, EffectiveRole } from '@tablero/shared';
import { buildBreadcrumbPath, canEdit, canMoveBoard, effectiveRole, subtreeIds } from '@tablero/shared';

import { prisma } from '../db.js';

export type BoardRecord = {
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

const BOARD_SELECT = {
  id: true,
  ownerId: true,
  parentBoardId: true,
  title: true,
  icon: true,
  color: true,
  coverImageId: true,
  isTemplate: true,
  publishedSlug: true,
  trashedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type SummaryExtras = {
  elementCount?: number;
  favorited?: boolean;
  role?: EffectiveRole | null;
  childrenCount?: number;
};

export class BoardAccess {
  readonly userId: string;
  readonly boards: BoardRecord[];

  private readonly byIdMap: Map<string, BoardRecord>;
  private readonly roles = new Map<string, EffectiveRole>();
  private readonly direct = new Map<string, BoardRole>();
  private readonly childCounts = new Map<string, number>();

  constructor(userId: string, boards: BoardRecord[], shares: { boardId: string; role: BoardRole }[]) {
    this.userId = userId;
    this.boards = boards;
    this.byIdMap = new Map(boards.map((board) => [board.id, board]));
    for (const share of shares) this.direct.set(share.boardId, share.role);

    for (const board of boards) {
      if (board.trashedAt || !board.parentBoardId) continue;
      this.childCounts.set(board.parentBoardId, (this.childCounts.get(board.parentBoardId) ?? 0) + 1);
    }
    for (const board of boards) this.computeRole(board.id, new Set());
  }

  /** Rol efectivo: propio si existe, heredado del ancestro más cercano si no. */
  private computeRole(id: string, visiting: Set<string>): EffectiveRole | null {
    const cached = this.roles.get(id);
    if (cached !== undefined) return cached;
    const board = this.byIdMap.get(id);
    if (!board || visiting.has(id)) return null;
    visiting.add(id);
    const inherited = board.parentBoardId ? this.computeRole(board.parentBoardId, visiting) : null;
    // Un ancestro propio no hereda como 'owner' (el helper solo acepta BoardRole):
    // heredar propiedad equivale a poder editar.
    const inheritedRole: BoardRole | null =
      inherited === 'owner' ? 'editor' : (inherited as BoardRole | null);
    const role = effectiveRole(this.direct.get(id) ?? null, inheritedRole, board.ownerId, this.userId);
    if (role) this.roles.set(id, role);
    return role;
  }

  get(id: string): BoardRecord | undefined {
    return this.byIdMap.get(id);
  }

  roleOf(id: string): EffectiveRole | null {
    return this.roles.get(id) ?? null;
  }

  canEdit(id: string): boolean {
    return canEdit(this.roleOf(id));
  }

  /** Tablero raíz del usuario (el que se crea al registrarse). */
  rootBoard(): BoardRecord | undefined {
    return this.boards.find(
      (board) =>
        board.ownerId === this.userId &&
        board.parentBoardId === null &&
        board.trashedAt === null &&
        !board.isTemplate,
    );
  }

  /** Tableros accesibles con el rol indicado (por defecto: lectura). */
  accessible(options: { includeTrashed?: boolean; includeTemplates?: boolean; atLeastEditor?: boolean } = {}): BoardRecord[] {
    const { includeTrashed = false, includeTemplates = false, atLeastEditor = false } = options;
    return this.boards.filter((board) => {
      const role = this.roleOf(board.id);
      if (!role) return false;
      if (atLeastEditor && !canEdit(role)) return false;
      if (!includeTrashed && board.trashedAt) return false;
      if (!includeTemplates && board.isTemplate) return false;
      return true;
    });
  }

  children(parentId: string | null, options: { includeTrashed?: boolean } = {}): BoardRecord[] {
    const includeTrashed = options.includeTrashed ?? false;
    return this.accessible({ includeTrashed }).filter((board) => board.parentBoardId === parentId);
  }

  /** Subárbol completo (ids) partiendo de un tablero. */
  subtree(rootId: string): string[] {
    return subtreeIds(this.allSummaries(), rootId);
  }

  /** ¿Se puede mover `boardId` dentro de `targetId`? (evita mover a un descendiente). */
  canMove(boardId: string, targetId: string | null): boolean {
    if (targetId !== null && !this.byIdMap.has(targetId)) return false;
    return canMoveBoard(this.allSummaries(), boardId, targetId);
  }

  summary(board: BoardRecord, extras: SummaryExtras = {}): BoardSummary {
    const role = extras.role !== undefined ? extras.role : this.roleOf(board.id);
    const summary: BoardSummary = {
      id: board.id,
      ownerId: board.ownerId,
      parentBoardId: board.parentBoardId,
      title: board.title,
      icon: board.icon,
      color: board.color,
      coverImageId: board.coverImageId,
      isTemplate: board.isTemplate,
      publishedSlug: board.publishedSlug,
      trashedAt: board.trashedAt ? board.trashedAt.getTime() : null,
      createdAt: board.createdAt.getTime(),
      updatedAt: board.updatedAt.getTime(),
      childrenCount: extras.childrenCount ?? this.childCounts.get(board.id) ?? 0,
    };
    if (role) summary.role = role;
    if (extras.elementCount !== undefined) summary.elementCount = extras.elementCount;
    if (extras.favorited !== undefined) summary.favorited = extras.favorited;
    return summary;
  }

  summaries(boards: BoardRecord[], extrasFor?: (board: BoardRecord) => SummaryExtras): BoardSummary[] {
    return boards.map((board) => this.summary(board, extrasFor ? extrasFor(board) : {}));
  }

  /** Resúmenes de todos los tableros conocidos (para `buildBreadcrumbPath`). */
  allSummaries(): BoardSummary[] {
    return this.summaries(this.boards);
  }

  breadcrumbs(boardId: string): BoardSummary[] {
    return buildBreadcrumbPath(this.allSummaries(), boardId);
  }
}

export async function loadBoardAccess(userId: string): Promise<BoardAccess> {
  const [boards, shares] = await Promise.all([
    prisma.board.findMany({
      select: BOARD_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.share.findMany({ where: { userId }, select: { boardId: true, role: true } }),
  ]);
  return new BoardAccess(userId, boards as BoardRecord[], shares);
}

/** Rol de un usuario sobre un tablero concreto (atajo para el handshake WS). */
export async function roleOnBoard(userId: string, boardId: string): Promise<EffectiveRole | null> {
  const access = await loadBoardAccess(userId);
  return access.roleOf(boardId);
}

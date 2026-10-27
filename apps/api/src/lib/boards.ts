/**
 * Acceso a tableros: árbol, roles efectivos y proyección a `BoardSummary`.
 *
 * Se carga el árbol que alcanza al usuario (select acotado, ver
 * `loadBoardAccess`): una cuenta personal maneja cientos de tableros y así se
 * resuelven herencia de roles, migas de pan y conteos sin consultas por nodo.
 * Los tableros de otros usuarios sin relación con él no se leen. Si el volumen
 * creciera, el reemplazo natural es una CTE recursiva en Postgres.
 */

import type { BoardSummary, BoardRole, EffectiveRole } from '@tablero/shared';
import { buildBreadcrumbPath, canEdit, canMoveBoard, effectiveRole, subtreeIds } from '@tablero/shared';

import { prisma } from '../db.js';
import { forbidden, notFound, conflict } from './errors.js';
import { emptyDocumentUpdate } from './documents.js';

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
  /** Publicación (fase 5): hash argon2 de la contraseña, si la hay. */
  publishedPasswordHash: string | null;
  publishedAt: Date | null;
  publicIncludeSubBoards: boolean;
  trashedAt: Date | null;
  /** Momento en que se marcó como favorito (null = no lo es). */
  favoriteAt: Date | null;
  /** Tablero «Sin ordenar» de la cuenta. */
  isUnsorted: boolean;
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
  publishedPasswordHash: true,
  publishedAt: true,
  publicIncludeSubBoards: true,
  trashedAt: true,
  favoriteAt: true,
  isUnsorted: true,
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

  constructor(userId: string, boards: BoardRecord[], memberships: { boardId: string; role: BoardRole }[]) {
    this.userId = userId;
    this.boards = boards;
    this.byIdMap = new Map(boards.map((board) => [board.id, board]));
    for (const membership of memberships) this.direct.set(membership.boardId, membership.role);

    for (const board of boards) {
      if (board.trashedAt || !board.parentBoardId) continue;
      this.childCounts.set(board.parentBoardId, (this.childCounts.get(board.parentBoardId) ?? 0) + 1);
    }
    for (const board of boards) this.computeRole(board.id, new Set());
  }

  /**
   * Rol efectivo: propio si existe, heredado del ancestro más cercano si no.
   * Es la misma regla que documenta `lib/access.ts` (una sola autorización por
   * tablero en el proyecto); acá se memoiza para resolver el árbol entero.
   */
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

  /** Tablero «Sin ordenar» del usuario (uno por cuenta, hijo de la raíz). */
  unsortedBoard(): BoardRecord | undefined {
    return this.boards.find((board) => board.ownerId === this.userId && board.isUnsorted);
  }

  /**
   * Ancestro en papelera, si lo hay. Un tablero cuyo padre está en la papelera
   * no se puede restaurar solo: primero hay que restaurar al padre.
   */
  trashedAncestorOf(id: string): BoardRecord | null {
    const seen = new Set<string>([id]);
    let cursor = this.byIdMap.get(id)?.parentBoardId ?? null;
    while (cursor) {
      if (seen.has(cursor)) return null; // protección ante ciclos
      seen.add(cursor);
      const ancestor = this.byIdMap.get(cursor);
      if (!ancestor) return null;
      if (ancestor.trashedAt) return ancestor;
      cursor = ancestor.parentBoardId;
    }
    return null;
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
      // El estado de favorito se deriva de `favoriteAt`: la web lo pinta sin otra consulta.
      favorited: extras.favorited ?? board.favoriteAt !== null,
    };
    if (role) summary.role = role;
    if (extras.elementCount !== undefined) summary.elementCount = extras.elementCount;
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

/** Tamaño de los lotes `IN (...)` al bajar por el árbol (acota los parámetros por consulta). */
const TREE_BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/**
 * Carga solo los tableros que pueden tener que ver con el usuario:
 *
 * 1. Raíces de acceso: los que posee y aquellos donde es miembro.
 * 2. Descendientes de esas raíces (el rol se hereda hacia abajo, así que todo
 *    tablero con rol es raíz o descendiente de una raíz). Se baja nivel a nivel
 *    con lotes `parentBoardId IN (...)`; los hijos propios no se piden porque ya
 *    vinieron en el paso 1.
 * 3. Ancestros de todo lo anterior (migas de pan y `trashedAncestorOf`): son
 *    tableros ajenos sin rol, pero el árbol resuelve la cadena hasta la raíz.
 *
 * Los tableros de otros usuarios sin relación con estos no se leen. El resultado
 * se ordena por `createdAt`/`id`, igual que antes con el `orderBy` de la consulta.
 */
export async function loadBoardAccess(userId: string): Promise<BoardAccess> {
  const [memberships, rootRows] = await Promise.all([
    prisma.boardMember.findMany({ where: { userId }, select: { boardId: true, role: true } }),
    prisma.board.findMany({
      where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      select: BOARD_SELECT,
    }),
  ]);

  const byId = new Map<string, BoardRecord>();
  for (const row of rootRows as BoardRecord[]) byId.set(row.id, row);

  // Descendientes: cada ronda pide los hijos de lo descubierto en la anterior.
  let frontier = [...byId.keys()];
  while (frontier.length > 0) {
    const parents = new Set(frontier);
    const batches = await Promise.all(
      chunk(frontier, TREE_BATCH_SIZE).map((ids) =>
        prisma.board.findMany({
          where: { parentBoardId: { in: ids }, ownerId: { not: userId } },
          select: BOARD_SELECT,
        }),
      ),
    );
    frontier = [];
    for (const row of batches.flat() as BoardRecord[]) {
      if (row.parentBoardId === null || !parents.has(row.parentBoardId) || byId.has(row.id)) continue;
      byId.set(row.id, row);
      frontier.push(row.id);
    }
  }

  // Ancestros: se sube hasta que cada padre conocido esté cargado.
  const missingParents = (): string[] => {
    const missing = new Set<string>();
    for (const board of byId.values()) {
      if (board.parentBoardId !== null && !byId.has(board.parentBoardId)) missing.add(board.parentBoardId);
    }
    return [...missing];
  };
  for (let pending = missingParents(); pending.length > 0; pending = missingParents()) {
    const batches = await Promise.all(
      chunk(pending, TREE_BATCH_SIZE).map((ids) =>
        prisma.board.findMany({ where: { id: { in: ids } }, select: BOARD_SELECT }),
      ),
    );
    const wanted = new Set(pending);
    let found = 0;
    for (const row of batches.flat() as BoardRecord[]) {
      if (!wanted.has(row.id) || byId.has(row.id)) continue;
      byId.set(row.id, row);
      found += 1;
    }
    if (found === 0) break; // padres que ya no existen: no hay más cadena que subir
  }

  const boards = [...byId.values()].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return new BoardAccess(userId, boards, memberships);
}

/**
 * Ids del subárbol de un tablero (la raíz incluida), nivel por nivel.
 *
 * Lo usan los cambios de rol y las expulsiones: el permiso alcanza a los
 * subtableros por herencia, así que hay que cerrar las conexiones del afectado
 * en todo el subárbol, no solo en el tablero donde se toca la fila.
 */
export async function boardSubtreeIds(rootId: string): Promise<string[]> {
  const ids = [rootId];
  const seen = new Set(ids);
  let frontier = ids;
  while (frontier.length > 0) {
    const rows = await prisma.board.findMany({
      where: { parentBoardId: { in: frontier } },
      select: { id: true, parentBoardId: true },
    });
    const current = new Set(frontier);
    frontier = rows
      .filter((row) => row.parentBoardId !== null && current.has(row.parentBoardId) && !seen.has(row.id))
      .map((row) => row.id);
    for (const id of frontier) seen.add(id);
    ids.push(...frontier);
  }
  return ids;
}

export type UnsortedBoardResult = { access: BoardAccess; board: BoardRecord; created: boolean };

/** Título e icono de la bandeja de entrada de la cuenta (§4.3 del plan). */
export const UNSORTED_BOARD_TITLE = 'Sin ordenar';
export const UNSORTED_BOARD_ICON = '📥';

/**
 * Bandeja de entrada «Sin ordenar» (§4.3): la devuelve, creándola si no existe.
 * Es única por cuenta y cuelga de la raíz (solo el registro crea raíces). Si
 * alguien la mandó a la papelera, al pedirla vuelve.
 */
export async function ensureUnsortedBoard(userId: string): Promise<UnsortedBoardResult> {
  let access = await loadBoardAccess(userId);
  let board = access.unsortedBoard();
  let created = false;

  if (board && board.trashedAt) {
    await prisma.board.updateMany({
      where: { id: { in: [board.id] }, trashedAt: { not: null } },
      data: { trashedAt: null },
    });
    access = await loadBoardAccess(userId);
    board = access.unsortedBoard();
  } else if (!board) {
    const root = access.rootBoard();
    if (!root) throw conflict('La cuenta no tiene tablero raíz', 'missing_root_board');
    const result = await prisma.$transaction(async (tx) => {
      // Carrera entre dos pestañas: la segunda reutiliza la bandeja ya creada.
      const existing = await tx.board.findFirst({ where: { ownerId: userId, isUnsorted: true } });
      if (existing) return { board: existing, created: false };
      const row = await tx.board.create({
        data: {
          ownerId: userId,
          parentBoardId: root.id,
          title: UNSORTED_BOARD_TITLE,
          icon: UNSORTED_BOARD_ICON,
          isUnsorted: true,
        },
      });
      await tx.boardDocument.create({
        data: { boardId: row.id, yjsState: Buffer.from(emptyDocumentUpdate()) },
      });
      return { board: row, created: true };
    });
    created = result.created;
    access = await loadBoardAccess(userId);
    board = access.get(result.board.id);
  }

  if (!board) throw notFound('No se pudo obtener el tablero «Sin ordenar»');
  return { access, board, created };
}

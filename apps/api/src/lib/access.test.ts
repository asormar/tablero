/**
 * Autorización por tablero: la matriz de permisos y la herencia.
 *
 * `resolveBoardAccess` es la única puerta de permisos del API (la usan las
 * rutas y el servidor de colaboración), así que su tabla de verdad se prueba
 * acá: dueño, editor, comentarista, lector y ajeno, con herencia por la cadena
 * de ancestros y sobrescritura en el subtablero.
 *
 * La base se dobla con un Prisma en memoria (dos consultas: el árbol de
 * tableros y las membresías del usuario).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardRole } from '@tablero/shared';

type Row = {
  id: string;
  ownerId: string;
  parentBoardId: string | null;
  title: string;
  icon: string | null;
  color: string | null;
  coverImageId: string | null;
  isTemplate: boolean;
  publishedSlug: string | null;
  publishedPasswordHash: string | null;
  publishedAt: Date | null;
  publicIncludeSubBoards: boolean;
  trashedAt: Date | null;
  favoriteAt: Date | null;
  isUnsorted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const db = vi.hoisted(() => {
  const boards = new Map<string, Row>();
  const members = new Map<string, { boardId: string; userId: string; role: BoardRole }>();
  const key = (boardId: string, userId: string): string => `${boardId}:${userId}`;

  const prisma = {
    board: {
      findMany: async () => [...boards.values()].map((row) => ({ ...row })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = boards.get(where.id);
        return row ? { ...row } : null;
      },
    },
    boardMember: {
      findMany: async ({ where }: { where: { userId: string; boardId?: { in: string[] } } }) =>
        [...members.values()]
          .filter((member) => member.userId === where.userId)
          .filter((member) => (where.boardId?.in ? where.boardId.in.includes(member.boardId) : true))
          .map((member) => ({ boardId: member.boardId, role: member.role })),
    },
  };

  const addBoard = (id: string, options: Partial<Row> = {}): Row => {
    const now = new Date();
    const row: Row = {
      id,
      ownerId: 'user_ana',
      parentBoardId: null,
      title: id,
      icon: null,
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      publishedPasswordHash: null,
      publishedAt: null,
      publicIncludeSubBoards: false,
      trashedAt: null,
      favoriteAt: null,
      isUnsorted: false,
      createdAt: now,
      updatedAt: now,
      ...options,
    };
    boards.set(id, row);
    return row;
  };

  const addMember = (boardId: string, userId: string, role: BoardRole): void => {
    members.set(key(boardId, userId), { boardId, userId, role });
  };

  return { boards, members, prisma, addBoard, addMember, reset: () => { boards.clear(); members.clear(); } };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

const {
  resolveBoardAccess,
  requireBoardAccess,
  requireBoardEditor,
  requireBoardView,
  canEditBoard,
  canCommentOnBoard,
  canViewBoard,
  resolveBoardAccessFrom,
} = await import('./access.js');
const { loadBoardAccess } = await import('./boards.js');
const { HttpError } = await import('./errors.js');

/** Código del error (los helpers tiran `HttpError`). */
function codeOf(error: unknown): string | undefined {
  return error instanceof HttpError ? error.code : undefined;
}

beforeEach(() => {
  db.reset();
  // ana
  // └── inicio
  //     ├── proyecto
  //     │   └── referencias
  //     └── personal
  db.addBoard('inicio', { title: 'Inicio' });
  db.addBoard('proyecto', { title: 'Proyecto', parentBoardId: 'inicio' });
  db.addBoard('referencias', { title: 'Referencias', parentBoardId: 'proyecto' });
  db.addBoard('personal', { title: 'Personal', parentBoardId: 'inicio' });
});

describe('resolveBoardAccess: matriz de permisos', () => {
  it('el dueño es owner en todo su árbol', async () => {
    for (const boardId of ['inicio', 'proyecto', 'referencias', 'personal']) {
      const resolution = await resolveBoardAccess('user_ana', boardId);
      expect(resolution.role).toBe('owner');
      expect(canEditBoard(resolution)).toBe(true);
      expect(canViewBoard(resolution)).toBe(true);
    }
  });

  it('un usuario ajeno no tiene ningún rol y la resolución no filtra la existencia', async () => {
    const resolution = await resolveBoardAccess('user_zeta', 'proyecto');
    expect(resolution.role).toBe('none');
    expect(resolution.allowed).toBe(false);
    expect(resolution.exists).toBe(true);
    expect(resolution.board?.title).toBe('Proyecto');

    await expect(async () => requireBoardView(resolution)).rejects.toThrow(/no existe o no tenés acceso/);
    const missing = await resolveBoardAccess('user_zeta', 'no-existe');
    expect(missing.exists).toBe(false);
    expect(missing.board).toBeNull();
  });

  it('un lector ve el tablero y sus descendientes pero no puede escribir', async () => {
    db.addMember('proyecto', 'user_beto', 'viewer');
    const own = await resolveBoardAccess('user_beto', 'proyecto');
    expect(own.role).toBe('viewer');
    expect(canViewBoard(own)).toBe(true);
    expect(canCommentOnBoard(own)).toBe(false);
    expect(canEditBoard(own)).toBe(false);

    // Herencia hacia el hijo y el nieto de la membresía.
    const child = await resolveBoardAccess('user_beto', 'referencias');
    expect(child.role).toBe('viewer');

    // Fuera de ese subárbol no hay nada.
    expect((await resolveBoardAccess('user_beto', 'personal')).role).toBe('none');
    expect((await resolveBoardAccess('user_beto', 'inicio')).role).toBe('none');
  });

  it('un comentarista puede comentar pero no editar, y hereda igual', async () => {
    db.addMember('proyecto', 'user_dani', 'commenter');
    const resolution = await resolveBoardAccess('user_dani', 'referencias');
    expect(resolution.role).toBe('commenter');
    expect(canCommentOnBoard(resolution)).toBe(true);
    expect(canEditBoard(resolution)).toBe(false);

    expect(() => requireBoardEditor(resolution)).toThrow(/rol de editor/);
    try {
      requireBoardEditor(resolution);
    } catch (error) {
      expect(codeOf(error)).toBe('forbidden_role');
    }
  });

  it('un editor edita el tablero y sus descendientes', async () => {
    db.addMember('proyecto', 'user_caro', 'editor');
    const child = await resolveBoardAccess('user_caro', 'referencias');
    expect(child.role).toBe('editor');
    expect(canEditBoard(child)).toBe(true);
    expect(requireBoardEditor(child).role).toBe('editor');
  });

  it('la fila propia del subtablero sobrescribe lo heredado (y solo ahí)', async () => {
    db.addMember('proyecto', 'user_caro', 'viewer');
    db.addMember('referencias', 'user_caro', 'editor');

    expect((await resolveBoardAccess('user_caro', 'proyecto')).role).toBe('viewer');
    expect((await resolveBoardAccess('user_caro', 'referencias')).role).toBe('editor');
    // La sobrescritura no viaja hacia arriba ni a los hermanos.
    expect((await resolveBoardAccess('user_caro', 'personal')).role).toBe('none');
  });

  it('una membresía en el hijo no abre el padre', async () => {
    db.addMember('referencias', 'user_beto', 'editor');
    expect((await resolveBoardAccess('user_beto', 'referencias')).role).toBe('editor');
    expect((await resolveBoardAccess('user_beto', 'proyecto')).role).toBe('none');
    expect((await resolveBoardAccess('user_beto', 'inicio')).role).toBe('none');
  });

  it('el dueño manda sobre cualquier fila de miembro', async () => {
    db.addMember('proyecto', 'user_ana', 'viewer');
    expect((await resolveBoardAccess('user_ana', 'proyecto')).role).toBe('owner');
  });

  it('un tablero propio hereda la edición de un ancestro, nunca la propiedad', async () => {
    // ana es dueña de «de-ana»; beto es dueño de «de-beto», que cuelga de «de-ana».
    db.addBoard('de-ana', { title: 'De Ana' });
    db.addBoard('de-beto', { title: 'De Beto', parentBoardId: 'de-ana', ownerId: 'user_beto' });

    expect((await resolveBoardAccess('user_beto', 'de-beto')).role).toBe('owner');
    // Un descendiente de «de-beto» que pertenece a ana: beto hereda edición
    // (heredar propiedad equivale a poder editar), no `owner`.
    db.addBoard('movido', { title: 'Movido', parentBoardId: 'de-beto' });
    expect((await resolveBoardAccess('user_beto', 'movido')).role).toBe('editor');
    // La herencia no viaja hacia arriba: el padre de su tablero sigue ajeno.
    expect((await resolveBoardAccess('user_beto', 'de-ana')).role).toBe('none');
  });
});

describe('resolveBoardAccess: papelera y helpers de error', () => {
  it('informa la papelera y exige permiso de editor para gestionarla', async () => {
    db.addBoard('caido', { title: 'Caído', parentBoardId: 'inicio', trashedAt: new Date() });
    db.addMember('caido', 'user_beto', 'viewer');

    const viewer = await resolveBoardAccess('user_beto', 'caido');
    expect(viewer.trashedAt).toBeInstanceOf(Date);
    try {
      requireBoardView(viewer);
      throw new Error('debía lanzar');
    } catch (error) {
      expect(codeOf(error)).toBe('board_trashed');
    }
    // Con `allowTrashed` el llamador decide cómo informarlo.
    expect(requireBoardView(viewer, { allowTrashed: true }).board.id).toBe('caido');
    expect(canViewBoard(viewer)).toBe(true);

    // Un lector no puede restaurar: la gestión pide editor.
    expect(() => requireBoardEditor(viewer, { allowTrashed: true })).toThrow(/rol de editor/);
  });

  it('el dueño de un tablero en la papelera sigue siendo owner', async () => {
    db.addBoard('caido', { title: 'Caído', trashedAt: new Date() });
    const resolution = await resolveBoardAccess('user_ana', 'caido');
    expect(resolution.role).toBe('owner');
    expect(requireBoardAccess(resolution, 'owner', { allowTrashed: true }).role).toBe('owner');
  });
});

describe('resolveBoardAccessFrom (camino con el árbol ya cargado)', () => {
  it('coincide con resolveBoardAccess en toda la matriz', async () => {
    db.addMember('proyecto', 'user_beto', 'viewer');
    db.addMember('referencias', 'user_beto', 'editor');
    db.addMember('personal', 'user_dani', 'commenter');

    for (const userId of ['user_ana', 'user_beto', 'user_dani', 'user_zeta']) {
      const access = await loadBoardAccess(userId);
      for (const boardId of ['inicio', 'proyecto', 'referencias', 'personal', 'no-existe']) {
        const direct = await resolveBoardAccess(userId, boardId);
        const fromTree = resolveBoardAccessFrom(access, boardId);
        expect(fromTree.role).toBe(direct.role);
        expect(fromTree.exists).toBe(direct.exists);
        expect(fromTree.board?.id).toBe(direct.board?.id);
      }
    }
  });
});

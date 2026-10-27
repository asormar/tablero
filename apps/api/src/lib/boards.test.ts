/**
 * `loadBoardAccess`: carga acotada al árbol que alcanza al usuario.
 *
 * El doble de Prisma interpreta de verdad los `where` que usa la carga
 * (`OR`, `ownerId`, `members.some`, `parentBoardId.in`, `id.in`), así que estos
 * tests prueban qué filas se leen —no solo qué rol sale— y que la herencia y las
 * migas de pan siguen igual que con el árbol completo.
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

type Where = {
  OR?: Where[];
  ownerId?: string | { not: string };
  id?: { in: string[] };
  parentBoardId?: { in: string[] };
  members?: { some: { userId: string } };
};

const db = vi.hoisted(() => {
  const boards = new Map<string, Row>();
  const members: { boardId: string; userId: string; role: BoardRole }[] = [];
  /** Ids de las filas que devolvió cada consulta de tableros. */
  const reads: string[][] = [];
  let tick = 0;

  const matches = (row: Row, where: Where | undefined): boolean => {
    if (!where) return true;
    if (where.OR) return where.OR.some((clause) => matches(row, clause));
    if (typeof where.ownerId === 'string' && row.ownerId !== where.ownerId) return false;
    if (typeof where.ownerId === 'object' && row.ownerId === where.ownerId.not) return false;
    if (where.id && !where.id.in.includes(row.id)) return false;
    if (where.parentBoardId && !(row.parentBoardId !== null && where.parentBoardId.in.includes(row.parentBoardId))) {
      return false;
    }
    if (where.members) {
      const userId = where.members.some.userId;
      if (!members.some((member) => member.boardId === row.id && member.userId === userId)) return false;
    }
    return true;
  };

  const prisma = {
    board: {
      findMany: async ({ where }: { where?: Where } = {}) => {
        const rows = [...boards.values()].filter((row) => matches(row, where));
        reads.push(rows.map((row) => row.id));
        return rows.map((row) => ({ ...row }));
      },
    },
    boardMember: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        members.filter((member) => member.userId === where.userId).map(({ boardId, role }) => ({ boardId, role })),
    },
  };

  const addBoard = (id: string, options: Partial<Row> = {}): void => {
    tick += 1;
    const createdAt = new Date(1_700_000_000_000 + tick * 1000);
    boards.set(id, {
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
      createdAt,
      updatedAt: createdAt,
      ...options,
    });
  };

  const addMember = (boardId: string, userId: string, role: BoardRole): void => {
    members.push({ boardId, userId, role });
  };

  const reset = (): void => {
    boards.clear();
    members.length = 0;
    reads.length = 0;
    tick = 0;
  };

  return { prisma, reads, addBoard, addMember, reset };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

const { loadBoardAccess } = await import('./boards.js');

/** Todos los ids leídos de la base, en cualquier consulta. */
const readIds = (): Set<string> => new Set(db.reads.flat());

beforeEach(() => {
  db.reset();
  // ana
  // └── inicio
  //     ├── proyecto
  //     │   └── referencias
  //     └── personal
  db.addBoard('inicio');
  db.addBoard('proyecto', { parentBoardId: 'inicio' });
  db.addBoard('referencias', { parentBoardId: 'proyecto' });
  db.addBoard('personal', { parentBoardId: 'inicio' });
  // zeta, sin relación con nadie: su árbol no debe leerse para los demás.
  db.addBoard('zeta-inicio', { ownerId: 'user_zeta' });
  db.addBoard('zeta-notas', { ownerId: 'user_zeta', parentBoardId: 'zeta-inicio' });
  db.addBoard('zeta-secreto', { ownerId: 'user_zeta', parentBoardId: 'zeta-notas' });
});

describe('loadBoardAccess: alcance de la carga', () => {
  it('no lee los tableros de otro usuario sin relación', async () => {
    const access = await loadBoardAccess('user_ana');

    expect(access.boards.map((board) => board.id).sort()).toEqual(['inicio', 'personal', 'proyecto', 'referencias']);
    expect(access.get('zeta-inicio')).toBeUndefined();
    const read = readIds();
    for (const id of ['zeta-inicio', 'zeta-notas', 'zeta-secreto']) expect(read.has(id)).toBe(false);
    // Y el otro usuario tampoco arrastra el árbol de ana.
    db.reads.length = 0;
    const zeta = await loadBoardAccess('user_zeta');
    expect(zeta.boards.map((board) => board.id).sort()).toEqual(['zeta-inicio', 'zeta-notas', 'zeta-secreto']);
    expect(readIds().has('inicio')).toBe(false);
  });

  it('un usuario sin tableros ni membresías no lee ninguno', async () => {
    const access = await loadBoardAccess('user_nadie');
    expect(access.boards).toEqual([]);
    expect(readIds().size).toBe(0);
    expect(access.accessible()).toEqual([]);
  });

  it('los descendientes de un tablero compartido llegan por herencia y los hermanos no se leen', async () => {
    db.addMember('proyecto', 'user_beto', 'viewer');
    const access = await loadBoardAccess('user_beto');

    expect(access.roleOf('proyecto')).toBe('viewer');
    expect(access.roleOf('referencias')).toBe('viewer');
    expect(access.roleOf('personal')).toBeNull();
    expect(access.roleOf('inicio')).toBeNull();
    expect(access.roleOf('zeta-inicio')).toBeNull();
    expect(readIds().has('personal')).toBe(false);
    expect(readIds().has('zeta-secreto')).toBe(false);
  });

  it('la fila propia de un subtablero sobrescribe lo heredado', async () => {
    db.addMember('proyecto', 'user_caro', 'viewer');
    db.addMember('referencias', 'user_caro', 'editor');
    const access = await loadBoardAccess('user_caro');

    expect(access.roleOf('proyecto')).toBe('viewer');
    expect(access.roleOf('referencias')).toBe('editor');
    expect(access.canEdit('referencias')).toBe(true);
    expect(access.canEdit('proyecto')).toBe(false);
  });

  it('un tablero ajeno colgado de uno propio hereda edición (nunca propiedad) y se carga', async () => {
    db.addBoard('de-beto', { ownerId: 'user_beto', parentBoardId: 'inicio' });
    db.addBoard('movido', { parentBoardId: 'de-beto' }); // de ana, bajo un tablero de beto
    db.addBoard('movido-hijo', { parentBoardId: 'movido' });
    const access = await loadBoardAccess('user_beto');

    expect(access.roleOf('de-beto')).toBe('owner');
    expect(access.roleOf('movido')).toBe('editor');
    expect(access.roleOf('movido-hijo')).toBe('editor');
    // El padre de su tablero propio sigue sin darle rol…
    expect(access.roleOf('inicio')).toBeNull();
    // …pero se carga para resolver la miga de pan.
    expect(access.breadcrumbs('movido-hijo').map((crumb) => crumb.id)).toEqual([
      'inicio',
      'de-beto',
      'movido',
      'movido-hijo',
    ]);
  });

  it('carga los ancestros de un tablero compartido: migas de pan y papelera heredada', async () => {
    db.addMember('referencias', 'user_beto', 'editor');
    const access = await loadBoardAccess('user_beto');

    expect(access.breadcrumbs('referencias').map((crumb) => crumb.id)).toEqual(['inicio', 'proyecto', 'referencias']);
    // Los ancestros son contexto, no acceso.
    expect(access.roleOf('proyecto')).toBeNull();
    expect(access.accessible().map((board) => board.id)).toEqual(['referencias']);
    expect(access.children('proyecto').map((board) => board.id)).toEqual(['referencias']);
    expect(access.children('inicio')).toEqual([]);
  });

  it('trashedAncestorOf sigue viendo un ancestro en la papelera fuera del acceso del usuario', async () => {
    db.addBoard('caido', { parentBoardId: 'inicio', trashedAt: new Date() });
    db.addBoard('hijo-del-caido', { parentBoardId: 'caido' });
    db.addMember('hijo-del-caido', 'user_beto', 'editor');
    const access = await loadBoardAccess('user_beto');

    expect(access.trashedAncestorOf('hijo-del-caido')?.id).toBe('caido');
  });

  it('conserva el rootBoard y la bandeja del propio usuario y el orden por creación', async () => {
    db.addBoard('sin-ordenar', { parentBoardId: 'inicio', isUnsorted: true });
    const access = await loadBoardAccess('user_ana');

    expect(access.rootBoard()?.id).toBe('inicio');
    expect(access.unsortedBoard()?.id).toBe('sin-ordenar');
    expect(access.boards.map((board) => board.id)).toEqual([
      'inicio',
      'proyecto',
      'referencias',
      'personal',
      'sin-ordenar',
    ]);
  });

  it('las plantillas de otro dueño no se cargan salvo que el usuario sea miembro', async () => {
    db.addBoard('plantilla-sistema', { ownerId: 'user_system', isTemplate: true });
    db.addBoard('plantilla-hija', { ownerId: 'user_system', isTemplate: true, parentBoardId: 'plantilla-sistema' });

    const access = await loadBoardAccess('user_ana');
    expect(access.get('plantilla-sistema')).toBeUndefined();
    expect(access.roleOf('plantilla-sistema')).toBeNull();

    db.addMember('plantilla-sistema', 'user_ana', 'viewer');
    const shared = await loadBoardAccess('user_ana');
    expect(shared.roleOf('plantilla-hija')).toBe('viewer');
    expect(shared.accessible({ includeTemplates: true }).map((board) => board.id)).toContain('plantilla-hija');
  });

  it('el tablero compartido y su subárbol profundo se bajan por niveles en lotes', async () => {
    let parent = 'zeta-inicio';
    for (let depth = 0; depth < 8; depth += 1) {
      const id = `nivel-${depth}`;
      db.addBoard(id, { ownerId: 'user_zeta', parentBoardId: parent });
      parent = id;
    }
    db.addMember('nivel-0', 'user_beto', 'commenter');
    const access = await loadBoardAccess('user_beto');

    expect(access.roleOf('nivel-7')).toBe('commenter');
    expect(access.roleOf('zeta-inicio')).toBeNull();
    expect(access.get('zeta-inicio')).toBeDefined(); // ancestro de contexto
    expect(readIds().has('zeta-secreto')).toBe(false);
  });
});

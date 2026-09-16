import { describe, expect, it } from 'vitest';

import {
  ancestorIds,
  buildBreadcrumbPath,
  canComment,
  canEdit,
  canMoveBoard,
  canView,
  childrenOf,
  effectiveRole,
  roleAtLeast,
  slugify,
  subtreeIds,
  type BoardSummary,
} from './boards.js';

const board = (
  id: string,
  parentBoardId: string | null,
  extra: Partial<BoardSummary> = {},
): BoardSummary => ({
  id,
  ownerId: 'user_ana',
  parentBoardId,
  title: id,
  icon: null,
  color: null,
  coverImageId: null,
  isTemplate: false,
  publishedSlug: null,
  trashedAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const boards: BoardSummary[] = [
  board('root', null),
  board('proyecto', 'root'),
  board('referencias', 'proyecto'),
  board('personal', 'root'),
  board('borrado', 'root', { trashedAt: 123 }),
];

describe('buildBreadcrumbPath', () => {
  it('devuelve el camino completo de la raíz al tablero actual', () => {
    expect(buildBreadcrumbPath(boards, 'referencias').map((b) => b.id)).toEqual([
      'root',
      'proyecto',
      'referencias',
    ]);
  });

  it('devuelve solo el propio tablero si es raíz', () => {
    expect(buildBreadcrumbPath(boards, 'root').map((b) => b.id)).toEqual(['root']);
  });

  it('no entra en bucle con datos corruptos', () => {
    const cycle = [board('a', 'b'), board('b', 'a')];
    expect(buildBreadcrumbPath(cycle, 'a').map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('devuelve vacío para un id desconocido', () => {
    expect(buildBreadcrumbPath(boards, 'nope')).toEqual([]);
  });
});

describe('ancestorIds', () => {
  it('lista los ancestros del más cercano al raíz', () => {
    expect(ancestorIds(boards, 'referencias')).toEqual(['proyecto', 'root']);
  });
});

describe('childrenOf', () => {
  it('excluye los tableros en la papelera', () => {
    expect(childrenOf(boards, 'root').map((b) => b.id)).toEqual(['proyecto', 'personal']);
  });
});

describe('subtreeIds / canMoveBoard', () => {
  it('incluye todo el subárbol, también lo que está en la papelera', () => {
    expect([...subtreeIds(boards, 'root')].sort()).toEqual(
      ['borrado', 'personal', 'proyecto', 'referencias', 'root'].sort(),
    );
    expect(subtreeIds(boards, 'proyecto')).toEqual(['proyecto', 'referencias']);
  });

  it('impide mover un tablero dentro de su propio descendiente', () => {
    expect(canMoveBoard(boards, 'proyecto', 'referencias')).toBe(false);
    expect(canMoveBoard(boards, 'proyecto', 'personal')).toBe(true);
    expect(canMoveBoard(boards, 'proyecto', 'proyecto')).toBe(false);
  });

  it('rechaza mover a `null`: las raíces solo se crean en el registro', () => {
    expect(canMoveBoard(boards, 'proyecto', null)).toBe(false);
    expect(canMoveBoard(boards, 'referencias', null)).toBe(false);
  });
});

describe('permisos', () => {
  it('el propietario siempre es owner', () => {
    expect(effectiveRole(null, null, 'user_ana', 'user_ana')).toBe('owner');
  });

  it('hereda el rol del tablero padre cuando no hay concesión directa', () => {
    expect(effectiveRole(null, 'editor', 'user_ana', 'user_luis')).toBe('editor');
  });

  it('la concesión directa gana sobre la heredada', () => {
    expect(effectiveRole('viewer', 'editor', 'user_ana', 'user_luis')).toBe('viewer');
  });

  it('sin concesión no hay acceso', () => {
    expect(effectiveRole(null, null, 'user_ana', 'user_luis')).toBeNull();
    expect(canView(null)).toBe(false);
  });

  it('ordena los roles por capacidad', () => {
    expect(roleAtLeast('owner', 'editor')).toBe(true);
    expect(canEdit('editor')).toBe(true);
    expect(canEdit('commenter')).toBe(false);
    expect(canComment('commenter')).toBe(true);
    expect(canComment('viewer')).toBe(false);
    expect(canView('viewer')).toBe(true);
  });
});

describe('slugify', () => {
  it('quita acentos, espacios y mayúsculas', () => {
    expect(slugify('Referencias de Diseño Gráfico')).toBe('referencias-de-diseno-grafico');
    expect(slugify('  ¡Hola,  Mundo!  ')).toBe('hola-mundo');
  });

  it('limita la longitud', () => {
    expect(slugify('a'.repeat(80)).length).toBe(48);
  });
});

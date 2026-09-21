/**
 * Menú de usuario (fase 7): identidad visible y limpieza al cerrar sesión.
 *
 * Solo se prueba la lógica pura de `lib/userMenu.ts`; el componente y el botón
 * de la barra se verifican en el navegador.
 */

import type { BoardSummary } from '@tablero/shared';

import { describe, expect, it } from 'vitest';

import { LOCAL_USER, type AppUser } from '@/state/appStore';

import { boardsAfterSignOut, isSignedIn, userInitial, userLabel } from './userMenu';

const sessionUser: AppUser = { id: 'cm123', email: 'agente@ejemplo.com', name: 'Agente Visual' };

function board(id: string, ownerId: string): BoardSummary {
  return {
    id,
    ownerId,
    parentBoardId: null,
    title: id,
    icon: null,
    color: null,
    coverImageId: null,
    isTemplate: false,
    publishedSlug: null,
    trashedAt: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('identidad de la sesión', () => {
  it('distingue la sesión del servidor del modo local', () => {
    expect(isSignedIn(sessionUser)).toBe(true);
    expect(isSignedIn(LOCAL_USER)).toBe(false);
  });

  it('usa el nombre y, sin nombre, el email', () => {
    expect(userLabel(sessionUser)).toBe('Agente Visual');
    expect(userLabel({ ...sessionUser, name: '   ' })).toBe('agente@ejemplo.com');
    expect(userLabel({ ...sessionUser, name: '', email: '' })).toBe('Cuenta');
  });

  it('sin cuenta devuelve «Local»', () => {
    expect(userLabel(LOCAL_USER)).toBe('Local');
    expect(isSignedIn(LOCAL_USER)).toBe(false);
  });

  it('la inicial sale del nombre y aguanta emails raros y nombres vacíos', () => {
    expect(userInitial(sessionUser)).toBe('A');
    expect(userInitial({ ...sessionUser, name: '.ana.lopez' })).toBe('A');
    expect(userInitial({ ...sessionUser, name: 'ñandú' })).toBe('Ñ');
    expect(userInitial({ ...sessionUser, name: '', email: '  ' })).toBe('C');
    expect(userInitial(LOCAL_USER)).toBe('L');
  });
});

describe('catálogo tras cerrar sesión', () => {
  it('se queda con los tableros de este navegador', () => {
    const boards = [board('local-1', LOCAL_USER.id), board('remoto-1', sessionUser.id), board('compartido', 'otro-usuario')];
    expect(boardsAfterSignOut(boards).map((item) => item.id)).toEqual(['local-1']);
  });

  it('no cambia nada si todo es local, y aguanta la lista vacía', () => {
    const local = [board('a', LOCAL_USER.id), board('b', LOCAL_USER.id)];
    expect(boardsAfterSignOut(local)).toHaveLength(2);
    expect(boardsAfterSignOut([])).toEqual([]);
  });
});

/**
 * Tableros locales: identidad y rol.
 *
 * Un tablero creado en este navegador (`bd_…`) no existe en el servidor: quien
 * lo usa es su dueño. Sin `role: 'owner'` la matriz de capacidades de la
 * interfaz (rol `null` = desconocido) deja el lienzo en solo lectura aunque
 * no haya sesión que rechazar.
 */

import { describe, expect, it } from 'vitest';

import { LOCAL_USER, localBoard } from './appStore';

describe('localBoard', () => {
  it('un tablero creado en el navegador (bd_…) tiene rol dueño', () => {
    const board = localBoard('bd_abc123');
    expect(board.role).toBe('owner');
    expect(board.ownerId).toBe(LOCAL_USER.id);
  });

  it('un placeholder de tablero del servidor no presume rol', () => {
    expect(localBoard('cmi123', 'Tablero').role).toBeUndefined();
  });
});

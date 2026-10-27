/**
 * Pruebas de la animación de entrada de una sola vez.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ENTER_WINDOW_MS, markEnterPlayed, resetEnterAnimations, shouldPlayEnter } from './enterAnimation';

describe('shouldPlayEnter', () => {
  beforeEach(() => resetEnterAnimations());

  it('anima una tarjeta recién creada', () => {
    expect(shouldPlayEnter('a', 1000, 1100)).toBe(true);
  });

  it('no anima fuera de la ventana ni sin fecha de creación', () => {
    expect(shouldPlayEnter('a', 1000, 1000 + ENTER_WINDOW_MS)).toBe(false);
    expect(shouldPlayEnter('a', 0, 10)).toBe(false);
  });

  it('una vez reproducida, un remontaje dentro de la ventana no la repite', () => {
    expect(shouldPlayEnter('a', 1000, 1050)).toBe(true);
    markEnterPlayed('a');
    expect(shouldPlayEnter('a', 1000, 1100)).toBe(false);
    // otras tarjetas no se ven afectadas
    expect(shouldPlayEnter('b', 1000, 1100)).toBe(true);
  });

  it('acepta un conjunto de vistas inyectado', () => {
    expect(shouldPlayEnter('a', 1000, 1100, new Set(['a']))).toBe(false);
  });
});

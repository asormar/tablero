import { describe, expect, it } from 'vitest';

import { nextMenuIndex } from './menuNav';

describe('nextMenuIndex', () => {
  const all = [true, true, true, true];

  it('ArrowDown avanza y da la vuelta al final', () => {
    expect(nextMenuIndex(all, 0, 'ArrowDown')).toBe(1);
    expect(nextMenuIndex(all, 3, 'ArrowDown')).toBe(0);
  });

  it('ArrowUp retrocede y da la vuelta al principio', () => {
    expect(nextMenuIndex(all, 2, 'ArrowUp')).toBe(1);
    expect(nextMenuIndex(all, 0, 'ArrowUp')).toBe(3);
  });

  it('Home y End van a los extremos', () => {
    expect(nextMenuIndex(all, 2, 'Home')).toBe(0);
    expect(nextMenuIndex(all, 1, 'End')).toBe(3);
  });

  it('salta los elementos deshabilitados', () => {
    const enabled = [true, false, false, true];
    expect(nextMenuIndex(enabled, 0, 'ArrowDown')).toBe(3);
    expect(nextMenuIndex(enabled, 3, 'ArrowUp')).toBe(0);
    expect(nextMenuIndex([false, true, true, false], 0, 'Home')).toBe(1);
    expect(nextMenuIndex([false, true, true, false], 0, 'End')).toBe(2);
  });

  it('sin foco previo, las flechas entran por los extremos', () => {
    expect(nextMenuIndex(all, -1, 'ArrowDown')).toBe(0);
    expect(nextMenuIndex(all, -1, 'ArrowUp')).toBe(3);
  });

  it('devuelve -1 con otras teclas o sin elementos habilitados', () => {
    expect(nextMenuIndex(all, 0, 'a')).toBe(-1);
    expect(nextMenuIndex(all, 0, 'Enter')).toBe(-1);
    expect(nextMenuIndex([false, false], 0, 'ArrowDown')).toBe(-1);
    expect(nextMenuIndex([], -1, 'Home')).toBe(-1);
  });
});

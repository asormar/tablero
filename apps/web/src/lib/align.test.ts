/** Alineación y distribución de una selección (una sola transacción). */

import { describe, expect, it } from 'vitest';

import { alignmentMoves, availableAlignActions, canDistribute, selectionBounds } from './align';

const items = [
  { id: 'a', rect: { x: 0, y: 0, width: 100, height: 50 } },
  { id: 'b', rect: { x: 300, y: 20, width: 100, height: 50 } },
  { id: 'c', rect: { x: 700, y: 60, width: 100, height: 50 } },
];

describe('alignmentMoves', () => {
  it('alinear a la izquierda lleva todos a la x de la caja común', () => {
    const moves = alignmentMoves(items, 'left');
    expect(moves).toEqual([
      { id: 'b', x: 0, y: 20 },
      { id: 'c', x: 0, y: 60 },
    ]);
  });

  it('centrar horizontalmente reparte alrededor del centro', () => {
    const moves = alignmentMoves(items, 'center-x');
    const center = 400;
    for (const move of moves) {
      const item = items.find((entry) => entry.id === move.id);
      expect(item).toBeTruthy();
      expect(move.x).toBeCloseTo(center - 50);
    }
  });

  it('alinear abajo pega al borde inferior', () => {
    const moves = alignmentMoves(items, 'bottom');
    const bottom = 60 + 50;
    for (const move of moves) {
      expect(move.y).toBe(bottom - 50);
    }
  });

  it('distribuir horizontalmente reparte con huecos iguales', () => {
    const moves = alignmentMoves(items, 'distribute-x');
    const map = new Map(moves.map((move) => [move.id, move.x]));
    // a y c ya ocupan los extremos; b se recoloca en el medio.
    expect(map.has('a')).toBe(false);
    expect(map.get('b')).toBe(350);
    expect(map.has('c')).toBe(false);
  });

  it('sin movimientos si ya está alineado', () => {
    const aligned = [
      { id: 'a', rect: { x: 0, y: 0, width: 100, height: 50 } },
      { id: 'b', rect: { x: 0, y: 100, width: 100, height: 50 } },
    ];
    expect(alignmentMoves(aligned, 'left')).toEqual([]);
  });

  it('con menos de dos elementos no hace nada', () => {
    expect(alignmentMoves([items[0]!], 'left')).toEqual([]);
  });
});

describe('caja y acciones disponibles', () => {
  it('la caja común envuelve toda la selección', () => {
    expect(selectionBounds(items)).toEqual({ x: 0, y: 0, width: 800, height: 110 });
  });

  it('distribuir solo aparece con 3 o más elementos', () => {
    expect(canDistribute(items)).toBe(true);
    expect(canDistribute(items.slice(0, 2))).toBe(false);
    expect(availableAlignActions(2).some((option) => option.action === 'distribute-x')).toBe(false);
    expect(availableAlignActions(3).some((option) => option.action === 'distribute-x')).toBe(true);
  });
});

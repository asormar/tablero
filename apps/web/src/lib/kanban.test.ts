/**
 * Kanban: matemática de la lista de hijos de una columna.
 *
 * La posición la decide el puntero sobre las tarjetas ya colocadas (medidas en
 * el DOM), así que lo que hay que probar es que el índice salga bien en los
 * bordes y que reordenar/insertar no dupliquen ni pierdan ids.
 */

import { describe, expect, it } from 'vitest';

import { columnCountLabel, insertIds, insertionIndexFromPoint, insertionLineY, removeIds, reorderIds, sortedSlots } from './kanban';

const slots = [
  { id: 'a', top: 100, height: 40 },
  { id: 'b', top: 150, height: 40 },
  { id: 'c', top: 200, height: 40 },
];

describe('kanban · índice de inserción', () => {
  it('antes de la primera tarjeta', () => {
    expect(insertionIndexFromPoint(slots, 90)).toBe(0);
  });

  it('entre la primera y la segunda', () => {
    expect(insertionIndexFromPoint(slots, 130)).toBe(1);
  });

  it('después de la última', () => {
    expect(insertionIndexFromPoint(slots, 400)).toBe(3);
  });

  it('el punto medio de una tarjeta cuenta como «pasó»', () => {
    expect(insertionIndexFromPoint(slots, 121)).toBe(1);
    expect(insertionIndexFromPoint(slots, 119)).toBe(0);
  });

  it('sin tarjetas, siempre 0', () => {
    expect(insertionIndexFromPoint([], 500)).toBe(0);
  });

  it('ordena los huecos aunque lleguen desordenados', () => {
    const shuffled = [slots[2]!, slots[0]!, slots[1]!];
    expect(sortedSlots(shuffled).map((slot) => slot.id)).toEqual(['a', 'b', 'c']);
    expect(insertionIndexFromPoint(shuffled, 130)).toBe(1);
  });
});

describe('kanban · línea de inserción', () => {
  it('en el índice intermedio usa el borde de la tarjeta siguiente', () => {
    expect(insertionLineY(slots, 1, 0)).toBe(150);
  });

  it('al final usa el borde inferior de la última', () => {
    expect(insertionLineY(slots, 3, 0)).toBe(240);
  });

  it('en una columna vacía cae en el respaldo', () => {
    expect(insertionLineY([], 0, 42)).toBe(42);
  });
});

describe('kanban · orden de la lista', () => {
  it('reordena moviendo una tarjeta a otra posición', () => {
    expect(reorderIds(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(reorderIds(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
  });

  it('si ya está donde tiene que quedar, devuelve la misma lista', () => {
    const ids = ['a', 'b', 'c'];
    expect(reorderIds(ids, 'b', 1)).toBe(ids);
  });

  it('inserta varios ids en la posición pedida', () => {
    expect(insertIds(['a', 'b'], ['x', 'y'], 1)).toEqual(['a', 'x', 'y', 'b']);
  });

  it('insertar lo que ya estaba no lo duplica', () => {
    expect(insertIds(['a', 'b', 'c'], ['b'], 0)).toEqual(['b', 'a', 'c']);
  });

  it('quita ids sin tocar el orden del resto', () => {
    expect(removeIds(['a', 'b', 'c', 'd'], ['b', 'd'])).toEqual(['a', 'c']);
  });
});

describe('kanban · etiquetas', () => {
  it('cuenta en singular y plural', () => {
    expect(columnCountLabel(1)).toBe('1 elemento');
    expect(columnCountLabel(4)).toBe('4 elementos');
  });
});

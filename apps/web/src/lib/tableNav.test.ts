/**
 * Tabla: navegación por celdas, reordenar arrastrando y el pie de sumas.
 */

import { describe, expect, it } from 'vitest';

import { indexAtCoordinate, isNavigationKey, nextCell, sumLabel } from './tableNav';

describe('nextCell', () => {
  it('Tab avanza en la misma fila y salta a la siguiente', () => {
    expect(nextCell(3, 3, { row: 0, col: 1 }, 'Tab')).toEqual({ row: 0, col: 2 });
    expect(nextCell(3, 3, { row: 0, col: 2 }, 'Tab')).toEqual({ row: 1, col: 0 });
  });

  it('Shift+Tab retrocede', () => {
    expect(nextCell(3, 3, { row: 1, col: 0 }, 'Tab', { shift: true })).toEqual({ row: 0, col: 2 });
  });

  it('en el borde no hay celda', () => {
    expect(nextCell(2, 2, { row: 1, col: 1 }, 'Tab')).toBeNull();
    expect(nextCell(2, 2, { row: 0, col: 0 }, 'Tab', { shift: true })).toBeNull();
  });

  it('las flechas mueven en su eje y se detienen en el borde', () => {
    expect(nextCell(3, 3, { row: 1, col: 1 }, 'ArrowUp')).toEqual({ row: 0, col: 1 });
    expect(nextCell(3, 3, { row: 1, col: 1 }, 'ArrowDown')).toEqual({ row: 2, col: 1 });
    expect(nextCell(3, 3, { row: 1, col: 1 }, 'ArrowLeft')).toEqual({ row: 1, col: 0 });
    expect(nextCell(3, 3, { row: 1, col: 1 }, 'ArrowRight')).toEqual({ row: 1, col: 2 });
    expect(nextCell(3, 3, { row: 0, col: 0 }, 'ArrowUp')).toBeNull();
    expect(nextCell(3, 3, { row: 2, col: 2 }, 'ArrowRight')).toBeNull();
  });

  it('Enter baja una fila', () => {
    expect(nextCell(3, 3, { row: 0, col: 2 }, 'Enter')).toEqual({ row: 1, col: 2 });
  });

  it('otra tecla no mueve la selección', () => {
    expect(nextCell(3, 3, { row: 0, col: 0 }, 'a')).toBeNull();
  });
});

describe('isNavigationKey', () => {
  it('Tab, Enter y las verticales siempre navegan', () => {
    expect(isNavigationKey('Tab', false, false)).toBe(true);
    expect(isNavigationKey('Enter', false, false)).toBe(true);
    expect(isNavigationKey('ArrowUp', false, false)).toBe(true);
  });

  it('las horizontales solo en el borde del texto', () => {
    expect(isNavigationKey('ArrowLeft', true, false)).toBe(true);
    expect(isNavigationKey('ArrowLeft', false, false)).toBe(false);
    expect(isNavigationKey('ArrowRight', false, true)).toBe(true);
    expect(isNavigationKey('ArrowRight', false, false)).toBe(false);
  });
});

describe('indexAtCoordinate', () => {
  const spans = [
    { start: 0, size: 100 },
    { start: 100, size: 100 },
    { start: 200, size: 100 },
  ];

  it('cuenta los tramos cuya mitad quedó atrás', () => {
    expect(indexAtCoordinate(spans, 10)).toBe(0);
    expect(indexAtCoordinate(spans, 60)).toBe(1);
    expect(indexAtCoordinate(spans, 260)).toBe(3);
  });
});

describe('sumLabel', () => {
  it('sin valores no hay etiqueta', () => {
    expect(sumLabel(null)).toBe('');
  });

  it('formatea el total al estilo español (coma decimal)', () => {
    // El separador de miles depende de los datos de locale del entorno: lo que
    // importa es que el decimal use coma.
    expect(sumLabel(1234.5).replace(/ /g, ' ')).toContain('234,5');
    expect(sumLabel(3)).toBe('Σ 3');
  });
});

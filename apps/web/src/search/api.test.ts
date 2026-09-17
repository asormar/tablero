/**
 * Pruebas del cliente de búsqueda global (fase 4, punto 1): normalización de la
 * respuesta del servidor a grupos por tablero.
 */

import { describe, expect, it } from 'vitest';

import { groupHits, normalizeSearchPayload } from './api';

describe('groupHits', () => {
  it('agrupa por tablero conservando el orden de llegada', () => {
    const groups = groupHits([
      { boardId: 'b1', boardTitle: 'Uno', elementId: 'e1', elementType: 'note', snippet: 'a' },
      { boardId: 'b2', boardTitle: 'Dos', elementId: 'e2', elementType: 'note', snippet: 'b' },
      { boardId: 'b1', boardTitle: 'Uno', elementId: 'e3', elementType: 'note', snippet: 'c' },
    ]);
    expect(groups.map((group) => group.boardId)).toEqual(['b1', 'b2']);
    expect(groups[0]?.hits.map((hit) => hit.elementId)).toEqual(['e1', 'e3']);
  });

  it('completa el título del grupo si llegó vacío en la primera coincidencia', () => {
    const groups = groupHits([
      { boardId: 'b1', boardTitle: '', elementId: 'e1', elementType: 'note', snippet: '' },
      { boardId: 'b1', boardTitle: 'Uno', elementId: 'e2', elementType: 'note', snippet: '' },
    ]);
    expect(groups[0]?.boardTitle).toBe('Uno');
  });
});

describe('normalizeSearchPayload', () => {
  it('acepta un array pelado de coincidencias', () => {
    const groups = normalizeSearchPayload([
      { boardId: 'b1', boardTitle: 'Uno', elementId: 'e1', elementType: 'note', snippet: 'hola' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.hits[0]?.elementId).toBe('e1');
  });

  it('acepta { results }', () => {
    const groups = normalizeSearchPayload({
      results: [{ boardId: 'b1', boardTitle: 'Uno', elementId: 'e1', elementType: 'note', snippet: '' }],
    });
    expect(groups[0]?.hits).toHaveLength(1);
  });

  it('acepta { groups } con hits anidados y completa el tablero', () => {
    const groups = normalizeSearchPayload({
      groups: [
        {
          boardId: 'b9',
          boardTitle: 'Proyecto',
          hits: [{ id: 'e5', elementType: 'todo', snippet: 'comprar pan', x: 10, y: 20 }],
        },
      ],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.boardId).toBe('b9');
    expect(groups[0]?.hits[0]?.elementId).toBe('e5');
    expect(groups[0]?.hits[0]?.x).toBe(10);
    expect(groups[0]?.hits[0]?.y).toBe(20);
  });

  it('descarta grupos sin coincidencias y filas inválidas', () => {
    const groups = normalizeSearchPayload({
      groups: [{ boardId: 'b1', hits: [] }, { hits: [{ elementId: 'e1' }] }, { boardId: 'b2', hits: [null, 3] }],
    });
    expect(groups).toEqual([]);
  });

  it('devuelve vacío con formas inesperadas', () => {
    expect(normalizeSearchPayload(null)).toEqual([]);
    expect(normalizeSearchPayload('texto')).toEqual([]);
    expect(normalizeSearchPayload({})).toEqual([]);
  });

  it('completa el tipo por defecto cuando falta', () => {
    const groups = normalizeSearchPayload([
      { boardId: 'b1', elementId: 'e1', snippet: 'algo' },
    ]);
    expect(groups[0]?.hits[0]?.elementType).toBe('note');
  });
});

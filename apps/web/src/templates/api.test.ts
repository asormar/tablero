/**
 * Pruebas de la galería de plantillas (fase 4, punto 2): normalización de la
 * respuesta y categorías.
 */

import { describe, expect, it } from 'vitest';

import { normalizeTemplates, templateCategories } from './api';

describe('normalizeTemplates', () => {
  it('acepta { templates }', () => {
    const templates = normalizeTemplates({
      templates: [{ id: 't1', name: 'Moodboard', description: 'Tablero visual', category: 'moodboard', ownerId: null }],
    });
    expect(templates).toEqual([
      { id: 't1', name: 'Moodboard', description: 'Tablero visual', category: 'moodboard', system: true },
    ]);
  });

  it('acepta un array pelado y marca las de usuario', () => {
    const templates = normalizeTemplates([{ id: 't2', title: 'Mía', ownerId: 'u1' }]);
    expect(templates[0]?.name).toBe('Mía');
    expect(templates[0]?.system).toBe(false);
    expect(templates[0]?.category).toBe('otros');
    expect(templates[0]?.description).toBe('');
  });

  it('descarta filas sin id y formas inesperadas', () => {
    expect(normalizeTemplates({ templates: [{ name: 'sin id' }, null] })).toEqual([]);
    expect(normalizeTemplates('hola')).toEqual([]);
    expect(normalizeTemplates(null)).toEqual([]);
  });
});

describe('templateCategories', () => {
  it('devuelve las categorías únicas y ordenadas', () => {
    const categories = templateCategories([
      { id: 't1', name: 'A', description: '', category: 'planificacion', system: true },
      { id: 't2', name: 'B', description: '', category: 'escritura', system: true },
      { id: 't3', name: 'C', description: '', category: 'planificacion', system: true },
    ]);
    expect(categories).toEqual(['escritura', 'planificacion']);
  });

  it('sin plantillas no hay categorías', () => {
    expect(templateCategories([])).toEqual([]);
  });
});

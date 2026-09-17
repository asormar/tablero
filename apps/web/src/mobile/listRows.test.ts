/**
 * Pruebas de la vista de lista (fase 4, punto 8).
 */

import { describe, expect, it } from 'vitest';

import type { CanvasElement } from '@tablero/shared';

import { type ListRow, buildListRows, listSummary } from './listRows';

function element(id: string, type: CanvasElement['type'], extra: Partial<CanvasElement> = {}): CanvasElement {
  return { id, type, x: 0, y: 0, width: 200, createdBy: 't', createdAt: 1, updatedAt: 1, ...extra } as CanvasElement;
}

const labelOf = (type: string): string => `[${type}]`;

describe('buildListRows', () => {
  it('usa el texto de la tarjeta como texto principal y el resto como secundario', () => {
    const rows = buildListRows([element('a', 'note')], () => 'Primera línea\nSegunda línea', labelOf);
    expect(rows[0]?.primary).toBe('Primera línea');
    expect(rows[0]?.secondary).toContain('Segunda línea');
    expect(rows[0]?.depth).toBe(0);
  });

  it('cae al nombre del tipo cuando no hay texto', () => {
    const rows = buildListRows([element('a', 'image')], () => '', labelOf);
    expect(rows[0]?.primary).toBe('[image]');
  });

  it('indenta los hijos de una columna y los deja justo debajo', () => {
    const rows = buildListRows(
      [
        element('col', 'column', { title: 'Por hacer' } as never),
        element('hijo', 'note', { parentId: 'col' }),
        element('suelta', 'note'),
      ],
      (item) => (item.id === 'hijo' ? 'Hija' : 'Suelta'),
      labelOf,
    );
    expect(rows.map((row) => row.id)).toEqual(['col', 'hijo', 'suelta']);
    expect(rows[0]?.depth).toBe(0);
    expect(rows[1]?.depth).toBe(1);
  });

  it('cuenta el progreso de una lista de tareas, con anidadas', () => {
    const todo = element('t', 'todo', {
      title: 'Semana',
      items: [
        { id: '1', text: 'Uno', checked: true, children: [{ id: '2', text: 'Dos', checked: false, children: [] }] },
        { id: '3', text: 'Tres', checked: false, children: [] },
      ],
    } as never);
    const rows = buildListRows([todo], () => '', labelOf);
    expect(rows[0]?.progress).toEqual({ done: 1, total: 3 });
    expect(rows[0]?.secondary).toBe('1/3');
  });

  it('el título de la tarea manda sobre el texto', () => {
    const todo = element('t', 'todo', { title: 'Entrega' } as never);
    const rows = buildListRows([todo], () => 'otro texto', labelOf);
    expect(rows[0]?.primary).toBe('Entrega');
  });

  it('las muestras muestran nombre y hex', () => {
    const rows = buildListRows([element('s', 'swatch', { hex: '#2F6FC9', name: 'Azul' } as never)], () => '', labelOf);
    expect(rows[0]?.primary).toBe('Azul');
    expect(rows[0]?.secondary).toBe('#2F6FC9');
  });

  it('las imágenes muestran el pie de foto', () => {
    const rows = buildListRows([element('i', 'image', { caption: 'Playa' } as never)], () => '', labelOf);
    expect(rows[0]?.primary).toBe('Playa');
  });

  it('las migas de los enlaces caen a la URL', () => {
    const rows = buildListRows([element('l', 'link', { url: 'https://ejemplo.com' } as never)], () => '', labelOf);
    expect(rows[0]?.primary).toBe('https://ejemplo.com');
    expect(rows[0]?.secondary).toBe('https://ejemplo.com');
  });

  it('no lista anotaciones', () => {
    const rows = buildListRows([element('p', 'comment-pin')], () => 'nota', labelOf);
    expect(rows).toEqual([]);
  });

  it('recorta los textos largos', () => {
    const rows = buildListRows([element('a', 'note')], () => 'x'.repeat(400), labelOf);
    expect(rows[0]!.primary.length).toBeLessThanOrEqual(140);
    expect(rows[0]!.primary.endsWith('…')).toBe(true);
  });
});

describe('listSummary', () => {
  it('suma tarjetas y tareas', () => {
    const rows: ListRow[] = [
      { id: 'a', type: 'note', primary: 'A', secondary: '', depth: 0, progress: null },
      { id: 'b', type: 'todo', primary: 'B', secondary: '', depth: 0, progress: { done: 2, total: 5 } },
      { id: 'c', type: 'todo', primary: 'C', secondary: '', depth: 1, progress: { done: 1, total: 1 } },
    ];
    expect(listSummary(rows)).toEqual({ cards: 3, todos: 6, done: 3 });
  });

  it('sin filas devuelve ceros', () => {
    expect(listSummary([])).toEqual({ cards: 0, todos: 0, done: 0 });
  });
});

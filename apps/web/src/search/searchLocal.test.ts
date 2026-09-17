/**
 * Pruebas de la búsqueda dentro del tablero (fase 4, punto 1).
 *
 * Los casos cubren el extractor de texto por tipo de tarjeta y la búsqueda sobre
 * una lista de tarjetas ordenada (lo que hace `BoardSearchBar`).
 */

import { describe, expect, it } from 'vitest';

import type { CanvasElement } from '@tablero/shared';

import { type SearchableCard, elementPlainText, searchCards } from './searchLocal';

function element(partial: Partial<CanvasElement> & { id: string; type: CanvasElement['type'] }): CanvasElement {
  return {
    x: 0,
    y: 0,
    width: 200,
    createdBy: 'test',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  } as CanvasElement;
}

function block(text: string) {
  return { runs: [{ text }] };
}

describe('elementPlainText', () => {
  it('usa los bloques de texto para notas, documentos y encabezados', () => {
    const note = element({ id: 'n1', type: 'note' });
    expect(elementPlainText(note, [block('Hola'), block('mundo')] as never)).toBe('Hola\nmundo');
  });

  it('suma título e ítems (con anidados) en las tareas', () => {
    const todo = element({
      id: 't1',
      type: 'todo',
      title: 'Semana',
      items: [
        { id: 'i1', text: 'Comprar', checked: false, children: [{ id: 'i2', text: 'Pan', checked: false, children: [] }] },
      ],
    } as never);
    const text = elementPlainText(todo);
    expect(text).toContain('Semana');
    expect(text).toContain('Comprar');
    expect(text).toContain('Pan');
  });

  it('indexa enlaces con título, descripción y URL', () => {
    const link = element({
      id: 'l1',
      type: 'link',
      url: 'https://ejemplo.com',
      preview: { url: 'x', title: 'Ejemplo', description: 'Una descripción', imageUrl: null, faviconUrl: null, siteName: null, embedType: 'generic', fetchedAt: 0 },
    } as never);
    const text = elementPlainText(link);
    expect(text).toContain('Ejemplo');
    expect(text).toContain('Una descripción');
    expect(text).toContain('https://ejemplo.com');
  });

  it('indexa el nombre del archivo cuando se lo pasan los extras', () => {
    const file = element({ id: 'f1', type: 'file', assetId: 'a1', caption: 'Presupuesto' } as never);
    expect(elementPlainText(file, [], { assetName: 'planilla.xlsx' })).toBe('Presupuesto\nplanilla.xlsx');
  });

  it('indexa el pie de imagen aunque no haya nombre de archivo', () => {
    const image = element({ id: 'i1', type: 'image', assetId: 'a1', caption: 'Playa' } as never);
    expect(elementPlainText(image)).toBe('Playa');
  });

  it('indexa el nombre y el hex de una muestra', () => {
    const swatch = element({ id: 's1', type: 'swatch', hex: '#2F6FC9', name: 'Azul' } as never);
    expect(elementPlainText(swatch)).toBe('Azul\n#2F6FC9');
  });

  it('indexa encabezados de columna y celdas de tabla', () => {
    const table = element({
      id: 'tb1',
      type: 'table',
      table: {
        hasHeader: true,
        columns: [
          { id: 'c1', title: 'Tarea', width: 100, type: 'text' },
          { id: 'c2', title: 'Horas', width: 80, type: 'number' },
        ],
        rows: [
          { id: 'r1', cells: { c1: { value: 'Diseño' }, c2: { value: '4' } } },
        ],
      },
    } as never);
    const text = elementPlainText(table);
    expect(text).toContain('Tarea');
    expect(text).toContain('Diseño');
    expect(text).toContain('4');
  });

  it('indexa las etiquetas de los marcadores de un mapa', () => {
    const map = element({
      id: 'm1',
      type: 'map',
      map: { lat: 0, lng: 0, zoom: 3, markers: [{ id: 'k1', lat: 1, lng: 1, label: 'Buenos Aires' }] },
    } as never);
    expect(elementPlainText(map)).toBe('Buenos Aires');
  });

  it('no indexa dibujos', () => {
    const sketch = element({ id: 'sk1', type: 'sketch', strokes: [] } as never);
    expect(elementPlainText(sketch)).toBe('');
  });
});

describe('searchCards', () => {
  const cards: SearchableCard[] = [
    { id: 'a', type: 'note', element: element({ id: 'a', type: 'note' }), blocks: [block('Lista de compras')] as never },
    { id: 'b', type: 'note', element: element({ id: 'b', type: 'note' }), blocks: [block('Ideas sueltas')] as never },
    { id: 'c', type: 'column', element: element({ id: 'c', type: 'column', title: 'Compras del mes' } as never), blocks: [] },
    { id: 'd', type: 'note', element: null, blocks: [] },
  ];

  it('devuelve una coincidencia por tarjeta, en el orden recibido', () => {
    const hits = searchCards(cards, 'compras');
    expect(hits.map((hit) => hit.elementId)).toEqual(['a', 'c']);
  });

  it('no distingue mayúsculas y devuelve el fragmento con los términos', () => {
    const hits = searchCards(cards, 'IDEAS');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.elementType).toBe('note');
    expect(hits[0]?.terms).toEqual(['ideas']);
    expect(hits[0]?.snippet).toContain('Ideas');
  });

  it('con consulta vacía no devuelve nada', () => {
    expect(searchCards(cards, '   ')).toEqual([]);
  });

  it('respeta el límite de resultados', () => {
    expect(searchCards(cards, 'compras', 1)).toHaveLength(1);
  });

  it('ignora las tarjetas sin elemento', () => {
    expect(searchCards(cards, 'zzz')).toEqual([]);
  });
});

/**
 * Pruebas del render a PNG (fase 4, punto 3): la parte pura es el texto que se
 * dibuja dentro de cada tarjeta.
 */

import { describe, expect, it } from 'vitest';

import type { CanvasElement } from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';

import { cardText, exportBoxFor } from './exportPng';

const session = {
  getTextBlocks: () => [],
} as unknown as BoardSession;

function element(partial: Partial<CanvasElement> & { id: string; type: CanvasElement['type'] }): CanvasElement {
  return { x: 0, y: 0, width: 200, createdBy: 't', createdAt: 1, updatedAt: 1, ...partial } as CanvasElement;
}

describe('cardText', () => {
  it('las listas de tareas muestran título, casillas y anidados', () => {
    const todo = element({
      id: 't',
      type: 'todo',
      title: 'Semana',
      items: [
        { id: '1', text: 'Uno', checked: true, children: [{ id: '2', text: 'Dos', checked: false, children: [] }] },
      ],
    } as never);
    expect(cardText(todo, session)).toBe('Semana\n☑ Uno\n  ☐ Dos');
  });

  it('las tablas se aplanan fila por fila', () => {
    const table = element({
      id: 'tb',
      type: 'table',
      table: {
        hasHeader: true,
        columns: [
          { id: 'c1', title: 'Tarea', width: 100, type: 'text' },
          { id: 'c2', title: 'Horas', width: 60, type: 'number' },
        ],
        rows: [{ id: 'r1', cells: { c1: { value: 'Diseño' }, c2: { value: '4' } } }],
      },
    } as never);
    expect(cardText(table, session)).toBe('Tarea · Horas\nDiseño · 4');
  });

  it('los enlaces usan el título de la vista previa', () => {
    const link = element({
      id: 'l',
      type: 'link',
      url: 'https://ejemplo.com',
      preview: { url: 'x', title: 'Ejemplo', description: null, imageUrl: null, faviconUrl: null, siteName: null, embedType: 'generic', fetchedAt: 0 },
    } as never);
    expect(cardText(link, session)).toBe('Ejemplo');
  });

  it('los mapas listan sus marcadores', () => {
    const map = element({
      id: 'm',
      type: 'map',
      map: { lat: 0, lng: 0, zoom: 3, markers: [{ id: 'k1', lat: 1, lng: 1, label: 'Lima' }] },
    } as never);
    expect(cardText(map, session)).toBe('Lima');
  });

  it('las imágenes sin pie no dibujan texto', () => {
    const image = element({ id: 'i', type: 'image', assetId: 'a1' } as never);
    expect(cardText(image, session)).toBe('');
  });
});

describe('exportBoxFor', () => {
  it('suma el relleno y conserva la escala', () => {
    expect(exportBoxFor({ x: 0, y: 0, width: 100, height: 50 }, 10, 2)).toEqual({
      x: -10,
      y: -10,
      width: 120,
      height: 70,
      scale: 2,
    });
  });
});

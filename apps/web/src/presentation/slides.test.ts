/**
 * Pruebas del modo presentación (fase 4, punto 9): armado del mazo y encuadre.
 */

import { describe, expect, it } from 'vitest';

import type { BoardSummary, CanvasElement } from '@tablero/shared';

import { boardDeck, slideBounds, slideKey, stepIndex, unionRects, zoneDeck } from './slides';

function element(id: string, type: CanvasElement['type'], x = 0, y = 0, extra: Partial<CanvasElement> = {}): CanvasElement {
  return { id, type, x, y, width: 200, createdBy: 't', createdAt: 1, updatedAt: 1, ...extra } as CanvasElement;
}

function board(id: string, parentBoardId: string | null, title = id, trashedAt: number | null = null): BoardSummary {
  return {
    id,
    ownerId: 'u1',
    parentBoardId,
    title,
    icon: null,
    color: null,
    coverImageId: null,
    isTemplate: false,
    publishedSlug: null,
    trashedAt,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('zoneDeck', () => {
  it('una diapositiva por tarjeta de primer nivel, en el orden recibido', () => {
    const deck = zoneDeck([element('a', 'note'), element('b', 'image', 0, 400)]);
    expect(deck.map((slide) => slide.elementId)).toEqual(['a', 'b']);
    expect(deck[1]?.rect.y).toBe(400);
  });

  it('deja afuera los hijos de columnas, las anotaciones y las líneas', () => {
    const deck = zoneDeck([
      element('col', 'column'),
      element('hijo', 'note', 0, 0, { parentId: 'col' }),
      element('pin', 'comment-pin'),
    ]);
    expect(deck.map((slide) => slide.elementId)).toEqual(['col']);
  });
});

describe('boardDeck', () => {
  it('empieza por el tablero abierto y sigue con sus descendientes en anchura', () => {
    const boards = [
      board('root', null, 'Raíz'),
      board('hijo1', 'root', 'Hijo 1'),
      board('hijo2', 'root', 'Hijo 2'),
      board('nieto', 'hijo1', 'Nieto'),
      board('otro', null, 'Otro'),
    ];
    const deck = boardDeck('root', boards);
    expect(deck.map((slide) => slide.boardId)).toEqual(['root', 'hijo1', 'hijo2', 'nieto']);
  });

  it('no repite tableros ni entra en ciclos', () => {
    const boards = [board('a', 'b'), board('b', 'a')];
    expect(boardDeck('a', boards).map((slide) => slide.boardId)).toEqual(['a', 'b']);
  });

  it('saltea los tableros en papelera', () => {
    const boards = [board('root', null), board('borrado', 'root', 'Borrado', Date.now())];
    expect(boardDeck('root', boards).map((slide) => slide.boardId)).toEqual(['root']);
  });

  it('sin descendientes queda solo el tablero abierto', () => {
    expect(boardDeck('solo', []).map((slide) => slide.boardId)).toEqual(['solo']);
  });
});

describe('slideBounds', () => {
  it('agrega el margen alrededor de la tarjeta', () => {
    const bounds = slideBounds({ kind: 'zone', elementId: 'a', type: 'note', rect: { x: 100, y: 100, width: 200, height: 100 } }, 0.1);
    expect(bounds).toEqual({ x: 80, y: 90, width: 240, height: 120 });
  });

  it('nunca devuelve lados nulos', () => {
    const bounds = slideBounds({ kind: 'zone', elementId: 'a', type: 'note', rect: { x: 0, y: 0, width: 0, height: 0 } });
    expect(bounds.width).toBeGreaterThanOrEqual(1);
    expect(bounds.height).toBeGreaterThanOrEqual(1);
  });
});

describe('unionRects', () => {
  it('une varios rectángulos', () => {
    expect(
      unionRects([
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 50, y: 200, width: 100, height: 50 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 150, height: 250 });
  });

  it('sin rectángulos devuelve null', () => {
    expect(unionRects([])).toBeNull();
  });
});

describe('slideKey / stepIndex', () => {
  it('identifica diapositivas de zona y de tablero', () => {
    expect(slideKey({ kind: 'zone', elementId: 'e1', type: 'note', rect: { x: 0, y: 0, width: 1, height: 1 } })).toBe('zone:e1');
    expect(slideKey({ kind: 'board', boardId: 'b1', title: '' })).toBe('board:b1');
  });

  it('avanza en círculo', () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
  });

  it('con el mazo vacío se queda en cero', () => {
    expect(stepIndex(4, 0, 1)).toBe(0);
  });
});

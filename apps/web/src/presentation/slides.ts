/**
 * Modo presentación — partes puras (punto 9 de la fase 4).
 *
 * Dos recorridos:
 *  - **Zonas**: una diapositiva por tarjeta de primer nivel, en orden de
 *    lectura. Es el recorrido por defecto.
 *  - **Tableros**: la portada del tablero abierto y sus subtableros (según el
 *    registro de tableros), para presentar un proyecto entero.
 *
 * Acá se arma el mazo y se calcula el encuadre de cada diapositiva; el
 * componente solo mueve la cámara.
 */

import { type CanvasElement, type ElementType, type Rect, boundsOf, elementRect } from '@tablero/shared';

import type { BoardSummary } from '@tablero/shared';

export type PresentationMode = 'zones' | 'boards';

export type ZoneSlide = {
  kind: 'zone';
  /** Id de la tarjeta que se presenta. */
  elementId: string;
  type: ElementType;
  /** Rectángulo de mundo que hay que encuadrar. */
  rect: Rect;
};

export type BoardSlide = {
  kind: 'board';
  boardId: string;
  title: string;
};

export type Slide = ZoneSlide | BoardSlide;

/** Tipos que nunca son diapositiva (anotaciones y trazos). */
const SKIPPED_TYPES: ElementType[] = ['comment-pin', 'line'];

/**
 * Mazo del recorrido por zonas: tarjetas de primer nivel (las de las columnas
 * se ven dentro de su columna) sin anotaciones ni líneas.
 */
export function zoneDeck(elements: CanvasElement[]): ZoneSlide[] {
  const slides: ZoneSlide[] = [];
  for (const element of elements) {
    if (element.parentId) continue;
    if (SKIPPED_TYPES.includes(element.type)) continue;
    slides.push({ kind: 'zone', elementId: element.id, type: element.type, rect: elementRect(element) });
  }
  return slides;
}

/**
 * Mazo del recorrido por tableros: el tablero abierto y sus descendientes, en
 * anchura (los subtableros primero, en el orden del registro).
 */
export function boardDeck(currentBoardId: string, boards: BoardSummary[]): BoardSlide[] {
  const byId = new Map(boards.map((board) => [board.id, board]));
  const current = byId.get(currentBoardId);
  const slides: BoardSlide[] = [
    { kind: 'board', boardId: currentBoardId, title: current?.title ?? '' },
  ];
  const seen = new Set<string>([currentBoardId]);
  const queue: string[] = [currentBoardId];
  while (queue.length > 0) {
    const parent = queue.shift();
    if (!parent) break;
    for (const board of boards) {
      if (board.parentBoardId !== parent) continue;
      if (board.trashedAt !== null && board.trashedAt !== undefined) continue;
      if (seen.has(board.id)) continue;
      seen.add(board.id);
      queue.push(board.id);
      slides.push({ kind: 'board', boardId: board.id, title: board.title });
    }
  }
  return slides;
}

/** Unión de rectángulos (para encuadrar un grupo). */
export function unionRects(rects: Rect[]): Rect | null {
  return boundsOf(rects);
}

/** Rectángulo a encuadrar para una diapositiva de zona, con margen. */
export function slideBounds(slide: ZoneSlide, padding = 0.18): Rect {
  const padX = slide.rect.width * padding;
  const padY = slide.rect.height * padding;
  return {
    x: slide.rect.x - padX,
    y: slide.rect.y - padY,
    width: Math.max(1, slide.rect.width + padX * 2),
    height: Math.max(1, slide.rect.height + padY * 2),
  };
}

/** Descripción de la diapositiva para el HUD («3 / 12 · Nota»). */
export function slideKey(slide: Slide): string {
  return slide.kind === 'zone' ? `zone:${slide.elementId}` : `board:${slide.boardId}`;
}

/** Avance circular por el mazo. */
export function stepIndex(index: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return 0;
  return (index + direction + total) % total;
}

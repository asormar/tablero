/**
 * Búsqueda dentro del tablero actual (Ctrl/Cmd+F, punto 1 de la fase 4).
 *
 * Es del lado del cliente a propósito: el documento ya está en memoria, así que
 * no hace falta ir al servidor por cada tecla. Extrae el texto de cada tarjeta
 * (bloques de texto enriquecido + campos JSON) y devuelve coincidencias en orden
 * de lectura con su fragmento.
 *
 * Las funciones puras viven acá para poder probarlas sin DOM ni Yjs.
 */

import type { CanvasElement, ElementType } from '@tablero/shared';

import type { TextBlock } from '@/lib/textBlocks';

import { snippetAround, tokenizeQuery } from './highlight';

export type LocalHit = {
  elementId: string;
  elementType: ElementType;
  /** Texto plano de la tarjeta, ya recortado alrededor de la coincidencia. */
  snippet: string;
  /** Términos con los que se resaltó. */
  terms: string[];
};

/** Datos que la búsqueda necesita conocer de una tarjeta. */
export type SearchExtras = {
  /** Nombre del archivo, si la tarjeta es de tipo archivo. */
  assetName?: string | null;
  /** Título del tablero enlazado, si la tarjeta apunta a otro tablero. */
  boardTitle?: string | null;
};

function blocksText(blocks: TextBlock[]): string {
  return blocks
    .map((block) =>
      block.runs
        .map((run) => run.text)
        .join('')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Texto indexable de una tarjeta: el mismo criterio que usa el índice del
 * servidor (notas, documentos, encabezados y tareas → texto enriquecido; el
 * resto → campos JSON).
 */
export function elementPlainText(
  element: CanvasElement,
  blocks: TextBlock[] = [],
  extras: SearchExtras = {},
): string {
  const parts: string[] = [];
  switch (element.type) {
    case 'note':
    case 'document':
    case 'heading':
      parts.push(blocksText(blocks));
      break;
    case 'todo': {
      parts.push(blocksText(blocks));
      if (element.title) parts.push(element.title);
      const items = element.items ?? [];
      const walk = (list: typeof items): void => {
        for (const item of list) {
          parts.push(item.text);
          if (item.children.length > 0) walk(item.children);
        }
      };
      walk(items);
      break;
    }
    case 'board':
      if (extras.boardTitle) parts.push(extras.boardTitle);
      break;
    case 'column':
      parts.push(element.title);
      break;
    case 'image':
    case 'file':
    case 'video':
    case 'audio':
      if (element.caption) parts.push(element.caption);
      if (extras.assetName) parts.push(extras.assetName);
      break;
    case 'link':
      if (element.preview?.title) parts.push(element.preview.title);
      if (element.preview?.description) parts.push(element.preview.description);
      parts.push(element.url);
      break;
    case 'swatch':
      if (element.name) parts.push(element.name);
      parts.push(element.hex);
      break;
    case 'table': {
      const table = element.table;
      for (const column of table.columns) parts.push(column.title);
      for (const row of table.rows) {
        for (const column of table.columns) {
          const cell = row.cells[column.id];
          if (cell?.value) parts.push(cell.value);
        }
      }
      break;
    }
    case 'map':
      for (const marker of element.map.markers) parts.push(marker.label);
      break;
    // Los dibujos y las líneas no tienen texto indexable (las líneas ni
    // siquiera son `CanvasElement`).
    case 'sketch':
      break;
  }
  return parts.filter((part) => part.length > 0).join('\n');
}

export type SearchableCard = {
  id: string;
  type: ElementType;
  element: CanvasElement | null;
  blocks: TextBlock[];
  extras?: SearchExtras;
};

/**
 * Busca en las tarjetas dadas y devuelve solo las que coinciden, en el orden
 * recibido (orden de lectura del tablero). Las coincidencias en el mismo tipo de
 * tarjeta se agrupan por elemento: un resultado por tarjeta.
 */
export function searchCards(cards: SearchableCard[], query: string, limit = 200): LocalHit[] {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return [];
  const hits: LocalHit[] = [];
  for (const card of cards) {
    if (!card.element) continue;
    const text = elementPlainText(card.element, card.blocks, card.extras);
    if (text.length === 0) continue;
    const haystack = text.toLowerCase();
    const matches = terms.some((term) => haystack.includes(term));
    if (!matches) continue;
    hits.push({
      elementId: card.id,
      elementType: card.type,
      snippet: snippetAround(text, terms),
      terms,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * Generador de notas de prueba para medir rendimiento (300 notas).
 *
 * Se ejecuta en una única transacción, así que deshacerlo es un solo paso.
 */

import * as Y from 'yjs';

import {
  DEFAULT_SIZES,
  type Point,
  addElement,
  ensureTextFragment,
  getOrderedElements,
  localOrigin,
  snapPointToGrid,
} from '@tablero/shared';

import { writePlainText } from './xmlFragment';

export const PERF_NOTE_COUNT = 300;

const WORDS = [
  'idea',
  'borrador',
  'pendiente',
  'revisar',
  'referencia',
  'viaje',
  'receta',
  'proyecto',
  'nota rápida',
  'cita',
  'presupuesto',
  'recordatorio',
  'lista',
  'maqueta',
  'guion',
  'reunión',
  'lectura',
  'código',
  'diseño',
  'música',
];

export type SeedOptions = {
  count?: number;
  /** Columnas de la retícula; el resto fluye hacia abajo. */
  columns?: number;
  origin?: Point;
  gapX?: number;
  gapY?: number;
  createdBy?: string;
};

/**
 * Crea `count` notas en una retícula a partir de `origin` y devuelve sus ids.
 * La primera nota arranca en un hueco libre a la derecha de lo existente.
 */
export function seedTestNotes(doc: Y.Doc, options: SeedOptions = {}): string[] {
  const count = options.count ?? PERF_NOTE_COUNT;
  const columns = options.columns ?? 20;
  const gapX = options.gapX ?? 48;
  const gapY = options.gapY ?? 40;
  const createdBy = options.createdBy ?? 'perf';
  const width = DEFAULT_SIZES.note.width;
  const cellHeight = 120;

  const existing = getOrderedElements(doc);
  let startX = options.origin?.x ?? 0;
  if (options.origin === undefined && existing.length > 0) {
    let maxRight = -Infinity;
    for (const element of existing) {
      maxRight = Math.max(maxRight, element.x + element.width);
    }
    if (Number.isFinite(maxRight)) startX = snapPointToGrid({ x: maxRight + gapX, y: 0 }).x;
  }
  const startY = options.origin?.y ?? 0;

  const ids: string[] = [];
  doc.transact(() => {
    for (let index = 0; index < count; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = startX + column * (width + gapX);
      const y = startY + row * (cellHeight + gapY);
      const id = addElement(
        doc,
        'note',
        { x, y, width, createdBy, now: Date.now() + index },
        localOrigin,
      );
      const fragment = ensureTextFragment(doc, id, localOrigin);
      if (fragment) {
        writePlainText(fragment, `${WORDS[index % WORDS.length] ?? 'nota'} #${index + 1}`);
      }
      ids.push(id);
    }
  }, localOrigin);

  return ids;
}

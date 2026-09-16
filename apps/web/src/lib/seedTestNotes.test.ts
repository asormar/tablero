/** Generador de las 300 notas de prueba (criterio de rendimiento de la fase). */

import { describe, expect, it } from 'vitest';

import {
  createBoardDoc,
  createUndoManager,
  fragmentToPlainText,
  getOrderedElements,
  getTextFragment,
  localOrigin,
} from '@tablero/shared';

import { PERF_NOTE_COUNT, seedTestNotes } from './seedTestNotes';

describe('seedTestNotes', () => {
  it('crea 300 notas con texto y en una sola transacción', () => {
    const doc = createBoardDoc();
    const undoManager = createUndoManager(doc, { trackedOrigins: new Set([localOrigin]) });

    const ids = seedTestNotes(doc, { count: PERF_NOTE_COUNT });

    expect(ids).toHaveLength(PERF_NOTE_COUNT);
    expect(getOrderedElements(doc)).toHaveLength(PERF_NOTE_COUNT);
    const first = ids[0];
    expect(first).toBeTruthy();
    if (!first) return;
    expect(fragmentToPlainText(getTextFragment(doc, first))).toBe('idea #1');

    // Todo el lote es un único paso de deshacer.
    undoManager.undo();
    expect(getOrderedElements(doc)).toHaveLength(0);
    undoManager.redo();
    expect(getOrderedElements(doc)).toHaveLength(PERF_NOTE_COUNT);
  });

  it('coloca las notas en retícula sin solaparse', () => {
    const doc = createBoardDoc();
    seedTestNotes(doc, { count: 40, columns: 4 });
    const elements = getOrderedElements(doc);
    const boxes = new Set(elements.map((element) => `${element.x}:${element.y}`));
    expect(boxes.size).toBe(40);
  });

  it('arranca a la derecha de lo que ya hay cuando no se indica origen', () => {
    const doc = createBoardDoc();
    seedTestNotes(doc, { count: 2, columns: 2 });
    const after = seedTestNotes(doc, { count: 1, columns: 1 });
    const last = getOrderedElements(doc).find((element) => element.id === after[0]);
    expect(last).toBeTruthy();
    if (!last) return;
    expect(last.x).toBeGreaterThan(0);
  });
});

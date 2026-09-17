/**
 * Plantillas del sistema: las doce construyen documentos Yjs de verdad y las
 * referencias entre tarjetas de tablero se remapean al copiar.
 */

import { createBoardDoc, elementsOf, fragmentToPlainText, getOrderedElements, getTextFragment, addElement, ensureTextFragment, writeTextParagraphs } from '@tablero/shared';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('../db.js', () => ({ prisma: {} }));

const { SYSTEM_TEMPLATES, buildTemplateDoc, remapBoardReferences, templateSpecs } = await import('./templates.js');

type Spec = (typeof SYSTEM_TEMPLATES)[number];

function build(spec: Spec): { doc: Y.Doc; childIds: Map<string, string> } {
  const childIds = new Map((spec.children ?? []).map((child) => [child.slug, `board_${child.slug}`]));
  const childTitles = new Map((spec.children ?? []).map((child) => [child.slug, child.name]));
  const doc = buildTemplateDoc(spec, { author: 'system', childBoardIds: childIds, childTitles });
  return { doc, childIds };
}

describe('plantillas del sistema', () => {
  it('son doce, con nombres y slugs únicos y categorías del plan', () => {
    expect(SYSTEM_TEMPLATES).toHaveLength(12);
    expect(new Set(SYSTEM_TEMPLATES.map((spec) => spec.slug)).size).toBe(12);
    expect(new Set(SYSTEM_TEMPLATES.map((spec) => spec.name)).size).toBe(12);
    const categories = new Set(SYSTEM_TEMPLATES.map((spec) => spec.category));
    for (const expected of ['escritura', 'diseño', 'planificación', 'moodboard', 'investigación', 'vídeo', 'personal']) {
      expect(categories.has(expected)).toBe(true);
    }
    expect(templateSpecs).toBe(SYSTEM_TEMPLATES);
  });

  it.each(SYSTEM_TEMPLATES.map((spec) => [spec.name, spec] as const))('%s arma un tablero con tarjetas e instrucciones reales', (_name, spec) => {
    const { doc, childIds } = build(spec);
    const elements = getOrderedElements(doc);

    // Un tablero vacío no es una plantilla: tarjetas de varios tipos, con texto.
    expect(elements.length).toBeGreaterThanOrEqual(6);
    const types = new Set(elements.map((element) => element.type));
    expect(types.size).toBeGreaterThanOrEqual(3);
    expect(types.has('heading')).toBe(true);

    const withText = elements.filter((element) => {
      const text = fragmentToPlainText(getTextFragment(doc, element.id)).trim();
      const title = (element as { title?: string; name?: string }).title ?? (element as { name?: string }).name ?? '';
      return text.length > 0 || title.length > 0;
    });
    expect(withText.length).toBeGreaterThanOrEqual(4);
    expect(fragmentToPlainText(getTextFragment(doc, elements[1]!.id))).toContain('Instrucciones');

    // Referencias a subtableros: existen y apuntan a un hijo declarado.
    const cards = elements.filter((element) => element.type === 'board') as (typeof elements[number] & { boardId?: string })[];
    const declaredChildren = [...childIds.values()];
    for (const card of cards) {
      expect(declaredChildren).toContain(card.boardId);
    }
    // Todo hijo declarado está referenciado por alguna tarjeta.
    for (const childId of declaredChildren) {
      expect(cards.some((card) => card.boardId === childId)).toBe(true);
    }

    // Las columnas (kanban, semanal…) llevan hijos de verdad.
    const columns = elements.filter((element) => element.type === 'column');
    for (const column of columns) {
      const map = elementsOf(doc).get(column.id);
      const children = map?.get('childrenIds');
      expect(children instanceof Y.Array && children.length > 0).toBe(true);
    }
  });
});

describe('remapeo de referencias entre tableros', () => {
  it('reapunta las tarjetas de tablero a la copia y conserva el resto del documento', () => {
    const doc = createBoardDoc();
    const cardId = addElement(doc, 'board', { createdBy: 'system', x: 10, y: 10, width: 280, boardId: 'board_viejo' }, 'test');
    const fragment = ensureTextFragment(doc, cardId, 'test');
    if (fragment) writeTextParagraphs(fragment, 'Reuniones', 'test');
    const noteId = addElement(doc, 'note', { createdBy: 'system', x: 300, y: 10, width: 300 }, 'test');
    const noteFragment = ensureTextFragment(doc, noteId, 'test');
    if (noteFragment) writeTextParagraphs(noteFragment, 'texto de la nota', 'test');

    const remapped = remapBoardReferences(Y.encodeStateAsUpdate(doc), new Map([['board_viejo', 'board_nuevo']]));
    const copy = createBoardDoc();
    Y.applyUpdate(copy, remapped);
    const card = getOrderedElements(copy).find((element) => element.id === cardId) as { boardId?: string } | undefined;
    expect(card?.boardId).toBe('board_nuevo');
    expect(fragmentToPlainText(getTextFragment(copy, cardId))).toBe('Reuniones');
    expect(fragmentToPlainText(getTextFragment(copy, noteId))).toBe('texto de la nota');
  });

  it('deja el estado intacto cuando no hay nada que remapear', () => {
    const doc = createBoardDoc();
    addElement(doc, 'note', { createdBy: 'system', x: 0, y: 0 }, 'test');
    const state = Y.encodeStateAsUpdate(doc);
    expect(remapBoardReferences(state, new Map([['otro', 'nuevo']]))).toBe(state);
  });
});

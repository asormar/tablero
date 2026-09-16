import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  addElement,
  createUndoManager,
  emptyTrash,
  ensureTextFragment,
  getElement,
  getElementMap,
  getElements,
  getOrderedElements,
  getTextFragment,
  getTrashedElements,
  isTrashed,
  orderOf,
  purgeTrash,
  restoreElements,
  TRASH_TTL_MS,
  trashCount,
  trashElements,
} from './doc.js';

const origin = 'test';

const nuevo = (): Y.Doc => new Y.Doc();

describe('papelera', () => {
  it('marca el elemento y lo saca del lienzo, sin perderlo', () => {
    const doc = nuevo();
    const id = addElement(doc, 'note', { createdBy: 'u1' }, origin);
    expect(getElements(doc).map((element) => element.id)).toEqual([id]);

    const trashed = trashElements(doc, [id], origin, { deletedBy: 'u1', now: 1_000 });
    expect(trashed).toEqual([id]);
    expect(getElements(doc)).toEqual([]);
    expect(getOrderedElements(doc)).toEqual([]);
    expect(trashCount(doc)).toBe(1);

    const [entry] = getTrashedElements(doc);
    expect(entry?.id).toBe(id);
    expect(entry?.deletedBy).toBe('u1');
    expect(isTrashed(entry!)).toBe(true);
    // Sigue en el documento: el orden de apilado no se toca.
    expect(getElement(doc, id)?.type).toBe('note');
    expect(orderOf(doc).toArray()).toEqual([id]);
  });

  it('restaura al mismo sitio y con su texto', () => {
    const doc = nuevo();
    const id = addElement(doc, 'note', { createdBy: 'u1' }, origin);
    const segundo = addElement(doc, 'note', { createdBy: 'u1' }, origin);
    const fragmento = ensureTextFragment(doc, id, origin);
    expect(fragmento).not.toBeNull();

    trashElements(doc, [id], origin);
    expect(getOrderedElements(doc).map((element) => element.id)).toEqual([segundo]);

    expect(restoreElements(doc, [id], origin)).toEqual([id]);
    expect(getOrderedElements(doc).map((element) => element.id)).toEqual([id, segundo]);
    expect(trashCount(doc)).toBe(0);
    // El fragmento de texto es el mismo objeto: no se recreó ni se movió.
    expect(getTextFragment(doc, id)).toBe(fragmento);
  });

  it('una columna se lleva sus hijos y los devuelve con ella', () => {
    const doc = nuevo();
    const columnId = addElement(doc, 'column', { createdBy: 'u1' }, origin);
    const hijoA = addElement(doc, 'note', { createdBy: 'u1', parentId: columnId }, origin);
    const hijoB = addElement(doc, 'note', { createdBy: 'u1', parentId: columnId }, origin);
    const suelto = addElement(doc, 'note', { createdBy: 'u1' }, origin);

    const ids = getElementMap(doc, columnId)!.get('childrenIds') as Y.Array<string>;
    ids.push([hijoA, hijoB]);

    const trashed = trashElements(doc, [columnId], origin);
    expect(trashed.sort()).toEqual([columnId, hijoA, hijoB].sort());
    expect(getElements(doc).map((element) => element.id)).toEqual([suelto]);

    restoreElements(doc, [columnId], origin);
    expect(getElements(doc).map((element) => element.id).sort()).toEqual([columnId, hijoA, hijoB, suelto].sort());
  });

  it('no se puede mandar dos veces a la papelera ni restaurar lo que no está', () => {
    const doc = nuevo();
    const id = addElement(doc, 'note', { createdBy: 'u1' }, origin);
    expect(trashElements(doc, [id], origin)).toHaveLength(1);
    expect(trashElements(doc, [id], origin)).toHaveLength(0);
    expect(restoreElements(doc, [id], origin)).toHaveLength(1);
    expect(restoreElements(doc, [id], origin)).toHaveLength(0);
    expect(trashElements(doc, [], origin)).toEqual([]);
    expect(restoreElements(doc, [], origin)).toEqual([]);
  });

  it('purga solo lo que pasó los 30 días', () => {
    const doc = nuevo();
    const viejo = addElement(doc, 'note', { createdBy: 'u1' }, origin);
    const nuevo1 = addElement(doc, 'note', { createdBy: 'u1' }, origin);
    const ahora = 1_800_000_000_000;
    trashElements(doc, [viejo], origin, { now: ahora - TRASH_TTL_MS - 1 });
    trashElements(doc, [nuevo1], origin, { now: ahora - 1_000 });

    expect(purgeTrash(doc, origin, { now: ahora })).toEqual([viejo]);
    expect(getElement(doc, viejo)).toBeNull();
    expect(getElement(doc, nuevo1)).not.toBeNull();
    expect(trashCount(doc)).toBe(1);
  });

  it('vaciar la papelera borra para siempre', () => {
    const doc = nuevo();
    const a = addElement(doc, 'note', { createdBy: 'u1' }, origin);
    const b = addElement(doc, 'note', { createdBy: 'u1' }, origin);
    trashElements(doc, [a, b], origin);
    expect(emptyTrash(doc, origin).sort()).toEqual([a, b].sort());
    expect(getElement(doc, a)).toBeNull();
    expect(orderOf(doc).toArray()).toEqual([]);
    expect(emptyTrash(doc, origin)).toEqual([]);
  });

  it('lo último borrado va primero', () => {
    const doc = nuevo();
    const a = addElement(doc, 'note', { createdBy: 'u1' }, origin);
    const b = addElement(doc, 'note', { createdBy: 'u1' }, origin);
    trashElements(doc, [a], origin, { now: 1_000 });
    trashElements(doc, [b], origin, { now: 2_000 });
    expect(getTrashedElements(doc).map((element) => element.id)).toEqual([b, a]);
  });

  it('deshacer devuelve el elemento del lienzo (borrar sigue siendo deshacible)', () => {
    const doc = nuevo();
    // Sin agrupar por tiempo: cada transacción es un paso de deshacer.
    const manager = createUndoManager(doc, { trackedOrigins: new Set([origin]), captureTimeout: 0 });
    const id = addElement(doc, 'note', { createdBy: 'u1' }, origin);
    trashElements(doc, [id], origin);
    expect(getElements(doc)).toEqual([]);

    manager.undo();
    expect(getElements(doc).map((element) => element.id)).toEqual([id]);
    manager.redo();
    expect(getElements(doc)).toEqual([]);
  });
});

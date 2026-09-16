import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addElement,
  applyPlainDocument,
  bringToFront,
  createBoardDoc,
  createUndoManager,
  duplicateElements,
  elementCount,
  elementRect,
  elementsOf,
  ensureTextFragment,
  fragmentToPlainText,
  getElement,
  getElements,
  getOrderedElements,
  getTextFragment,
  insertElement,
  moveElements,
  orderOf,
  pasteClipboard,
  patchElement,
  patchElements,
  reconcileOrder,
  removeElements,
  resizeElement,
  sendToBack,
  serializeForClipboard,
  toPlainDocument,
  type ElementMap,
} from './doc.js';
import type { CanvasElement } from './elements.js';

const USER = 'user_ana';
const origin = Symbol('test/local');
const actor = { createdBy: USER, now: 1_700_000_000_000 };

let doc: Y.Doc;

beforeEach(() => {
  doc = createBoardDoc();
});

function note(x = 0, y = 0, extra: Record<string, unknown> = {}): string {
  return addElement(doc, 'note', { ...actor, x, y, ...extra }, origin);
}

function writeText(id: string, value: string): void {
  const fragment = ensureTextFragment(doc, id, origin);
  fragment!.insert(0, [new Y.XmlText(value)]);
}

describe('createBoardDoc', () => {
  it('crea las tres colecciones del documento', () => {
    expect(doc.getMap('elements')).toBeInstanceOf(Y.Map);
    expect(doc.getArray('order')).toBeInstanceOf(Y.Array);
    expect(doc.getMap('connectors')).toBeInstanceOf(Y.Map);
  });
});

describe('addElement', () => {
  it('registra el elemento con valores por defecto del tipo', () => {
    const id = note(120, 80);
    const element = getElement(doc, id)!;
    expect(element.type).toBe('note');
    expect(element.x).toBe(120);
    expect(element.width).toBe(240);
    expect(element.createdBy).toBe(USER);
    expect(element.createdAt).toBe(actor.now);
    expect(orderOf(doc).toArray()).toEqual([id]);
  });

  it('permite fijar id y tamaño explícitos', () => {
    const id = addElement(doc, 'heading', { ...actor, id: 'el_fijo', width: 500, size: 'L' }, origin);
    expect(id).toBe('el_fijo');
    const element = getElement(doc, id)!;
    expect(element.width).toBe(500);
    expect(element).toMatchObject({ size: 'L' });
  });

  it('no escribe el fragmento de texto en la creación', () => {
    const id = note();
    expect(getTextFragment(doc, id)).toBeNull();
    expect(elementsOf(doc).get(id)!.get('text')).toBeUndefined();
  });
});

describe('lectura', () => {
  it('devuelve los elementos en orden de apilado', () => {
    const a = note();
    const b = note();
    expect(getOrderedElements(doc).map((el) => el.id)).toEqual([a, b]);
  });

  it('coloca al final los elementos que no están en `order`', () => {
    const a = note();
    const stray: CanvasElement = {
      id: 'el_huerfano',
      type: 'note',
      x: 0,
      y: 0,
      width: 240,
      createdBy: USER,
      createdAt: 1,
      updatedAt: 1,
    };
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(stray)) map.set(key, value);
    elementsOf(doc).set('el_huerfano', map);
    expect(getOrderedElements(doc).map((el) => el.id)).toEqual([a, 'el_huerfano']);
    expect(elementCount(doc)).toBe(2);
  });

  it('elementRect usa la altura medida cuando no hay altura fija', () => {
    const id = note(10, 20);
    const element = getElement(doc, id)!;
    expect(elementRect(element)).toEqual({ x: 10, y: 20, width: 240, height: 48 });
    expect(elementRect(element, 133)).toEqual({ x: 10, y: 20, width: 240, height: 133 });
    resizeElement(doc, id, { height: 90 }, origin);
    expect(elementRect(getElement(doc, id)!).height).toBe(90);
  });
});

describe('moveElements', () => {
  it('aplica un gesto completo en una sola transacción', () => {
    const a = note(0, 0);
    const b = note(100, 100);
    let updates = 0;
    doc.on('afterTransaction', (transaction) => {
      if (transaction.changed.size > 0) updates += 1;
    });
    moveElements(
      doc,
      [
        { id: a, x: 40, y: 40 },
        { id: b, x: 140, y: 140 },
      ],
      origin,
    );
    expect(updates).toBe(1);
    expect(getElement(doc, a)).toMatchObject({ x: 40, y: 40 });
    expect(getElement(doc, b)).toMatchObject({ x: 140, y: 140 });
  });

  it('ignora ids inexistentes', () => {
    expect(() => moveElements(doc, [{ id: 'nope', x: 1, y: 1 }], origin)).not.toThrow();
  });
});

describe('patchElement / patchElements', () => {
  it('aplica color y actualiza updatedAt', () => {
    const id = note();
    patchElement(doc, id, { color: 'yellow' }, origin);
    const element = getElement(doc, id)!;
    expect(element.color).toBe('yellow');
    expect(element.updatedAt).toBeGreaterThanOrEqual(actor.now);
  });

  it('nunca sobrescribe el texto enriquecido', () => {
    const id = note();
    writeText(id, 'hola');
    patchElement(doc, id, { text: 'texto plano malicioso' }, origin);
    expect(fragmentToPlainText(getTextFragment(doc, id))).toBe('hola');
  });

  it('patchElements toca todos los seleccionados', () => {
    const a = note();
    const b = note();
    patchElements(doc, [a, b], { locked: true }, origin);
    expect(getElement(doc, a)!.locked).toBe(true);
    expect(getElement(doc, b)!.locked).toBe(true);
  });
});

describe('removeElements', () => {
  it('borra del mapa y del orden', () => {
    const a = note();
    const b = note();
    removeElements(doc, [a], origin);
    expect(getElement(doc, a)).toBeNull();
    expect(getElements(doc).map((el) => el.id)).toEqual([b]);
    expect(orderOf(doc).toArray()).toEqual([b]);
  });
});

describe('texto enriquecido', () => {
  it('convierte un fragmento a texto plano', () => {
    const id = note();
    const fragment = ensureTextFragment(doc, id, origin)!;
    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    text.insert(0, 'primera línea');
    paragraph.insert(0, [text]);
    fragment.insert(0, [paragraph]);
    const second = new Y.XmlElement('paragraph');
    second.insert(0, [new Y.XmlText()]);
    fragment.insert(1, [second]);
    expect(fragmentToPlainText(getTextFragment(doc, id))).toBe('primera línea\n');
  });

  it('no recrea el fragmento si ya existe', () => {
    const id = note();
    const first = ensureTextFragment(doc, id, origin);
    const second = ensureTextFragment(doc, id, origin);
    expect(second).toBe(first);
  });
});

describe('orden de apilado', () => {
  it('trae al frente y envía atrás', () => {
    const a = note();
    const b = note();
    const c = note();
    bringToFront(doc, [a], origin);
    expect(orderOf(doc).toArray()).toEqual([b, c, a]);
    sendToBack(doc, [a], origin);
    expect(orderOf(doc).toArray()).toEqual([a, b, c]);
  });

  it('reconcilia ids borrados o huérfanos', () => {
    const a = note();
    const b = note();
    orderOf(doc).delete(0, 1);
    orderOf(doc).push(['el_fantasma']);
    reconcileOrder(doc, origin);
    expect(orderOf(doc).toArray()).toEqual([b, a]);
  });
});

describe('duplicar', () => {
  it('copia con desplazamiento y nuevo id', () => {
    const id = note(100, 100, { color: 'red' });
    writeText(id, 'contenido');
    const [copyId] = duplicateElements(doc, [id], { dx: 24, dy: 24 }, origin, { createdBy: USER });
    expect(copyId).not.toBe(id);
    const copy = getElement(doc, copyId!)!;
    expect(copy).toMatchObject({ x: 124, y: 124, color: 'red', createdBy: USER });
  });

  it('clona el texto enriquecido con el clonador provisto', () => {
    const id = note();
    writeText(id, 'hola');
    const [copyId] = duplicateElements(doc, [id], { dx: 0, dy: 0 }, origin, {
      cloneText: (source, destination) => {
        source.toArray().forEach((node) => {
          if (node instanceof Y.XmlText) {
            const text = new Y.XmlText();
            text.insert(0, node.toString());
            destination.insert(destination.length, [text]);
          }
        });
      },
    });
    expect(fragmentToPlainText(getTextFragment(doc, copyId!))).toBe('hola');
  });
});

describe('portapapeles', () => {
  it('conserva las posiciones relativas al pegar', () => {
    const a = note(100, 100);
    const b = note(400, 250);
    const payload = serializeForClipboard(doc, [a, b]);
    const newIds = pasteClipboard(doc, payload, origin, { dx: 20, dy: 30, createdBy: 'user_luis' });
    expect(newIds).toHaveLength(2);
    const pasted = newIds.map((id) => getElement(doc, id)!);
    expect(pasted[0]!.x).toBe(120);
    expect(pasted[0]!.y).toBe(130);
    expect(pasted[1]!.x - pasted[0]!.x).toBe(300);
    expect(pasted[1]!.y - pasted[0]!.y).toBe(150);
    expect(pasted[0]!.createdBy).toBe('user_luis');
  });

  it('pega en un punto concreto', () => {
    const a = note(1000, 900);
    const payload = serializeForClipboard(doc, [a]);
    const [id] = pasteClipboard(doc, payload, origin, { dx: 0, dy: 0, createdBy: USER, at: { x: 50, y: 60 } });
    expect(getElement(doc, id!)).toMatchObject({ x: 50, y: 60 });
  });

  it('sin elementos no hace nada', () => {
    expect(pasteClipboard(doc, { version: 1, elements: [] }, origin, { dx: 0, dy: 0, createdBy: USER })).toEqual([]);
  });
});

describe('deshacer / rehacer', () => {
  function manager() {
    return createUndoManager(doc, { trackedOrigins: new Set([origin]), captureTimeout: 0 });
  }

  it('deshace un movimiento y lo rehace', () => {
    const id = note(0, 0);
    const undo = manager();
    moveElements(doc, [{ id, x: 200, y: 160 }], origin);
    expect(getElement(doc, id)!.x).toBe(200);
    undo.undo();
    expect(getElement(doc, id)!.x).toBe(0);
    undo.redo();
    expect(getElement(doc, id)!.x).toBe(200);
  });

  it('deshace la edición de una propiedad', () => {
    const id = note();
    const undo = manager();
    patchElement(doc, id, { color: 'teal' }, origin);
    undo.undo();
    expect(getElement(doc, id)!.color).toBeUndefined();
  });

  it('deshace el borrado y recupera el texto enriquecido', () => {
    const id = note(64, 64);
    writeText(id, 'no me borres');
    const undo = manager();
    removeElements(doc, [id], origin);
    expect(getElement(doc, id)).toBeNull();
    undo.undo();
    const restored = getElement(doc, id);
    expect(restored).toMatchObject({ x: 64, y: 64 });
    expect(fragmentToPlainText(getTextFragment(doc, id))).toBe('no me borres');
  });

  it('deshace la creación', () => {
    const undo = manager();
    const id = note();
    undo.undo();
    expect(getElement(doc, id)).toBeNull();
    expect(orderOf(doc).toArray()).toEqual([]);
    undo.redo();
    expect(getElement(doc, id)).not.toBeNull();
  });

  it('agrupa el arrastre de un grupo y deshace los elementos a la vez', () => {
    const a = note(0, 0);
    const b = note(100, 0);
    const undo = manager();
    moveElements(
      doc,
      [
        { id: a, x: 8, y: 8 },
        { id: b, x: 108, y: 8 },
      ],
      origin,
    );
    expect(undo.undoStack.length).toBe(1);
    undo.undo();
    expect(getElement(doc, a)!.x).toBe(0);
    expect(getElement(doc, b)!.x).toBe(100);
  });

  it('no deshace cambios de otros orígenes', () => {
    const id = note(0, 0);
    const undo = manager();
    moveElements(doc, [{ id, x: 500, y: 500 }], Symbol('remoto'));
    expect(undo.canUndo()).toBe(false);
    expect(getElement(doc, id)!.x).toBe(500);
  });

  it('acumula pasos independientes por transacción', () => {
    const id = note(0, 0);
    const undo = manager();
    moveElements(doc, [{ id, x: 100, y: 0 }], origin);
    moveElements(doc, [{ id, x: 200, y: 0 }], origin);
    moveElements(doc, [{ id, x: 300, y: 0 }], origin);
    undo.undo();
    undo.undo();
    expect(getElement(doc, id)!.x).toBe(100);
    expect(undo.canUndo()).toBe(true);
    undo.undo();
    expect(getElement(doc, id)!.x).toBe(0);
    expect(undo.canUndo()).toBe(false);
  });
});

describe('persistencia', () => {
  it('aplicar la actualización binaria reproduce el documento', () => {
    const a = note(300, 120, { color: 'blue' });
    writeText(a, 'sobrevive al recargar');
    const b = insertElement(doc, { ...(getElement(doc, a)! as CanvasElement), id: 'el_dos', x: 900 }, origin);
    expect(b).toBeUndefined();

    const update = Y.encodeStateAsUpdate(doc);
    const restoredDoc = createBoardDoc();
    Y.applyUpdate(restoredDoc, update);

    expect(getOrderedElements(restoredDoc).map((el) => el.id)).toEqual(getOrderedElements(doc).map((el) => el.id));
    expect(getElement(restoredDoc, a)).toMatchObject({ x: 300, y: 120, color: 'blue' });
    expect(fragmentToPlainText(getTextFragment(restoredDoc, a))).toBe('sobrevive al recargar');
  });

  it('fusión de dos réplicas sin perder elementos', () => {
    const a = note(0, 0);
    const replica = createBoardDoc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    addElement(replica, 'note', { ...actor, id: 'el_replica', x: 500, y: 0 }, origin);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica));
    expect(getElements(doc).map((el) => el.id).sort()).toEqual([a, 'el_replica'].sort());
  });

  it('round trip de exportación/importación en texto plano', () => {
    const a = note(10, 10, { color: 'purple' });
    const b = addElement(doc, 'board', { ...actor, x: 400, y: 0, boardId: 'bd_otro' }, origin);
    const plain = toPlainDocument(doc);
    const target = createBoardDoc();
    applyPlainDocument(target, plain, origin);
    expect(getOrderedElements(target).map((el) => el.id)).toEqual([a, b]);
    const restoredBoard = getElement(target, b)!;
    expect(restoredBoard.type).toBe('board');
    expect((restoredBoard as { boardId?: string }).boardId).toBe('bd_otro');
    expect(restoredBoard.color).toBeUndefined();
    expect(restoredBoard.x).toBe(400);
  });
});

describe('lectura defensiva', () => {
  it('descarta mapas sin id o sin tipo', () => {
    const map = new Y.Map<unknown>();
    map.set('x', 10);
    elementsOf(doc).set('el_roto', map as ElementMap);
    expect(getElements(doc)).toHaveLength(0);
  });
});

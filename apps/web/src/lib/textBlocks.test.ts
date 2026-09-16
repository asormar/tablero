/**
 * Texto enriquecido: lectura desde el `Y.XmlFragment` (vista previa) y
 * instantáneas portables (copiar/cortar/pegar).
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createBoardDoc, ensureTextFragment, fragmentToPlainText } from '@tablero/shared';

import { blocksToPlainText, firstLineOf, isTextEmpty, textBlocksOf } from './textBlocks';
import { cloneFragment, restoreFragment, snapshotFragment, writePlainText } from './xmlFragment';

/** Fragmento listo para usar: dentro de un elemento del documento. */
function attachFragment(doc: Y.Doc, id: string): Y.XmlFragment {
  const map = new Y.Map<unknown>();
  map.set('id', id);
  map.set('type', 'note');
  doc.getMap('elements').set(id, map);
  const fragment = new Y.XmlFragment();
  map.set('text', fragment);
  return fragment;
}

function fragmentWith(text: string): Y.XmlFragment {
  const doc = createBoardDoc();
  const fragment = attachFragment(doc, 'el_1');
  writePlainText(fragment, text);
  return fragment;
}

describe('textBlocksOf', () => {
  it('un párrafo por línea', () => {
    const blocks = textBlocksOf(fragmentWith('uno\ndos'));
    expect(blocks).toHaveLength(2);
    expect(blocksToPlainText(blocks)).toBe('uno\ndos');
    expect(firstLineOf(blocks)).toBe('uno');
  });

  it('lee las marcas del delta (negrita, cursiva, código)', () => {
    const doc = createBoardDoc();
    const fragment = attachFragment(doc, 'marcas');

    const addParagraph = (fill: (text: Y.XmlText) => void): void => {
      const paragraph = new Y.XmlElement('paragraph');
      fragment.insert(fragment.length, [paragraph]);
      const text = new Y.XmlText();
      paragraph.insert(paragraph.length, [text]);
      fill(text);
    };

    addParagraph((text) => {
      text.insert(0, 'normal ');
      text.insert(7, 'fuerte', { bold: true });
    });
    addParagraph((text) => {
      text.insert(0, 'suave', { italic: true });
    });
    addParagraph((text) => {
      text.insert(0, 'código', { code: true });
    });

    const blocks = textBlocksOf(fragment);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.runs).toHaveLength(2);
    expect(blocks[0]?.runs[0]).toMatchObject({ text: 'normal ', bold: false });
    expect(blocks[0]?.runs[1]).toMatchObject({ text: 'fuerte', bold: true });
    expect(blocks[1]?.runs[0]).toMatchObject({ text: 'suave', italic: true });
    expect(blocks[2]?.runs[0]).toMatchObject({ text: 'código', code: true });
    expect(blocksToPlainText(blocks)).toBe('normal fuerte\nsuave\ncódigo');
  });

  it('un inserto adopta el formato del texto anterior (comportamiento de Yjs)', () => {
    // Sirve para documentar por qué la vista previa no puede asumir un run por palabra.
    const doc = createBoardDoc();
    const fragment = attachFragment(doc, 'formato');
    const paragraph = new Y.XmlElement('paragraph');
    fragment.insert(0, [paragraph]);
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    text.insert(0, 'fuerte', { bold: true });
    text.insert(6, ' y más');

    const runs = textBlocksOf(fragment)[0]?.runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ text: 'fuerte y más', bold: true });
  });

  it('lee encabezados con su nivel y listas', () => {
    const doc = createBoardDoc();
    const fragment = attachFragment(doc, 'bloques');

    const heading = new Y.XmlElement('heading');
    heading.setAttribute('level', '2');
    const headingText = new Y.XmlText();
    fragment.insert(0, [heading]);
    heading.insert(0, [headingText]);
    headingText.insert(0, 'Título');

    const list = new Y.XmlElement('bulletList');
    const item = new Y.XmlElement('listItem');
    const itemParagraph = new Y.XmlElement('paragraph');
    const itemText = new Y.XmlText();
    fragment.insert(1, [list]);
    list.insert(0, [item]);
    item.insert(0, [itemParagraph]);
    itemParagraph.insert(0, [itemText]);
    itemText.insert(0, 'punto');

    const blocks = textBlocksOf(fragment);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 2 });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocksToPlainText(blocks)).toBe('Título\npunto');
  });

  it('detecta el texto vacío', () => {
    expect(isTextEmpty(textBlocksOf(fragmentWith('')))).toBe(true);
    expect(isTextEmpty(textBlocksOf(fragmentWith('algo')))).toBe(false);
    expect(isTextEmpty(textBlocksOf(null))).toBe(true);
  });

  it('el fragmento plano sigue siendo legible por el paquete compartido', () => {
    expect(fragmentToPlainText(fragmentWith('hola\nmundo'))).toBe('hola\nmundo');
  });
});

describe('instantáneas del fragmento', () => {
  it('copia una nota en otra conservando el contenido', () => {
    const source = fragmentWith('original');
    const snapshot = snapshotFragment(source);
    expect(snapshot).toHaveLength(1);

    const doc = createBoardDoc();
    const destination = attachFragment(doc, 'destino');
    restoreFragment(destination, snapshot);
    expect(fragmentToPlainText(destination)).toBe('original');
  });

  it('clona el contenido sin tocar el original', () => {
    const source = fragmentWith('clonar');
    const doc = createBoardDoc();
    const destination = attachFragment(doc, 'destino');
    cloneFragment(source, destination);
    expect(fragmentToPlainText(destination)).toBe('clonar');
    writePlainText(source, 'cambiado');
    expect(fragmentToPlainText(destination)).toBe('clonar');
    expect(fragmentToPlainText(source)).toBe('cambiado');
  });

  it('la instantánea sobrevive a que el elemento original se borre (cortar)', () => {
    const doc = createBoardDoc();
    const source = attachFragment(doc, 'origen');
    writePlainText(source, 'sobrevive');
    const snapshot = snapshotFragment(source);

    doc.getMap('elements').delete('origen');

    const destination = attachFragment(doc, 'destino');
    restoreFragment(destination, snapshot);
    expect(fragmentToPlainText(destination)).toBe('sobrevive');
  });

  it('conserva las marcas al pasar por la instantánea', () => {
    const doc = createBoardDoc();
    const source = attachFragment(doc, 'origen');
    const paragraph = new Y.XmlElement('paragraph');
    source.insert(0, [paragraph]);
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    text.insert(0, 'fuerte', { bold: true });

    const destination = attachFragment(doc, 'destino');
    restoreFragment(destination, snapshotFragment(source));

    const runs = textBlocksOf(destination)[0]?.runs ?? [];
    expect(runs[0]).toMatchObject({ text: 'fuerte', bold: true });
  });
});

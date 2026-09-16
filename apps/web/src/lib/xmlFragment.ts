/**
 * Estructura del texto enriquecido dentro de un `Y.XmlFragment`.
 *
 * y-prosemirror representa cada nodo del documento como `Y.XmlElement` con el
 * nombre del nodo (`paragraph`, `heading`, `bulletList`…) y el texto como
 * `Y.XmlText` con marcas en los atributos del delta. Aquí solo se lee y se
 * escribe esa estructura: sirve tanto para el generador de pruebas como para
 * duplicar/pegar notas sin necesidad de montar un editor de ProseMirror.
 */

import * as Y from 'yjs';

/**
 * Escribe texto plano: un párrafo por línea. Reemplaza el contenido previo.
 *
 * Los nodos se integran en el documento antes de rellenarlos: modificar un tipo
 * de Yjs que todavía no forma parte del documento no es fiable.
 */
export function writePlainText(fragment: Y.XmlFragment, text: string, origin?: unknown): void {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const build = () => {
    fragment.delete(0, fragment.length);
    for (const line of lines) {
      const paragraph = new Y.XmlElement('paragraph');
      fragment.insert(fragment.length, [paragraph]);
      if (line.length === 0) continue;
      const node = new Y.XmlText();
      paragraph.insert(paragraph.length, [node]);
      node.insert(0, line);
    }
  };
  if (origin === undefined) build();
  else {
    const doc = fragment.doc;
    if (doc) doc.transact(build, origin);
    else build();
  }
}

function cloneXmlNode(source: Y.XmlElement | Y.XmlText, dest: Y.XmlElement | Y.XmlFragment): void {
  if (source instanceof Y.XmlText) {
    const copy = new Y.XmlText();
    dest.insert(dest.length, [copy]);
    let index = 0;
    for (const op of source.toDelta()) {
      if (typeof op.insert !== 'string') continue;
      copy.insert(index, op.insert, op.attributes ?? {});
      index += op.insert.length;
    }
    return;
  }
  const copy = new Y.XmlElement(source.nodeName);
  dest.insert(dest.length, [copy]);
  for (const [key, value] of Object.entries(source.getAttributes())) {
    if (value === undefined) continue;
    copy.setAttribute(key, value);
  }
  for (const child of source.toArray()) {
    if (child instanceof Y.XmlElement || child instanceof Y.XmlText) cloneXmlNode(child, copy);
  }
}

/** Copia el contenido de un fragmento en otro (duplicar, pegar). */
export function cloneFragment(source: Y.XmlFragment, dest: Y.XmlFragment): void {
  for (const child of source.toArray()) {
    if (child instanceof Y.XmlElement || child instanceof Y.XmlText) cloneXmlNode(child, dest);
  }
}

// --- Instantánea portable ----------------------------------------------------
//
// Copiar/cortar/pegar no puede depender de los `Y.XmlFragment` originales
// (cortar los destruye). Se serializa la estructura a JSON plano y se reconstruye
// al pegar: no hace falta ningún esquema de ProseMirror.

export type XmlSnapshotNode =
  | {
      kind: 'element';
      nodeName: string;
      attributes: Record<string, string>;
      children: XmlSnapshotNode[];
    }
  | {
      kind: 'text';
      ops: { insert: string; attributes?: Record<string, unknown> }[];
    };

export function snapshotFragment(fragment: Y.XmlFragment | null | undefined): XmlSnapshotNode[] {
  if (!fragment) return [];
  return fragment
    .toArray()
    .map((node) => snapshotNode(node as Y.XmlElement | Y.XmlText))
    .filter((node): node is XmlSnapshotNode => node !== null);
}

function snapshotNode(node: Y.XmlElement | Y.XmlText): XmlSnapshotNode | null {
  if (node instanceof Y.XmlText) {
    const ops: { insert: string; attributes?: Record<string, unknown> }[] = [];
    for (const op of node.toDelta()) {
      if (typeof op.insert !== 'string' || op.insert.length === 0) continue;
      ops.push(op.attributes ? { insert: op.insert, attributes: op.attributes } : { insert: op.insert });
    }
    return { kind: 'text', ops };
  }
  if (node instanceof Y.XmlElement) {
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(node.getAttributes())) {
      if (value !== undefined) attributes[key] = value;
    }
    return {
      kind: 'element',
      nodeName: node.nodeName,
      attributes,
      children: node
        .toArray()
        .map((child) => snapshotNode(child as Y.XmlElement | Y.XmlText))
        .filter((child): child is XmlSnapshotNode => child !== null),
    };
  }
  return null;
}

export function restoreFragment(fragment: Y.XmlFragment, nodes: XmlSnapshotNode[]): void {
  for (const node of nodes) buildInto(fragment, node);
}

/** Construye un nodo integrándolo primero y rellenándolo después. */
function buildInto(parent: Y.XmlElement | Y.XmlFragment, snapshot: XmlSnapshotNode): void {
  if (snapshot.kind === 'text') {
    const text = new Y.XmlText();
    parent.insert(parent.length, [text]);
    let index = 0;
    for (const op of snapshot.ops) {
      text.insert(index, op.insert, op.attributes ?? {});
      index += op.insert.length;
    }
    return;
  }
  const element = new Y.XmlElement(snapshot.nodeName);
  parent.insert(parent.length, [element]);
  for (const [key, value] of Object.entries(snapshot.attributes)) element.setAttribute(key, value);
  for (const child of snapshot.children) buildInto(element, child);
}

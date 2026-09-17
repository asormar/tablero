/**
 * Filtro de escritura del comentarista (arreglo de la revisión de la fase 5).
 *
 * `isCommentsOnlyUpdate(doc, update)` decide si un update puede aplicarse en un
 * tablero donde el rol solo permite comentar: mira el tipo raíz de cada struct y
 * de la delete set del update. Los updates de prueba se generan con documentos
 * Yjs reales —el diff entre el estado del servidor y el del cliente, que es lo
 * que viaja por el socket—, no con bytes armados a mano.
 */

import { describe, expect, it } from 'vitest';

import {
  addComment,
  addElement,
  createBoardDoc,
  ensureTextFragment,
  patchElement,
  removeComment,
  removeElements,
  resolveComment,
  updateCommentBody,
  writeTextParagraphs,
} from '@tablero/shared';
import * as Y from 'yjs';

import { isCommentsOnlyUpdate, touchedRootTypes } from './comment-writes.js';

/** Documento del servidor: nota con texto (el contenido editable de siempre). */
function serverDocument(): { doc: Y.Doc; noteId: string } {
  const doc = createBoardDoc();
  const noteId = addElement(doc, 'note', { createdBy: 'user_ana', x: 0, y: 0, title: 'Nota' }, 'test');
  const fragment = ensureTextFragment(doc, noteId);
  if (fragment) writeTextParagraphs(fragment, 'Contenido de la nota', 'test');
  return { doc, noteId };
}

/** Copia sincronizada del documento, como la de un cliente conectado. */
function clientCopy(doc: Y.Doc): Y.Doc {
  const copy = createBoardDoc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

/** Update que el cliente mandaría: lo que el servidor todavía no tiene. */
function diff(client: Y.Doc, base: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(client, Y.encodeStateVector(base));
}

describe('isCommentsOnlyUpdate', () => {
  it('rechaza un update que crea o edita un elemento', () => {
    const { doc, noteId } = serverDocument();
    const client = clientCopy(doc);
    addElement(client, 'note', { createdBy: 'user_beto', x: 10, y: 10 }, 'test');
    const created = diff(client, doc);
    // Crear una tarjeta toca `elements` (y `order`, el orden del lienzo).
    expect(touchedRootTypes(doc, created)).toContain('elements');
    expect(isCommentsOnlyUpdate(doc, created)).toBe(false);

    patchElement(client, noteId, { title: 'Título nuevo' }, 'test');
    expect(isCommentsOnlyUpdate(doc, diff(client, doc))).toBe(false);
  });

  it('un update vacío no cambia nada (se acepta sin tocar ninguna raíz)', () => {
    const { doc } = serverDocument();
    expect(isCommentsOnlyUpdate(doc, diff(clientCopy(doc), doc))).toBe(true);
  });

  it('acepta un comentario nuevo (struct raíz + anidados del update)', () => {
    const { doc, noteId } = serverDocument();
    const client = clientCopy(doc);
    addComment(
      client,
      { elementId: noteId, x: null, y: null, authorId: 'user_beto', authorName: 'Beto', body: 'Comentario nuevo', mentions: [] },
      'test',
    );
    const update = diff(client, doc);
    expect(touchedRootTypes(doc, update)).toEqual(new Set(['comments']));
    expect(isCommentsOnlyUpdate(doc, update)).toBe(true);
  });

  it('acepta editar el cuerpo de un comentario que el servidor ya tiene', () => {
    const { doc, noteId } = serverDocument();
    const client = clientCopy(doc);
    addComment(client, { elementId: noteId, x: null, y: null, authorId: 'user_beto', authorName: 'Beto', body: 'Primero' }, 'test');
    Y.applyUpdate(doc, diff(client, doc)); // el servidor lo recibe

    updateCommentBody(client, [...client.getMap('comments').keys()][0]!, 'Editado');
    const update = diff(client, doc);
    expect(isCommentsOnlyUpdate(doc, update)).toBe(true);
  });

  it('acepta resolver un comentario existente (parent resuelto por el documento)', () => {
    const { doc, noteId } = serverDocument();
    const client = clientCopy(doc);
    const id = addComment(
      client,
      { elementId: noteId, x: null, y: null, authorId: 'user_beto', authorName: 'Beto', body: 'Hilo' },
      'test',
    );
    Y.applyUpdate(doc, diff(client, doc));

    resolveComment(client, id, true, 'user_beto', 'test');
    const update = diff(client, doc);
    expect(touchedRootTypes(doc, update)).toEqual(new Set(['comments']));
  });

  it('acepta borrar un comentario (la delete set apunta a `comments`)', () => {
    const { doc, noteId } = serverDocument();
    const client = clientCopy(doc);
    const id = addComment(
      client,
      { elementId: noteId, x: null, y: null, authorId: 'user_beto', authorName: 'Beto', body: 'Se va' },
      'test',
    );
    Y.applyUpdate(doc, diff(client, doc));

    removeComment(client, id, 'test');
    const update = diff(client, doc);
    expect(touchedRootTypes(doc, update)).toEqual(new Set(['comments']));
    expect(isCommentsOnlyUpdate(doc, update)).toBe(true);
  });

  it('rechaza borrar un elemento (la delete set toca `elements`)', () => {
    const { doc, noteId } = serverDocument();
    const client = clientCopy(doc);
    removeElements(client, [noteId], 'test');
    const update = diff(client, doc);
    expect(isCommentsOnlyUpdate(doc, update)).toBe(false);
  });

  it('rechaza un lote mixto (comentario + edición en el mismo update)', () => {
    const { doc, noteId } = serverDocument();
    const client = clientCopy(doc);
    client.transact(() => {
      addComment(client, { elementId: noteId, x: null, y: null, authorId: 'user_beto', authorName: 'Beto', body: 'Mezcla' }, 'test');
      patchElement(client, noteId, { title: 'Título nuevo' }, 'test');
    }, 'test');
    const update = diff(client, doc);
    expect(isCommentsOnlyUpdate(doc, update)).toBe(false);
  });

  it('rechaza un update anidado cuya base no está ni en el update ni en el documento', () => {
    // El cliente mandó solo la segunda transacción (texto dentro de una nota
    // recién creada): el parent apunta a un struct que el servidor no tiene.
    const client = createBoardDoc();
    const noteId = addElement(client, 'note', { createdBy: 'user_beto', x: 0, y: 0 }, 'test');
    const fragment = ensureTextFragment(client, noteId);
    const stateVector = Y.encodeStateVector(client);
    if (fragment) writeTextParagraphs(fragment, 'Texto sin base', 'test');
    const update = Y.encodeStateAsUpdate(client, stateVector);

    expect(touchedRootTypes(serverDocument().doc, update)).toBeNull();
    expect(isCommentsOnlyUpdate(serverDocument().doc, update)).toBe(false);
  });

  it('rechaza bytes que no son un update de Yjs', () => {
    const { doc } = serverDocument();
    expect(isCommentsOnlyUpdate(doc, new Uint8Array([255, 255, 255, 255]))).toBe(false);
  });
});

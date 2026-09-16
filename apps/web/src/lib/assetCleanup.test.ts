/**
 * Liberación de assets cuando una tarjeta sale del documento para siempre.
 *
 * La regla que se protege acá es la de la decisión documentada: un archivo se
 * libera solo si **ningún otro elemento** del documento (ni siquiera uno en la
 * papelera) sigue apuntando a su `assetId`.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { addElement, createBoardDoc, getElements, removeElements, trashElements } from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';

import { allElementsOf, referencedAssetIds, releaseUnreferencedAssets } from './assetCleanup';

const actor = { createdBy: 'user-1' };
const origin = 'test';

/** Sesión mínima: estas funciones solo usan el documento y el origen. */
function sessionOf(doc: Y.Doc): BoardSession {
  return { doc, origin } as unknown as BoardSession;
}

function imageCard(doc: Y.Doc, assetId: string, extra: Record<string, unknown> = {}): string {
  return addElement(doc, 'image', { ...actor, x: 0, y: 0, width: 240, assetId, ...extra }, origin);
}

describe('referencedAssetIds', () => {
  it('cuenta las referencias repetidas y las de la papelera', () => {
    const doc = createBoardDoc();
    const first = imageCard(doc, 'asset-1');
    imageCard(doc, 'asset-1');
    addElement(doc, 'note', { ...actor, x: 0, y: 0 }, origin);
    expect([...referencedAssetIds(doc)]).toEqual(['asset-1']);

    // Un elemento en la papelera sigue siendo una referencia: deshacer y
    // restaurar tienen que poder mostrar el archivo.
    trashElements(doc, [first], origin, { deletedBy: 'user-1' });
    expect([...referencedAssetIds(doc)]).toEqual(['asset-1']);
  });

  it('lista todos los elementos del documento, incluso los de la papelera', () => {
    const doc = createBoardDoc();
    const noteId = addElement(doc, 'note', { ...actor, x: 0, y: 0 }, origin);
    trashElements(doc, [noteId], origin, { deletedBy: 'user-1' });
    expect(getElements(doc)).toHaveLength(0);
    expect(allElementsOf(doc).map((element) => element.id)).toEqual([noteId]);
  });
});

describe('releaseUnreferencedAssets', () => {
  it('no libera un asset que otro elemento sigue usando', async () => {
    const doc = createBoardDoc();
    const first = imageCard(doc, 'asset-compartido');
    const second = imageCard(doc, 'asset-compartido');
    const removed = allElementsOf(doc).filter((element) => element.id === first);
    // El flujo real saca el elemento del documento antes de liberar.
    removeElements(doc, [first], origin);

    const result = await releaseUnreferencedAssets(sessionOf(doc), removed);
    expect(result).toEqual({ deleted: 0, kept: 1 });
    expect(doc.getMap('elements').has(second)).toBe(true);
  });

  it('cuenta como libres los assets sin referencias (sin API no hay borrado remoto)', async () => {
    const doc = createBoardDoc();
    const only = imageCard(doc, 'asset-huerfano');
    const removed = allElementsOf(doc).filter((element) => element.id === only);
    removeElements(doc, [only], origin);

    // La tienda arranca con `apiOnline: false`: no se llama al servidor, pero la
    // limpieza de cachés y del store de assets sí ocurre.
    const result = await releaseUnreferencedAssets(sessionOf(doc), removed);
    expect(result).toEqual({ deleted: 0, kept: 0 });
  });

  it('ignora elementos sin asset', async () => {
    const doc = createBoardDoc();
    const noteId = addElement(doc, 'note', { ...actor, x: 0, y: 0 }, origin);
    const removed = allElementsOf(doc).filter((element) => element.id === noteId);
    const result = await releaseUnreferencedAssets(sessionOf(doc), removed);
    expect(result).toEqual({ deleted: 0, kept: 0 });
  });
});

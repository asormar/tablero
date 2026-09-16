/**
 * Acciones de la papelera de elementos (purgado a los 30 días, vaciado y
 * restaurar). El asset solo se libera cuando el elemento sale del documento
 * para siempre; acá se cubre que los ids que salen sean los correctos.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { addElement, createBoardDoc, getElements, getTrashedElements, trashElements } from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';

import { emptyTrashForever, purgeExpiredTrash, restoreTrashedElements, trashedElements } from './trashActions';

const actor = { createdBy: 'user-1' };
const origin = 'test';

function sessionOf(doc: Y.Doc): BoardSession {
  return { doc, origin } as unknown as BoardSession;
}

function note(doc: Y.Doc, x = 0): string {
  return addElement(doc, 'note', { ...actor, x, y: 0 }, origin);
}

describe('trashActions', () => {
  it('lista lo que está en la papelera, del más reciente al más viejo', () => {
    const doc = createBoardDoc();
    const first = note(doc, 0);
    const second = note(doc, 100);
    trashElements(doc, [first], origin, { deletedBy: 'u', now: 1000 });
    trashElements(doc, [second], origin, { deletedBy: 'u', now: 2000 });

    const trashed = trashedElements(sessionOf(doc));
    expect(trashed.map((element) => element.id)).toEqual([second, first]);
  });
  it('purga solo lo que superó el plazo', async () => {
    const doc = createBoardDoc();
    const viejo = note(doc, 0);
    const nuevo = note(doc, 200);
    // `deletedAt` tiene que ser > 0 para que el elemento cuente como traspapelado.
    trashElements(doc, [viejo], origin, { deletedBy: 'u', now: 10_000 });
    trashElements(doc, [nuevo], origin, { deletedBy: 'u', now: 90_000 });

    const purged = await purgeExpiredTrash(sessionOf(doc), { now: 100_000, maxAgeMs: 50_000 });
    expect(purged).toEqual([viejo]);
    expect(getTrashedElements(doc).map((element) => element.id)).toEqual([nuevo]);
    // Nada quedó visible: el purgado sale para siempre y el otro sigue en la papelera.
    expect(getElements(doc)).toHaveLength(0);
  });

  it('vaciar la papelera saca los elementos del documento para siempre', async () => {
    const doc = createBoardDoc();
    const first = note(doc, 0);
    const second = note(doc, 200);
    trashElements(doc, [first, second], origin, { deletedBy: 'u' });

    const ids = await emptyTrashForever(sessionOf(doc));
    expect(ids.sort()).toEqual([first, second].sort());
    expect(getElements(doc)).toHaveLength(0);
    expect(getTrashedElements(doc)).toHaveLength(0);
  });

  it('restaurar quita la marca y devuelve el elemento al documento', () => {
    const doc = createBoardDoc();
    const id = note(doc, 0);
    trashElements(doc, [id], origin, { deletedBy: 'u' });
    expect(getElements(doc)).toHaveLength(0);

    const restored = restoreTrashedElements(sessionOf(doc), [id]);
    expect(restored).toEqual([id]);
    expect(getElements(doc).map((element) => element.id)).toEqual([id]);
  });
});

/**
 * `syncSearchIndex`: el índice se refresca en cada persistencia, así que solo
 * debe escribir lo que cambió (filas nuevas o con otro tipo/texto) y borrar lo
 * que ya no está; sin cambios, ninguna escritura.
 *
 * Prisma se dobla con un índice en memoria que cuenta las escrituras.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addElement, createBoardDoc, ensureTextFragment, removeElements, writeTextParagraphs } from '@tablero/shared';
import type * as Y from 'yjs';

type Row = { boardId: string; elementId: string; elementType: string; text: string; textNorm: string };

const db = vi.hoisted(() => {
  const rows = new Map<string, Row>();
  const calls = { upsert: [] as string[], deleteMany: 0, transactions: 0, findMany: 0 };
  const key = (boardId: string, elementId: string): string => `${boardId}:${elementId}`;

  const prisma = {
    searchIndex: {
      findMany: async ({ where }: { where: { boardId: string } }) => {
        calls.findMany += 1;
        return [...rows.values()].filter((row) => row.boardId === where.boardId).map((row) => ({ ...row }));
      },
      deleteMany: async ({ where }: { where: { boardId: string; elementId: { notIn: string[] } } }) => {
        calls.deleteMany += 1;
        let count = 0;
        for (const [id, row] of [...rows]) {
          if (row.boardId !== where.boardId || where.elementId.notIn.includes(row.elementId)) continue;
          rows.delete(id);
          count += 1;
        }
        return { count };
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { boardId_elementId: { boardId: string; elementId: string } };
        create: Row;
        update: Partial<Row>;
      }) => {
        const { boardId, elementId } = where.boardId_elementId;
        calls.upsert.push(elementId);
        const previous = rows.get(key(boardId, elementId));
        const row = previous ? { ...previous, ...update } : { ...create };
        rows.set(key(boardId, elementId), row);
        return row;
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => {
      calls.transactions += 1;
      return Promise.all(operations);
    },
  };

  return {
    prisma,
    rows,
    calls,
    reset: () => {
      rows.clear();
      calls.upsert.length = 0;
      calls.deleteMany = 0;
      calls.transactions = 0;
      calls.findMany = 0;
    },
    clearCalls: () => {
      calls.upsert.length = 0;
      calls.deleteMany = 0;
      calls.transactions = 0;
      calls.findMany = 0;
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

const { syncSearchIndex } = await import('./documents.js');

/** Nota con texto enriquecido (lo que indexa la búsqueda). */
function addNote(doc: Y.Doc, text: string): string {
  const id = addElement(doc, 'note', { createdBy: 'ana', x: 0, y: 0, width: 300 }, 'test');
  const fragment = ensureTextFragment(doc, id, 'test');
  if (fragment) writeTextParagraphs(fragment, text, 'test');
  return id;
}

function setNoteText(doc: Y.Doc, id: string, text: string): void {
  const fragment = ensureTextFragment(doc, id, 'test');
  if (!fragment) throw new Error('la nota no tiene fragmento de texto');
  fragment.delete(0, fragment.length);
  writeTextParagraphs(fragment, text, 'test');
}

beforeEach(() => {
  db.reset();
});

describe('syncSearchIndex: escrituras mínimas', () => {
  it('la primera pasada indexa todo y la segunda, sin cambios, no escribe nada', async () => {
    const doc = createBoardDoc();
    const first = addNote(doc, 'Reunión con Ana');
    const second = addNote(doc, 'Comprar pan');

    expect(await syncSearchIndex('tablero', doc)).toBe(2);
    expect(db.calls.upsert.sort()).toEqual([first, second].sort());
    expect(db.rows.get(`tablero:${first}`)).toMatchObject({ elementType: 'note', textNorm: 'reunion con ana' });

    db.clearCalls();
    expect(await syncSearchIndex('tablero', doc)).toBe(2);
    expect(db.calls.findMany).toBe(1);
    expect(db.calls.upsert).toEqual([]);
    expect(db.calls.deleteMany).toBe(0);
    expect(db.calls.transactions).toBe(0);
  });

  it('solo reescribe el elemento cuyo texto cambió', async () => {
    const doc = createBoardDoc();
    const edited = addNote(doc, 'Primera versión');
    addNote(doc, 'No se toca');
    await syncSearchIndex('tablero', doc);

    db.clearCalls();
    setNoteText(doc, edited, 'Segunda versión');
    await syncSearchIndex('tablero', doc);

    expect(db.calls.upsert).toEqual([edited]);
    expect(db.calls.deleteMany).toBe(0);
    expect(db.rows.get(`tablero:${edited}`)?.text).toBe('Segunda versión');
  });

  it('un cambio solo de mayúsculas o tildes también se reescribe (el texto visible cambió, aunque textNorm no)', async () => {
    const doc = createBoardDoc();
    const id = addNote(doc, 'reunion');
    await syncSearchIndex('tablero', doc);

    db.clearCalls();
    setNoteText(doc, id, 'Reunión');
    await syncSearchIndex('tablero', doc);

    expect(db.calls.upsert).toEqual([id]);
    expect(db.rows.get(`tablero:${id}`)).toMatchObject({ text: 'Reunión', textNorm: 'reunion' });
  });

  it('un elemento nuevo se inserta y uno borrado se elimina del índice', async () => {
    const doc = createBoardDoc();
    const keep = addNote(doc, 'Se queda');
    const gone = addNote(doc, 'Se va');
    await syncSearchIndex('tablero', doc);

    db.clearCalls();
    removeElements(doc, [gone], 'test');
    const fresh = addNote(doc, 'Recién llegada');
    await syncSearchIndex('tablero', doc);

    expect(db.calls.upsert).toEqual([fresh]);
    expect(db.calls.deleteMany).toBe(1);
    expect([...db.rows.keys()].sort()).toEqual([`tablero:${keep}`, `tablero:${fresh}`].sort());
  });

  it('si solo se borra algo, hay deleteMany y ningún upsert', async () => {
    const doc = createBoardDoc();
    addNote(doc, 'Se queda');
    const gone = addNote(doc, 'Se va');
    await syncSearchIndex('tablero', doc);

    db.clearCalls();
    removeElements(doc, [gone], 'test');
    await syncSearchIndex('tablero', doc);

    expect(db.calls.upsert).toEqual([]);
    expect(db.calls.deleteMany).toBe(1);
    expect(db.rows.size).toBe(1);
  });

  it('repara filas heredadas sin textNorm (anteriores a la búsqueda por subcadena)', async () => {
    const doc = createBoardDoc();
    const id = addNote(doc, 'Reunión');
    db.rows.set(`tablero:${id}`, { boardId: 'tablero', elementId: id, elementType: 'note', text: 'Reunión', textNorm: '' });

    await syncSearchIndex('tablero', doc);

    expect(db.calls.upsert).toEqual([id]);
    expect(db.rows.get(`tablero:${id}`)?.textNorm).toBe('reunion');
  });

  it('no mezcla tableros: el índice de otro tablero no se toca', async () => {
    const doc = createBoardDoc();
    addNote(doc, 'Mío');
    db.rows.set('otro:x', { boardId: 'otro', elementId: 'x', elementType: 'note', text: 'Ajeno', textNorm: 'ajeno' });

    await syncSearchIndex('tablero', doc);
    expect(db.rows.has('otro:x')).toBe(true);
    expect(db.calls.deleteMany).toBe(0);
  });
});

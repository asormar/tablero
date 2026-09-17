/**
 * Historial de versiones: throttle de 10 minutos, retención acotada y
 * restauración del estado persistido.
 */

import { addElement, createBoardDoc, ensureTextFragment, writeTextParagraphs } from '@tablero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

type VersionRow = {
  id: string;
  boardId: string;
  yjsState: Buffer;
  elementCount: number;
  sizeBytes: number;
  origin: string;
  createdAt: Date;
};

const db = vi.hoisted(() => {
  const versions: VersionRow[] = [];
  const documents = new Map<string, Buffer>();
  let counter = 0;

  const prisma = {
    boardVersion: {
      findFirst: async ({ where }: { where: { boardId: string } }) => {
        const found = versions
          .filter((row) => row.boardId === where.boardId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return found[0] ?? null;
      },
      findMany: async ({ where }: { where: { boardId: string } }) =>
        versions
          .filter((row) => row.boardId === where.boardId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((row) => ({ ...row })),
      create: async ({ data }: { data: Omit<VersionRow, 'id'> }) => {
        const row: VersionRow = { id: `ver_${++counter}`, ...data };
        versions.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        let count = 0;
        for (const id of where.id.in) {
          const index = versions.findIndex((row) => row.id === id);
          if (index >= 0) {
            versions.splice(index, 1);
            count += 1;
          }
        }
        return { count };
      },
    },
    boardDocument: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { boardId: string };
        create: { boardId: string; yjsState: Buffer };
        update: { yjsState: Buffer };
      }) => {
        documents.set(where.boardId, update.yjsState ?? create.yjsState);
        return { boardId: where.boardId, yjsState: documents.get(where.boardId)!, updatedAt: new Date() };
      },
    },
    searchIndex: {
      deleteMany: async () => ({ count: 0 }),
      upsert: async () => ({}),
    },
    $transaction: async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
  };

  return {
    prisma,
    versions,
    documents,
    reset: () => {
      versions.length = 0;
      documents.clear();
      counter = 0;
    },
    seedVersion: (row: Partial<VersionRow> & { boardId: string; createdAt: Date }) => {
      const full: VersionRow = {
        id: row.id ?? `ver_seed_${++counter}`,
        boardId: row.boardId,
        yjsState: row.yjsState ?? Buffer.from(''),
        elementCount: row.elementCount ?? 0,
        sizeBytes: row.sizeBytes ?? 0,
        origin: row.origin ?? 'auto',
        createdAt: row.createdAt,
      };
      versions.push(full);
      return full;
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

const { VERSION_INTERVAL_MS, applyVersion, listVersions, pruneVersions, recordVersion, snapshotDocument, toVersionSummary } =
  await import('./versions.js');

function docWithNote(text: string): YDocLike {
  const doc = createBoardDoc();
  const id = addElement(doc, 'note', { createdBy: 'ana', x: 10, y: 20 }, 'test');
  const fragment = ensureTextFragment(doc, id, 'test');
  if (fragment) writeTextParagraphs(fragment, text, 'test');
  return { doc, state: Y.encodeStateAsUpdate(doc) };
}

type YDoc = ReturnType<typeof createBoardDoc>;
type YDocLike = { doc: YDoc; state: Uint8Array };

beforeEach(() => {
  db.reset();
});

describe('recordVersion', () => {
  it('crea la primera instantánea y aplica el throttle de 10 minutos', async () => {
    const start = new Date('2026-09-17T12:00:00Z');
    const state = Buffer.from('estado');

    const first = await recordVersion({ boardId: 'b1', state, elementCount: 1, origin: 'auto', now: start });
    expect(first).not.toBeNull();

    const tooSoon = await recordVersion({
      boardId: 'b1',
      state,
      elementCount: 1,
      origin: 'auto',
      now: new Date(start.getTime() + VERSION_INTERVAL_MS - 1_000),
    });
    expect(tooSoon).toBeNull();

    const later = await recordVersion({
      boardId: 'b1',
      state,
      elementCount: 1,
      origin: 'auto',
      now: new Date(start.getTime() + VERSION_INTERVAL_MS + 1_000),
    });
    expect(later).not.toBeNull();
    expect(db.versions).toHaveLength(2);
  });

  it('`force` (instantánea manual) ignora el throttle', async () => {
    const now = new Date('2026-09-17T12:00:00Z');
    await recordVersion({ boardId: 'b1', state: Buffer.from('a'), elementCount: 0, origin: 'auto', now });
    const forced = await recordVersion({ boardId: 'b1', state: Buffer.from('b'), elementCount: 0, origin: 'manual', now, force: true });
    expect(forced?.origin).toBe('manual');
    expect(db.versions).toHaveLength(2);
  });

  it('cada tablero tiene su propio intervalo', async () => {
    const now = new Date('2026-09-17T12:00:00Z');
    await recordVersion({ boardId: 'b1', state: Buffer.from('a'), elementCount: 0, origin: 'auto', now });
    const other = await recordVersion({ boardId: 'b2', state: Buffer.from('b'), elementCount: 0, origin: 'auto', now });
    expect(other).not.toBeNull();
  });
});

describe('pruneVersions', () => {
  it('conserva las últimas 50 y una por día para lo más viejo (hasta 30 días)', async () => {
    const now = new Date('2026-09-17T12:00:00Z');
    for (let index = 0; index < 50; index += 1) {
      db.seedVersion({ boardId: 'b1', createdAt: new Date(now.getTime() - index * 60_000) });
    }
    // Dos del mismo día, diez días atrás: se conserva una.
    db.seedVersion({ boardId: 'b1', createdAt: new Date(now.getTime() - 10 * 24 * 3600_000) });
    db.seedVersion({ boardId: 'b1', createdAt: new Date(now.getTime() - 10 * 24 * 3600_000 - 60_000) });
    // Dos de hace 40 días: fuera del alcance de la retención.
    db.seedVersion({ boardId: 'b1', createdAt: new Date(now.getTime() - 40 * 24 * 3600_000) });
    db.seedVersion({ boardId: 'b1', createdAt: new Date(now.getTime() - 41 * 24 * 3600_000) });

    const deleted = await pruneVersions('b1', now);
    expect(deleted).toBe(3);
    expect(db.versions).toHaveLength(51);
  });

  it('no borra nada por debajo del tope', async () => {
    const now = new Date('2026-09-17T12:00:00Z');
    for (let index = 0; index < 10; index += 1) {
      db.seedVersion({ boardId: 'b1', createdAt: new Date(now.getTime() - index * 60_000) });
    }
    expect(await pruneVersions('b1', now)).toBe(0);
  });
});

describe('applyVersion', () => {
  it('sustituye el estado persistido y reindexa los elementos restaurados', async () => {
    const older = docWithNote('versión vieja');
    const newer = docWithNote('versión nueva');
    const version = db.seedVersion({ boardId: 'b1', createdAt: new Date(), yjsState: Buffer.from(older.state) });
    db.documents.set('b1', Buffer.from(newer.state));

    const result = await applyVersion('b1', version);
    expect(result.elements).toBe(1);
    expect(db.documents.get('b1')).toEqual(Buffer.from(older.state));
  });
});

describe('snapshotDocument', () => {
  it('cuenta los elementos del documento vivo', async () => {
    const { doc } = docWithNote('hola');
    const snapshot = await snapshotDocument('b1', doc, 'manual');
    expect(snapshot?.elementCount).toBe(1);
    expect(snapshot?.origin).toBe('manual');
    expect(snapshot?.sizeBytes).toBeGreaterThan(0);
  });
});

describe('listado', () => {
  it('devuelve las versiones más nuevas primero con su resumen', async () => {
    const state = docWithNote('hola').state;
    db.seedVersion({ boardId: 'b1', createdAt: new Date('2026-09-17T10:00:00Z'), yjsState: Buffer.from(state), elementCount: 1 });
    db.seedVersion({ boardId: 'b1', createdAt: new Date('2026-09-17T11:00:00Z'), yjsState: Buffer.from(state), elementCount: 2 });
    const list = await listVersions('b1');
    expect(list.map((version) => version.elementCount)).toEqual([2, 1]);
    expect(toVersionSummary({ ...db.versions[1]! })).toMatchObject({ boardId: 'b1', origin: 'auto' });
  });
});

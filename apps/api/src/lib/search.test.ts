/**
 * Búsqueda: helpers de fragmento y `searchAll` agrupado, con posiciones.
 * La base se dobla con un Prisma en memoria; `$queryRaw` devuelve las filas que
 * el test define (el SQL real se ejercita en el humo contra Postgres).
 */

import { addElement, createBoardDoc, ensureTextFragment, writeTextParagraphs } from '@tablero/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const db = vi.hoisted(() => {
  type RawRow = {
    boardId: string;
    elementId: string;
    elementType: string;
    text: string;
    rank: number | null;
    headline: string | null;
  };
  const boards = [
    {
      id: 'board_uno',
      ownerId: 'user_ana',
      parentBoardId: null,
      title: 'Reuniones del equipo',
      icon: '📋',
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      trashedAt: null,
      favoriteAt: null,
      isUnsorted: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: 'board_dos',
      ownerId: 'user_ana',
      parentBoardId: 'board_uno',
      title: 'Notas sueltas',
      icon: null,
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      trashedAt: null,
      favoriteAt: null,
      isUnsorted: false,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    },
    {
      id: 'board_ajeno',
      ownerId: 'user_beto',
      parentBoardId: null,
      title: 'No es mío',
      icon: null,
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      trashedAt: null,
      favoriteAt: null,
      isUnsorted: false,
      createdAt: new Date('2026-01-03T00:00:00Z'),
      updatedAt: new Date('2026-01-03T00:00:00Z'),
    },
  ];
  const documents = new Map<string, Buffer>();
  let rawRows: RawRow[] = [];
  let lastSql: unknown = null;

  const prisma = {
    board: {
      findMany: async (
        { where }: { where?: { id?: { in: string[] }; title?: { contains: string; mode: string } } } = {},
      ) => {
        let rows = boards;
        if (where?.id) rows = rows.filter((board) => where.id!.in.includes(board.id));
        if (where?.title) {
          rows = rows.filter((board) => board.title.toLowerCase().includes(where.title!.contains.toLowerCase()));
        }
        return rows.map((row) => ({ ...row }));
      },
    },
    boardMember: { findMany: async () => [] },
    boardDocument: {
      findMany: async ({ where }: { where: { boardId: { in: string[] } } }) =>
        where.boardId.in
          .filter((boardId) => documents.has(boardId))
          .map((boardId) => ({ boardId, yjsState: documents.get(boardId)!, updatedAt: new Date() })),
    },
    $queryRaw: async (sql: unknown) => {
      lastSql = sql;
      return rawRows;
    },
  };

  return {
    prisma,
    boards,
    documents,
    setRows: (rows: RawRow[]) => {
      rawRows = rows;
    },
    getLastSql: () => lastSql,
    reset: () => {
      documents.clear();
      rawRows = [];
      lastSql = null;
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

const { buildSnippet, findAccentInsensitive, searchAll, splitHeadline } = await import('./search.js');

beforeEach(() => {
  db.reset();
});

describe('findAccentInsensitive', () => {
  it('encuentra ignorando mayúsculas y diacríticos y devuelve índices del original', () => {
    const text = 'La reunión de diseño fue larga';
    const match = findAccentInsensitive(text, 'reunion');
    expect(match).not.toBeNull();
    expect(text.slice(match!.start, match!.end)).toBe('reunión');
  });

  it('colapsa los espacios al comparar', () => {
    expect(findAccentInsensitive('hola    mundo', 'hola mundo')).not.toBeNull();
    expect(findAccentInsensitive('hola mundo', 'chau')).toBeNull();
  });
});

describe('buildSnippet', () => {
  it('recorta alrededor de la coincidencia y la marca', () => {
    const text = `${'x'.repeat(200)} contexto reunión del equipo ${'y'.repeat(200)}`;
    const { snippet, headline } = buildSnippet(text, 'reunion');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('reunión');
    expect(headline).toContain('<mark>reunión</mark>');
  });

  it('escapa el HTML del texto del usuario en el headline', () => {
    const { headline } = buildSnippet('nota con <script>alert(1)</script> y reunión', 'reunion');
    expect(headline).not.toContain('<script>');
    expect(headline).toContain('&lt;script&gt;');
    expect(headline).toContain('<mark>reunión</mark>');
  });

  it('sin coincidencia devuelve el principio del texto', () => {
    const { snippet, headline } = buildSnippet('texto sin nada', 'otra');
    expect(snippet).toBe('texto sin nada');
    expect(headline).toBe('texto sin nada');
  });
});

describe('splitHeadline', () => {
  it('convierte las marcas internas de ts_headline en <mark> y escapa el resto', () => {
    const raw = `antes \u0001reunión\u0002 después <b>`;
    const { snippet, headline } = splitHeadline(raw);
    expect(snippet).toBe('antes reunión después <b>');
    expect(headline).toBe('antes <mark>reunión</mark> después &lt;b&gt;');
  });
});

describe('searchAll', () => {
  it('agrupa por tablero, resalta el fragmento y resuelve la posición del elemento', async () => {
    const doc = createBoardDoc();
    const noteId = addElement(doc, 'note', { createdBy: 'ana', x: 320, y: 480, width: 300 }, 'test');
    const fragment = ensureTextFragment(doc, noteId, 'test');
    if (fragment) writeTextParagraphs(fragment, 'Reunión de diseño el jueves', 'test');
    db.documents.set('board_uno', Buffer.from(Y.encodeStateAsUpdate(doc)));

    db.setRows([
      {
        boardId: 'board_uno',
        elementId: noteId,
        elementType: 'note',
        text: 'Reunión de diseño el jueves',
        rank: 0.6,
        headline: 'Reunión de diseño el jueves',
      },
      {
        boardId: 'board_dos',
        elementId: 'el_ajeno',
        elementType: 'note',
        text: 'reunion de otro tablero',
        rank: 0.1,
        headline: null,
      },
    ]);

    const result = await searchAll('user_ana', 'reunion', { limit: 30 });

    expect(result.total).toBe(3); // 2 elementos + 1 título («Reuniones del equipo»)
    expect(result.groups.map((group) => group.boardId)).toEqual(['board_uno', 'board_dos']);

    const titleHit = result.results.find((hit) => hit.kind === 'board-title');
    expect(titleHit?.boardTitle).toBe('Reuniones del equipo');
    expect(titleHit?.position).toBeNull();

    const elementHit = result.results.find((hit) => hit.elementId === noteId);
    expect(elementHit?.headline).toContain('<mark>');
    expect(elementHit?.position).toMatchObject({ x: 320, y: 480, width: 300 });
    expect(result.groups[0]!.boardIcon).toBe('📋');
  });

  it('la posición de un hijo de columna es la de la columna', async () => {
    const doc = createBoardDoc();
    const columnId = addElement(doc, 'column', { createdBy: 'ana', x: 700, y: 120, width: 300, title: 'En curso' }, 'test');
    const childId = addElement(
      doc,
      'note',
      { createdBy: 'ana', x: 700, y: 400, width: 280, parentId: columnId },
      'test',
    );
    db.documents.set('board_uno', Buffer.from(Y.encodeStateAsUpdate(doc)));
    db.setRows([
      { boardId: 'board_uno', elementId: childId, elementType: 'note', text: 'tarea en curso', rank: 0.2, headline: null },
    ]);

    const result = await searchAll('user_ana', 'en curso', { limit: 30 });
    const hit = result.results.find((item) => item.elementId === childId);
    expect(hit?.position).toMatchObject({ x: 700, y: 120, parentId: columnId });
  });

  it('con `boardId` recorta el alcance y un tablero ajeno da 404', async () => {
    db.setRows([]);
    const own = await searchAll('user_ana', 'reunion', { boardId: 'board_dos', limit: 30 });
    expect(own.groups).toHaveLength(0);
    expect(own.total).toBe(0);

    await expect(searchAll('user_ana', 'reunion', { boardId: 'board_ajeno', limit: 30 })).rejects.toThrow(/no existe o no tenés acceso/);
  });
});

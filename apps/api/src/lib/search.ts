/**
 * Búsqueda global (§7.2 del plan): títulos de tableros + texto de elementos.
 *
 * El texto de los elementos sale de `SearchIndex`, que se refresca al persistir
 * cada documento Yjs (`syncSearchIndex`). La consulta combina dos caminos:
 *
 *   1. `tsvector` (columna generada, índice GIN) con `websearch_to_tsquery` y
 *      `ts_headline`: da el ranking y el fragmento con el contexto real.
 *   2. `textNorm` (minúsculas, sin diacríticos) con `LIKE`: cubre las
 *      subcadenas y los acentos omitidos (`reunion` → «Reunión»).
 *
 * El resultado viene agrupado por tablero, con el fragmento resaltado
 * (`headline`, con `<mark>`) y la **posición** de cada elemento en el lienzo
 * para que el cliente pueda centrarlo. La posición no está en el índice: se
 * resuelve del documento Yjs persistido, solo para los tableros que aparecen en
 * los resultados.
 */

import { Prisma } from '@prisma/client';
import { elementRect, fallbackHeight, getElement, type CanvasElement } from '@tablero/shared';

import { prisma } from '../db.js';
import { loadBoardAccess, type BoardAccess } from './boards.js';
import { decodeState, normalizeSearchText } from './documents.js';
import { notFound } from './errors.js';

/** Marcas de `ts_headline`: caracteres de control, imposibles en el texto. */
const MARK_START = '\u0001';
const MARK_END = '\u0002';

export type ElementPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Columna que contiene al elemento (la posición devuelta es la de ella). */
  parentId: string | null;
};

export type SearchHit = {
  boardId: string;
  boardTitle: string;
  elementId: string;
  elementType: string;
  /** `classic`: elemento del lienzo (incluye tarjetas de tablero). */
  kind: 'element' | 'board-title';
  /** Fragmento en texto plano, con `…` y sin marcas. */
  snippet: string;
  /** El mismo fragmento con `<mark>…</mark>` alrededor de las coincidencias. */
  headline: string;
  position: ElementPosition | null;
  rank: number;
};

export type SearchGroup = {
  boardId: string;
  boardTitle: string;
  boardIcon: string | null;
  hits: SearchHit[];
};

export type SearchResult = { total: number; groups: SearchGroup[]; results: SearchHit[] };

export type SearchOptions = {
  type?: string | undefined;
  boardId?: string | undefined;
  limit: number;
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Posición de la aguja dentro del texto ignorando mayúsculas y diacríticos,
 * devolviendo índices del texto original (para poder cortar el fragmento).
 */
export function findAccentInsensitive(text: string, needle: string): { start: number; end: number } | null {
  if (needle.length === 0) return null;
  const chars: string[] = [];
  const map: number[] = [];
  let previousSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const folded = text[index]!.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const character of folded) {
      const isSpace = /\s/.test(character);
      if (isSpace && previousSpace) continue;
      chars.push(isSpace ? ' ' : character);
      map.push(index);
      previousSpace = isSpace;
    }
  }
  const haystack = chars.join('');
  const found = haystack.indexOf(needle);
  if (found < 0) return null;
  const lastIndex = Math.min(found + needle.length - 1, map.length - 1);
  return { start: map[found]!, end: map[lastIndex]! + 1 };
}

const SNIPPET_RADIUS = 70;

/** Fragmento en texto plano + versión con `<mark>` (para el respaldo por LIKE). */
export function buildSnippet(text: string, query: string, radius = SNIPPET_RADIUS): { snippet: string; headline: string } {
  const match = findAccentInsensitive(text, normalizeSearchText(query));
  if (!match) {
    const plain = text.slice(0, radius * 2).trim();
    return { snippet: plain, headline: escapeHtml(plain) };
  }
  const start = Math.max(0, match.start - radius);
  const end = Math.min(text.length, match.end + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const snippet = `${prefix}${text.slice(start, end).trim()}${suffix}`;
  const headline = `${prefix}${escapeHtml(text.slice(start, match.start))}<mark>${escapeHtml(
    text.slice(match.start, match.end),
  )}</mark>${escapeHtml(text.slice(match.end, end))}${suffix}`;
  return { snippet, headline };
}

/** `ts_headline` trae el fragmento con las marcas internas: se separa y se escapa. */
export function splitHeadline(headline: string): { snippet: string; headline: string } {
  const plain = headline.split(MARK_START).join('').split(MARK_END).join('');
  const parts = headline.split(new RegExp(`[${MARK_START}${MARK_END}]`));
  const html = parts
    .map((part, index) => {
      const escaped = escapeHtml(part);
      if (index === 0) return escaped;
      return index % 2 === 1 ? `<mark>${escaped}` : `</mark>${escaped}`;
    })
    .join('');
  return { snippet: plain.trim(), headline: html.trim() };
}

type RawElementHit = {
  boardId: string;
  elementId: string;
  elementType: string;
  text: string;
  rank: number | null;
  headline: string | null;
};

/** Filas del índice que coinciden, con ranking y fragmento. */
async function queryIndex(
  scopeIds: string[],
  q: string,
  normalized: string,
  options: { type?: string | undefined; limit: number },
): Promise<RawElementHit[]> {
  if (scopeIds.length === 0) return [];
  const typeClause = options.type ? Prisma.sql`AND s."elementType" = ${options.type}` : Prisma.empty;
  return prisma.$queryRaw<RawElementHit[]>(Prisma.sql`
    WITH q AS (SELECT websearch_to_tsquery('spanish', ${q}) AS tsq)
    SELECT s."boardId", s."elementId", s."elementType", s."text",
           ts_rank(s."tsv", q.tsq) AS rank,
           CASE
             WHEN s."tsv" @@ q.tsq THEN ts_headline(
               'spanish', s."text", q.tsq,
               ${`StartSel=${MARK_START}, StopSel=${MARK_END}, MaxWords=26, MinWords=8, MaxFragments=2, FragmentDelimiter=" … "`}
             )
           END AS headline
    FROM "SearchIndex" s, q
    WHERE s."boardId" IN (${Prisma.join(scopeIds)})
      AND (s."tsv" @@ q.tsq OR s."textNorm" LIKE ${`%${escapeLike(normalized)}%`})
      ${typeClause}
    ORDER BY (s."tsv" @@ q.tsq) DESC, rank DESC, s."actualizadoEn" DESC
    LIMIT ${options.limit}
  `);
}

/** Posición en el lienzo de cada elemento de los tableros indicados. */
async function resolvePositions(
  wanted: Map<string, Set<string>>,
): Promise<Map<string, ElementPosition>> {
  const positions = new Map<string, ElementPosition>();
  const boardIds = [...wanted.keys()];
  if (boardIds.length === 0) return positions;
  const rows = await prisma.boardDocument.findMany({ where: { boardId: { in: boardIds } } });
  for (const row of rows) {
    const ids = wanted.get(row.boardId);
    if (!ids || ids.size === 0) continue;
    let doc;
    try {
      doc = decodeState(new Uint8Array(row.yjsState));
    } catch {
      continue; // Estado ilegible: se devuelve sin posición.
    }
    for (const elementId of ids) {
      const element: CanvasElement | null = getElement(doc, elementId);
      if (!element) continue;
      positions.set(`${row.boardId}:${elementId}`, positionOf(doc, element));
    }
  }
  return positions;
}

/** La posición de un hijo de columna es la de la columna (los hijos se apilan). */
function positionOf(doc: ReturnType<typeof decodeState>, element: CanvasElement): ElementPosition {
  if (element.parentId) {
    const parent = getElement(doc, element.parentId);
    if (parent && parent.type === 'column') {
      const rect = elementRect(parent);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, parentId: parent.id };
    }
  }
  const rect = elementRect(element, element.height ?? fallbackHeight(element.type));
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: element.height ?? fallbackHeight(element.type),
    parentId: element.parentId ?? null,
  };
}

/** Títulos de tablero que coinciden (el título vive en Postgres, no en el índice). */
async function queryTitles(scopeIds: string[], q: string, limit: number): Promise<SearchHit[]> {
  if (scopeIds.length === 0) return [];
  const matches = await prisma.board.findMany({
    where: { id: { in: scopeIds }, title: { contains: q, mode: 'insensitive' } },
    select: { id: true, title: true },
    take: limit,
  });
  return matches.map((match) => {
    const { snippet, headline } = buildSnippet(match.title, q);
    return {
      boardId: match.id,
      boardTitle: match.title,
      elementId: match.id,
      elementType: 'board',
      kind: 'board-title' as const,
      snippet,
      headline,
      position: null,
      rank: 1,
    };
  });
}

/**
 * Búsqueda completa: títulos + elementos, agrupada por tablero.
 * `type` filtra por tipo de elemento (los títulos de tablero solo aparecen sin
 * filtro o con `type=board`, igual que en la fase 3).
 */
export async function searchAll(userId: string, query: string, options: SearchOptions): Promise<SearchResult> {
  const access = await loadBoardAccess(userId);
  const { type, boardId, limit } = options;

  let scope = access.accessible({ atLeastEditor: false });
  if (boardId) {
    // Un tablero inaccesible no es «cero resultados»: es un 404, igual que en
    // el resto de la API.
    if (!access.roleOf(boardId)) throw notFound('El tablero no existe o no tenés acceso');
    scope = scope.filter((board) => board.id === boardId);
  }
  const scopeIds = scope.map((board) => board.id);
  const boardById = new Map(access.boards.map((board) => [board.id, board]));
  const normalized = normalizeSearchText(query);

  const hits: SearchHit[] = [];
  if (!type || type === 'board') {
    hits.push(...(await queryTitles(scopeIds, query, limit)));
  }

  const rows = await queryIndex(scopeIds, query, normalized, { type, limit });
  const wanted = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = wanted.get(row.boardId) ?? new Set<string>();
    set.add(row.elementId);
    wanted.set(row.boardId, set);
  }
  const positions = await resolvePositions(wanted);

  for (const row of rows) {
    const board = boardById.get(row.boardId);
    const fragment = row.headline ? splitHeadline(row.headline) : buildSnippet(row.text, query);
    hits.push({
      boardId: row.boardId,
      boardTitle: board?.title ?? '',
      elementId: row.elementId,
      elementType: row.elementType,
      kind: 'element',
      snippet: fragment.snippet,
      headline: fragment.headline,
      position: positions.get(`${row.boardId}:${row.elementId}`) ?? null,
      rank: typeof row.rank === 'number' ? row.rank : 0,
    });
  }

  // Se agrupa sobre los resultados ya recortados al límite: el orden del grupo
  // es el de su primera coincidencia (títulos primero, después por ranking).
  const results = hits.slice(0, limit);
  const grouped = new Map<string, SearchGroup>();
  for (const hit of results) {
    const group = grouped.get(hit.boardId) ?? {
      boardId: hit.boardId,
      boardTitle: hit.boardTitle,
      boardIcon: boardById.get(hit.boardId)?.icon ?? null,
      hits: [],
    };
    group.hits.push(hit);
    grouped.set(hit.boardId, group);
  }

  return { total: hits.length, groups: [...grouped.values()], results };
}

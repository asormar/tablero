/**
 * GET /api/search — títulos de tableros + texto de elementos.
 *
 * Los títulos salen de la tabla `Board` (relacional) y el resto de
 * `SearchIndex`, que se refresca al persistir cada documento Yjs. La consulta
 * es ILIKE (`contains` + `mode: 'insensitive'`); la columna queda lista para
 * migrar a `tsvector` + índice GIN sin cambiar el contrato de la ruta.
 */

import type { FastifyInstance } from 'fastify';
import { searchQuerySchema } from '@tablero/shared';

import { prisma } from '../db.js';
import { loadBoardAccess } from '../lib/boards.js';
import { notFound } from '../lib/errors.js';
import { currentUser } from '../lib/session.js';

export type SearchHit = {
  boardId: string;
  boardTitle: string;
  elementId: string;
  elementType: string;
  snippet: string;
};

const SNIPPET_RADIUS = 70;

function snippet(text: string, query: string): string {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index < 0) return text.slice(0, SNIPPET_RADIUS * 2).trim();
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + needle.length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/search', async (request) => {
    const user = currentUser(request);
    const query = searchQuerySchema.parse(request.query ?? {});
    const access = await loadBoardAccess(user.id);

    let scope = access.accessible();
    if (query.boardId) {
      if (!access.roleOf(query.boardId)) throw notFound('El tablero no existe o no tenés acceso');
      scope = scope.filter((board) => board.id === query.boardId);
    }
    const scopeIds = scope.map((board) => board.id);
    const titles = new Map(access.boards.map((board) => [board.id, board.title]));
    const hits: SearchHit[] = [];

    // 1) Títulos de tableros.
    if (!query.type || query.type === 'board') {
      const matches = await prisma.board.findMany({
        where: { id: { in: scopeIds }, title: { contains: query.q, mode: 'insensitive' } },
        select: { id: true, title: true },
        take: query.limit,
      });
      for (const match of matches) {
        hits.push({
          boardId: match.id,
          boardTitle: match.title,
          elementId: match.id,
          elementType: 'board',
          snippet: match.title,
        });
      }
    }

    // 2) Texto de elementos indexado.
    const indexQuery =
      query.type && query.type !== 'board'
        ? { boardId: { in: scopeIds }, elementType: query.type, text: { contains: query.q, mode: 'insensitive' as const } }
        : query.type === 'board'
          ? null
          : { boardId: { in: scopeIds }, text: { contains: query.q, mode: 'insensitive' as const } };

    if (indexQuery) {
      const rows = await prisma.searchIndex.findMany({
        where: indexQuery,
        orderBy: { actualizadoEn: 'desc' },
        take: query.limit,
      });
      for (const row of rows) {
        hits.push({
          boardId: row.boardId,
          boardTitle: titles.get(row.boardId) ?? '',
          elementId: row.elementId,
          elementType: row.elementType,
          snippet: snippet(row.text, query.q),
        });
      }
    }

    return { query: query.q, results: hits.slice(0, query.limit) };
  });
}

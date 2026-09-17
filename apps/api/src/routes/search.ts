/**
 * Rutas de búsqueda.
 *
 *   GET  /api/search?q=&type=&boardId=&limit=   → resultados agrupados por tablero
 *   POST /api/search/reindex                    → reconstruye el índice
 *
 * El índice lo escribe el servidor (hook de persistencia de Hocuspocus); el
 * cliente no indexa nada. `reindex` existe para rellenar lo que ya existía
 * antes de la fase 4 y para reparar un índice desincronizado.
 */

import type { FastifyInstance } from 'fastify';
import { idSchema, searchQuerySchema } from '@tablero/shared';
import { z } from 'zod';

import { prisma } from '../db.js';
import { loadBoardAccess, type BoardRecord } from '../lib/boards.js';
import { reindexBoard } from '../lib/documents.js';
import { forbidden, notFound } from '../lib/errors.js';
import { searchAll } from '../lib/search.js';
import { currentUser } from '../lib/session.js';

const reindexSchema = z.object({ boardId: idSchema.optional() });

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/search', async (request) => {
    const user = currentUser(request);
    const query = searchQuerySchema.parse(request.query ?? {});
    const result = await searchAll(user.id, query.q, {
      type: query.type,
      boardId: query.boardId,
      limit: query.limit,
    });
    return { query: query.q, limit: query.limit, ...result };
  });

  /**
   * Reindexado completo desde el estado persistido de cada documento.
   * Un reindexado parcial (`boardId`) exige rol de editor en ese tablero.
   */
  app.post('/search/reindex', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = currentUser(request);
    const input = reindexSchema.parse(request.body ?? {});
    const access = await loadBoardAccess(user.id);

    let boards: BoardRecord[];
    if (input.boardId) {
      const record = access.get(input.boardId);
      if (!record) throw notFound('El tablero no existe o no tenés acceso');
      if (!access.canEdit(record.id)) throw forbidden('Necesitás rol de editor en este tablero', 'forbidden_role');
      boards = [record];
    } else {
      boards = access.accessible({ atLeastEditor: true });
    }

    let indexed = 0;
    let skipped = 0;
    for (const board of boards) {
      const elements = await reindexBoard(board.id);
      if (elements === null) skipped += 1;
      else indexed += elements;
    }
    return { ok: true, boards: boards.length, elements: indexed, skipped };
  });
}

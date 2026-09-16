/** GET /api/tasks — tareas derivadas de los elementos `todo` del documento Yjs. */

import type { FastifyInstance } from 'fastify';
import { tasksQuerySchema } from '@tablero/shared';

import { loadBoardAccess } from '../lib/boards.js';
import { notFound } from '../lib/errors.js';
import { currentUser } from '../lib/session.js';
import { collectTasks } from '../lib/tasks.js';

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tasks', async (request) => {
    const user = currentUser(request);
    const query = tasksQuerySchema.parse(request.query ?? {});
    const access = await loadBoardAccess(user.id);

    let boards = access.accessible();
    if (query.boardId) {
      if (!access.roleOf(query.boardId)) throw notFound('El tablero no existe o no tenés acceso');
      boards = boards.filter((board) => board.id === query.boardId);
    }

    const tasks = await collectTasks(
      boards.map((board) => ({ id: board.id, title: board.title })),
      query.filter,
      query.limit,
    );
    return { filter: query.filter, tasks };
  });
}

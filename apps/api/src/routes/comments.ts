/**
 * Comentarios (fase 5).
 *
 *   GET    /api/boards/:id/comments            filas planas (raíz y respuestas) y anclaje
 *   PATCH  /api/comments/:id/resolve           resolver (o reabrir) el hilo
 *   DELETE /api/comments/:id                   borrar el propio (o cualquiera si sos el dueño)
 *
 * Los comentarios se **crean en el documento** (el cliente usa los ayudantes de
 * `@tablero/shared`, en `doc.getMap('comments')`), así el tiempo real sale
 * gratis; acá se listan los ya extraídos y se aplican las mutaciones al
 * documento (vivo si hay servidor de colaboración, persistido si no) y a la tabla.
 *
 * La respuesta del listado es la **forma plana** que espera la web (su
 * `parseComment`): `parentCommentId` (que la web mapea a `parentId`), `body`,
 * `authorId`, `authorName`, `createdAt`, `elementId`, `x`, `y`, `resolvedAt`,
 * `resolvedBy` y `mentions`.
 */

import type { FastifyInstance } from 'fastify';
import { commentResolveSchema, commentsQuerySchema, idSchema } from '@tablero/shared';
import { z } from 'zod';

import { prisma } from '../db.js';
import { requireBoardAccess, requireBoardCommenter, resolveBoardAccess } from '../lib/access.js';
import {
  listBoardComments,
  mutateCommentDocument,
  syncCommentsFromBoard,
  type CommentRowTarget,
} from '../lib/comments.js';
import { forbidden, notFound } from '../lib/errors.js';
import { touchPresence } from '../lib/presence.js';
import { currentUser } from '../lib/session.js';

const boardParamsSchema = z.object({ id: idSchema });
const commentParamsSchema = z.object({ id: idSchema });

export async function commentsRoutes(app: FastifyInstance): Promise<void> {
  /** Comentarios del tablero. Sincroniza el documento antes de listar. */
  app.get('/boards/:id/comments', async (request) => {
    const user = currentUser(request);
    const { id } = boardParamsSchema.parse(request.params);
    const query = commentsQuerySchema.parse(request.query ?? {});
    const resolution = await resolveBoardAccess(user.id, id);
    const { role } = requireBoardAccess(resolution, 'viewer');
    touchPresence(id, { userId: user.id, name: user.name, avatarUrl: user.avatarUrl, role });

    const sync = await syncCommentsFromBoard(id);
    const comments = await listBoardComments(id, { filter: query.filter, elementId: query.elementId });
    const open = comments.filter((comment) => comment.parentCommentId === null && comment.resolvedAt === null).length;
    return {
      comments,
      open,
      resolved: comments.filter((comment) => comment.parentCommentId === null && comment.resolvedAt !== null).length,
      synced: sync,
    };
  });

  /**
   * Resolver o reabrir un hilo. Puede cualquiera que pueda comentar; el cambio
   * se aplica al documento (es la fuente de verdad) y a la tabla.
   */
  app.patch('/comments/:id/resolve', async (request) => {
    const user = currentUser(request);
    const { id } = commentParamsSchema.parse(request.params);
    const input = commentResolveSchema.parse(request.body ?? {});
    const target = await requireCommentRow(id);
    const resolution = await resolveBoardAccess(user.id, target.boardId);
    requireBoardCommenter(resolution);

    const mutation = input.resolved === false ? 'reopen' : 'resolve';
    const result = await mutateCommentDocument(target.boardId, target, mutation, { by: user.id });
    const comments = await listBoardComments(target.boardId, { filter: 'all' });
    const row = comments.find((comment) => comment.id === (target.parentCommentId ?? target.id)) ?? null;
    return { ok: true, ...result, comment: row };
  });

  /** Borrar: el autor o el dueño del tablero. La raíz cae con el hilo completo. */
  app.delete('/comments/:id', async (request) => {
    const user = currentUser(request);
    const { id } = commentParamsSchema.parse(request.params);
    const target = await requireCommentRow(id);
    const resolution = await resolveBoardAccess(user.id, target.boardId);
    const { role } = requireBoardAccess(resolution, 'viewer');
    if (target.authorId !== user.id && role !== 'owner') {
      throw forbidden('Solo el autor (o el dueño del tablero) puede borrar este comentario', 'forbidden_comment');
    }

    const result = await mutateCommentDocument(target.boardId, target, 'delete', { by: user.id });
    return { ok: true, ...result, comments: await listBoardComments(target.boardId, { filter: 'all' }) };
  });
}

/** Fila de comentario o 404 (el id puede ser de una raíz o de una respuesta). */
async function requireCommentRow(id: string): Promise<CommentRowTarget> {
  const row = await prisma.comment.findUnique({
    where: { id },
    select: { id: true, boardId: true, elementId: true, parentCommentId: true, authorId: true },
  });
  if (!row) throw notFound('El comentario no existe', 'comment_not_found');
  return row;
}

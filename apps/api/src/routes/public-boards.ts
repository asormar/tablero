/**
 * Publicación de tableros (fase 5).
 *
 *   GET    /api/boards/:id/publish          estado de la publicación (dueño)
 *   POST   /api/boards/:id/publish          publicar / actualizar (dueño)
 *   DELETE /api/boards/:id/publish          despublicar (dueño)
 *   GET    /api/public/boards/:slug         resumen público (sin sesión)
 *   GET    /api/public/boards/:slug/document  documento saneado + assets firmados
 *
 * Las rutas públicas van **fuera del scope con sesión**, mandan `noindex` y no
 * filtran nada privado: ni emails, ni miembros, ni los hilos de comentario (que
 * viven en el documento y se recortan del estado que se sirve). La contraseña
 * opcional se comprueba con argon2 y los intentos están limitados por slug+IP.
 */

import type { FastifyInstance } from 'fastify';
import { idSchema, publishBoardSchema, publicBoardQuerySchema, publicDocumentQuerySchema } from '@tablero/shared';
import { z } from 'zod';

import { prisma } from '../db.js';
import { requireBoardAccess, resolveBoardAccess } from '../lib/access.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import {
  checkPublicPassword,
  findPublishedBoard,
  publicAssetObject,
  publicBoardDocument,
  publicBoardSummary,
  publicBoardUrl,
  publishBoard,
  resolvePublicTarget,
  unpublishBoard,
  verifyPublicAssetToken,
  type PublishedBoard,
} from '../lib/public-boards.js';
import { currentUser } from '../lib/session.js';

const boardParamsSchema = z.object({ id: idSchema });
const slugParamsSchema = z.object({ slug: z.string().min(4).max(64) });
const publicAssetParamsSchema = z.object({ assetId: idSchema });
const publicAssetQuerySchema = z.object({
  token: z.string().min(10).max(400),
  variant: z.enum(['raw', 'thumb']).optional(),
});

/** `noindex` en todo lo público: el enlace no debe aparecer en buscadores. */
function noindex(reply: { header: (name: string, value: string) => unknown }): void {
  reply.header('x-robots-tag', 'noindex, nofollow, noarchive');
  reply.header('cache-control', 'no-store');
}

/** Límite de intentos de contraseña: por slug e IP. */
const passwordRateLimit = {
  rateLimit: {
    max: 20,
    timeWindow: '1 minute',
    keyGenerator: (request: { ip: string; params: unknown }) => {
      const slug = (request.params as { slug?: string } | undefined)?.slug ?? 'anon';
      return `${request.ip}:${slug}`;
    },
  },
};

/** Resuelve la publicación y valida la contraseña (404/401 sin filtrar datos). */
async function requirePublicBoard(slug: string, password: string | undefined): Promise<PublishedBoard> {
  const board = await findPublishedBoard(slug);
  if (!board) throw notFound('La publicación no existe', 'public_not_found');
  if (!(await checkPublicPassword(board, password))) {
    throw unauthorized('La publicación tiene contraseña', 'public_password_required');
  }
  return board;
}

/** Scope protegido (con sesión): gestión de la publicación. */
export async function publishRoutes(app: FastifyInstance): Promise<void> {
  app.get('/boards/:id/publish', async (request) => {
    const user = currentUser(request);
    const { id } = boardParamsSchema.parse(request.params);
    const resolution = await resolveBoardAccess(user.id, id);
    const { board, role } = requireBoardAccess(resolution, 'viewer');
    if (role !== 'owner') throw forbidden('Publicar es una acción del dueño', 'forbidden_owner');

    const row = await prisma.board.findUnique({
      where: { id },
      select: { publishedSlug: true, publishedAt: true, publishedPasswordHash: true, publicIncludeSubBoards: true },
    });
    const published = row?.publishedSlug !== null && row?.publishedAt !== null;
    const publication = {
      slug: row?.publishedSlug ?? null,
      url: row?.publishedSlug ? publicBoardUrl(row.publishedSlug) : null,
      includeSubBoards: row?.publicIncludeSubBoards ?? false,
      hasPassword: row?.publishedPasswordHash !== null && row?.publishedPasswordHash !== undefined,
      publishedAt: row?.publishedAt ? row.publishedAt.getTime() : null,
    };
    return {
      published,
      ...publication,
      requiresPassword: publication.hasPassword,
      title: board.title,
      publication,
    };
  });

  app.post('/boards/:id/publish', async (request) => {
    const user = currentUser(request);
    const { id } = boardParamsSchema.parse(request.params);
    const input = publishBoardSchema.parse(request.body ?? {});
    const resolution = await resolveBoardAccess(user.id, id);
    const { board, role } = requireBoardAccess(resolution, 'viewer');
    if (role !== 'owner') throw forbidden('Publicar es una acción del dueño', 'forbidden_owner');

    const result = await publishBoard(id, input, {
      publishedSlug: board.publishedSlug,
      publishedAt: board.publishedAt,
    });
    request.log.info({ boardId: id, slug: result.slug }, 'Tablero publicado');
    const publication = {
      slug: result.slug,
      url: publicBoardUrl(result.slug),
      includeSubBoards: result.includeSubBoards,
      hasPassword: result.requiresPassword,
      publishedAt: result.publishedAt.getTime(),
    };
    // `publication` y `hasPassword` son las formas que lee el panel de publicar.
    return {
      ok: true,
      ...publication,
      requiresPassword: result.requiresPassword,
      publication,
    };
  });

  app.delete('/boards/:id/publish', async (request) => {
    const user = currentUser(request);
    const { id } = boardParamsSchema.parse(request.params);
    const resolution = await resolveBoardAccess(user.id, id);
    const { role } = requireBoardAccess(resolution, 'viewer');
    if (role !== 'owner') throw forbidden('Despublicar es una acción del dueño', 'forbidden_owner');
    await unpublishBoard(id);
    request.log.info({ boardId: id }, 'Tablero despublicado');
    return { ok: true };
  });
}

/** Scope público (sin sesión): la vista de solo lectura de `/p/:slug`. */
export async function publicViewRoutes(app: FastifyInstance): Promise<void> {
  /** Resumen público: título, icono, subtableros (con su slug) y contraseña. */
  app.get('/public/boards/:slug', { config: passwordRateLimit }, async (request, reply) => {
    const { slug } = slugParamsSchema.parse(request.params);
    const query = publicBoardQuerySchema.parse(request.query ?? {});
    const board = await requirePublicBoard(slug, query.password);
    noindex(reply);
    const summary = await publicBoardSummary(board);
    // Los subtableros viajan también en el nivel superior (`boards` / `children`),
    // que es donde los lee la web, cada uno con su slug compuesto navegable.
    return {
      board: summary,
      boards: summary.subBoards,
      children: summary.subBoards,
      requiresPassword: summary.requiresPassword,
    };
  });

  /**
   * Documento público: estado saneado, assets firmados y migas del subárbol.
   * El `state` va en el **nivel superior** (la web lee ahí) y el objeto
   * completo viaja además en `document`.
   */
  app.get('/public/boards/:slug/document', { config: passwordRateLimit }, async (request, reply) => {
    const { slug } = slugParamsSchema.parse(request.params);
    const query = publicDocumentQuerySchema.parse(request.query ?? {});
    const board = await requirePublicBoard(slug, query.password);
    const target = await resolvePublicTarget(board, query.boardId);
    if (!target) throw notFound('Ese subtablero no está publicado', 'public_board_not_found');
    noindex(reply);
    const document = await publicBoardDocument(board, target);
    return { ...document, document };
  });

  /**
   * Asset de la publicación: se sirve **por el API**, no con la URL firmada de
   * S3, porque la clave del objeto lleva el id del dueño
   * (`assets/<ownerId>/<assetId>.<ext>`). El enlace viaja firmado (HMAC, 15 min)
   * y es la única credencial que necesita el visitante anónimo.
   */
  app.get('/public/boards/:slug/assets/:assetId', async (request, reply) => {
    const { slug } = slugParamsSchema.parse(request.params);
    const { assetId } = publicAssetParamsSchema.parse(request.params);
    const query = publicAssetQuerySchema.parse(request.query ?? {});
    const variant = query.variant ?? 'raw';

    // La firma ya ata el enlace a la publicación; no hace falta la contraseña
    // (el enlace se emite solo desde el documento, que sí la exigió).
    if (!verifyPublicAssetToken(query.token, { slug, assetId, variant })) {
      throw forbidden('El enlace del archivo no es válido o caducó', 'public_asset_forbidden');
    }
    const found = await publicAssetObject(assetId, variant);
    if (!found) throw notFound('El archivo no existe', 'asset_not_found');

    reply.header('content-type', found.stream.contentType ?? found.asset.mime);
    reply.header('content-length', String(found.stream.size));
    reply.header('cache-control', 'public, max-age=300');
    reply.header('x-robots-tag', 'noindex, nofollow, noarchive');
    return reply.send(found.stream.body);
  });
}

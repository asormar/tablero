/**
 * GET /api/link-preview?url= — metadatos Open Graph de un enlace.
 *
 * Ruta acotada por rate limit (30/min) porque hace una petición saliente por
 * invocación; el resultado se cachea en la tabla `LinkPreview`.
 */

import type { FastifyInstance } from 'fastify';
import { linkPreviewQuerySchema } from '@tablero/shared';

import { prisma } from '../db.js';
import { fetchLinkPreview } from '../lib/link-preview.js';
import { currentUser } from '../lib/session.js';

export async function linkPreviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/link-preview', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    currentUser(request);
    const query = linkPreviewQuerySchema.parse(request.query ?? {});
    const preview = await fetchLinkPreview(query.url);

    await prisma.linkPreview.upsert({
      where: { url: preview.url },
      create: {
        url: preview.url,
        title: preview.title,
        description: preview.description,
        imageUrl: preview.imageUrl,
        faviconUrl: preview.faviconUrl,
        siteName: preview.siteName,
        embedType: preview.embedType,
        fetchedAt: new Date(preview.fetchedAt),
      },
      update: {
        title: preview.title,
        description: preview.description,
        imageUrl: preview.imageUrl,
        faviconUrl: preview.faviconUrl,
        siteName: preview.siteName,
        embedType: preview.embedType,
        fetchedAt: new Date(preview.fetchedAt),
      },
    });

    return { preview };
  });
}

/**
 * Registro de rutas: públicas primero, protegidas dentro de un scope con sesión.
 *
 * Públicas (sin sesión):
 *   - `/capture` se autentica con token personal **o** sesión (ver `capture.ts`);
 *   - `/invitations/:token` muestra la invitación a quien tenga el enlace;
 *   - `/public/boards/:slug` es la vista publicada de solo lectura (fase 5).
 *
 * Todo lo demás exige sesión (hook encapsulado en el scope protegido).
 */

import type { FastifyInstance } from 'fastify';

import { requireSession } from '../lib/session.js';
import { activityRoutes } from './activity.js';
import { assetsRoutes } from './assets.js';
import { authRoutes } from './auth.js';
import { boardsRoutes } from './boards.js';
import { captureRoutes } from './capture.js';
import { commentsRoutes } from './comments.js';
import { exportRoutes } from './export.js';
import { healthRoutes } from './health.js';
import { linkPreviewRoutes } from './link-preview.js';
import { mapsRoutes } from './maps.js';
import { membersRoutes } from './members.js';
import { notificationsRoutes } from './notifications.js';
import { publicViewRoutes, publishRoutes } from './public-boards.js';
import { searchRoutes } from './search.js';
import { settingsRoutes } from './settings.js';
import { storageRoutes } from './storage.js';
import { tasksRoutes } from './tasks.js';
import { templatesRoutes } from './templates.js';
import { versionsRoutes } from './versions.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(captureRoutes, { prefix: '/api' });
  await app.register(publicViewRoutes, { prefix: '/api' });

  // Todo lo que se registre acá exige sesión (hook encapsulado en el scope).
  await app.register(
    async (protectedScope) => {
      protectedScope.addHook('preHandler', requireSession);
      await protectedScope.register(assetsRoutes);
      await protectedScope.register(boardsRoutes);
      await protectedScope.register(activityRoutes);
      await protectedScope.register(commentsRoutes);
      await protectedScope.register(exportRoutes);
      await protectedScope.register(mapsRoutes);
      await protectedScope.register(membersRoutes);
      await protectedScope.register(notificationsRoutes);
      await protectedScope.register(publishRoutes);
      await protectedScope.register(searchRoutes);
      await protectedScope.register(settingsRoutes);
      await protectedScope.register(storageRoutes);
      await protectedScope.register(tasksRoutes);
      await protectedScope.register(templatesRoutes);
      await protectedScope.register(versionsRoutes);
      await protectedScope.register(linkPreviewRoutes);
    },
    { prefix: '/api' },
  );
}

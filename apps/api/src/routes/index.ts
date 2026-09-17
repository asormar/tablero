/**
 * Registro de rutas: públicas primero, protegidas dentro de un scope con sesión.
 *
 * La captura rápida (`/capture`) va fuera del scope protegido: se autentica con
 * token personal **o** sesión, y la ruta resuelve cuál de las dos (ver
 * `routes/capture.ts`).
 */

import type { FastifyInstance } from 'fastify';

import { requireSession } from '../lib/session.js';
import { assetsRoutes } from './assets.js';
import { authRoutes } from './auth.js';
import { boardsRoutes } from './boards.js';
import { captureRoutes } from './capture.js';
import { exportRoutes } from './export.js';
import { healthRoutes } from './health.js';
import { linkPreviewRoutes } from './link-preview.js';
import { mapsRoutes } from './maps.js';
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

  // Todo lo que se registre acá exige sesión (hook encapsulado en el scope).
  await app.register(
    async (protectedScope) => {
      protectedScope.addHook('preHandler', requireSession);
      await protectedScope.register(assetsRoutes);
      await protectedScope.register(boardsRoutes);
      await protectedScope.register(exportRoutes);
      await protectedScope.register(mapsRoutes);
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

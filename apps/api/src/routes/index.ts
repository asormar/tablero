/** Registro de rutas: públicas primero, protegidas dentro de un scope con sesión. */

import type { FastifyInstance } from 'fastify';

import { requireSession } from '../lib/session.js';
import { assetsRoutes } from './assets.js';
import { authRoutes } from './auth.js';
import { boardsRoutes } from './boards.js';
import { healthRoutes } from './health.js';
import { linkPreviewRoutes } from './link-preview.js';
import { searchRoutes } from './search.js';
import { tasksRoutes } from './tasks.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api' });

  // Todo lo que se registre acá exige sesión (hook encapsulado en el scope).
  await app.register(
    async (protectedScope) => {
      protectedScope.addHook('preHandler', requireSession);
      await protectedScope.register(assetsRoutes);
      await protectedScope.register(boardsRoutes);
      await protectedScope.register(searchRoutes);
      await protectedScope.register(tasksRoutes);
      await protectedScope.register(linkPreviewRoutes);
    },
    { prefix: '/api' },
  );
}

/** GET /api/health — sonda pública (sin sesión). */

import type { FastifyInstance } from 'fastify';

import { env } from '../env.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', version: env.version }));
}

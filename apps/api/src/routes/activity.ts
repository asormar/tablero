/**
 * Actividad y presencia de un tablero (fase 5).
 *
 *   POST /api/boards/:id/activity   lote del cliente (`{ entries: [...] }`)
 *   GET  /api/boards/:id/activity   registro paginado por cursor → `{ entries, nextCursor }`
 *   GET  /api/boards/:id/presence   quién está mirando (últimos 60 s) → `{ users, watchers }`
 *
 * La actividad la reporta el cliente con el usuario de la sesión: es un
 * registro para leer, no una frontera de seguridad. La presencia la alimentan
 * el socket y estas mismas rutas (así el indicador funciona sin socket); el
 * listado viaja en `users` (lo que lee la web) y en `watchers` (el mismo array,
 * alias del panel de «quién está mirando»).
 */

import type { FastifyInstance } from 'fastify';
import { activityBatchSchema, activityQuerySchema, idSchema } from '@tablero/shared';
import { z } from 'zod';

import { encodeActivityCursor, listActivity, recordActivity } from '../lib/activity.js';
import { requireBoardAccess, resolveBoardAccess } from '../lib/access.js';
import { loadBoardDoc } from '../lib/documents.js';
import { boardPresence, touchPresence } from '../lib/presence.js';
import { currentUser } from '../lib/session.js';

const boardParamsSchema = z.object({ id: idSchema });

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  /** Lote de eventos del cliente. El servidor descarta lo que no exista. */
  app.post('/boards/:id/activity', async (request, reply) => {
    const user = currentUser(request);
    const { id } = boardParamsSchema.parse(request.params);
    const input = activityBatchSchema.parse(request.body ?? {});
    const resolution = await resolveBoardAccess(user.id, id);
    const { role } = requireBoardAccess(resolution, 'viewer');
    touchPresence(id, { userId: user.id, name: user.name, avatarUrl: user.avatarUrl, role });

    const doc = await loadBoardDoc(id);
    const result = await recordActivity(id, user.id, input.entries, { doc });
    reply.code(201);
    return { ok: true, accepted: result.accepted, discarded: result.discarded, entries: result.events };
  });

  /** Registro del tablero, lo más nuevo primero, con `nextCursor` para seguir. */
  app.get('/boards/:id/activity', async (request) => {
    const user = currentUser(request);
    const { id } = boardParamsSchema.parse(request.params);
    const query = activityQuerySchema.parse(request.query ?? {});
    const resolution = await resolveBoardAccess(user.id, id);
    const { role } = requireBoardAccess(resolution, 'viewer');
    touchPresence(id, { userId: user.id, name: user.name, avatarUrl: user.avatarUrl, role });

    const entries = await listActivity(id, { limit: query.limit, cursor: query.cursor, elementId: query.elementId });
    const last = entries[entries.length - 1];
    // Solo hay cursor cuando la página vino llena: si no, no queda nada más.
    const nextCursor = entries.length === query.limit && last ? encodeActivityCursor(last) : null;
    return { entries, nextCursor };
  });

  /** Quién está mirando el tablero: la ventana de presencia (60 s). */
  app.get('/boards/:id/presence', async (request) => {
    const user = currentUser(request);
    const { id } = boardParamsSchema.parse(request.params);
    const resolution = await resolveBoardAccess(user.id, id);
    const { role } = requireBoardAccess(resolution, 'viewer');
    // Consultar la presencia también cuenta como estar mirando.
    touchPresence(id, { userId: user.id, name: user.name, avatarUrl: user.avatarUrl, role });
    const users = boardPresence(id);
    return { users, watchers: users, windowMs: 60_000 };
  });
}

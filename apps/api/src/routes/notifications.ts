/**
 * Notificaciones (fase 5).
 *
 *   GET  /api/notifications?filter=unread|all   listado + contador
 *   GET  /api/notifications/count               contador de no leídas
 *   POST /api/notifications/read                marcar (ids o todas)
 *
 * Al abrir el panel (el listado) se barre lo vencido con un *throttle* de un
 * minuto: el barrido recorre los documentos y no tiene sentido repetirlo en cada
 * refresco. El barrido periódico del servidor corre cada 15 minutos.
 */

import type { FastifyInstance } from 'fastify';
import { notificationsQuerySchema, readNotificationsSchema } from '@tablero/shared';

import {
  listNotifications,
  markNotificationsRead,
  notificationCounts,
  sweepOverdueTaskNotifications,
} from '../lib/notifications.js';
import { currentUser } from '../lib/session.js';

/** Ventana mínima entre barridos disparados por el panel (1 minuto). */
const PANEL_SWEEP_THROTTLE_MS = 60_000;
let lastPanelSweep = 0;

async function sweepFromPanel(log: (message: string) => void): Promise<void> {
  const now = Date.now();
  if (now - lastPanelSweep < PANEL_SWEEP_THROTTLE_MS) return;
  lastPanelSweep = now;
  try {
    const result = await sweepOverdueTaskNotifications();
    if (result.notifications > 0) log(`barrido de tareas vencidas: ${result.notifications} notificaciones nuevas`);
  } catch (error) {
    log(`el barrido de tareas vencidas falló: ${String(error)}`);
  }
}

/** Reinicia el throttle (tests). */
export function resetPanelSweepThrottle(): void {
  lastPanelSweep = 0;
}

export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/notifications', async (request) => {
    const user = currentUser(request);
    const query = notificationsQuerySchema.parse(request.query ?? {});
    await sweepFromPanel((message) => request.log.info(message));
    const [notifications, count] = await Promise.all([
      listNotifications(user.id, { filter: query.filter, limit: query.limit }),
      notificationCounts(user.id),
    ]);
    // `unread` va en el nivel superior: es lo que lee la campana de la web.
    return { notifications, unread: count.unread, total: count.total, count, filter: query.filter };
  });

  app.get('/notifications/count', async (request) => {
    const user = currentUser(request);
    const count = await notificationCounts(user.id);
    return { unread: count.unread, total: count.total, count };
  });

  /**
   * Marcar como leídas: `{ ids }` las indicadas y `{}` (o `{ all: true }`)
   * todas. La web manda `{}` cuando no hay selección.
   */
  app.post('/notifications/read', async (request) => {
    const user = currentUser(request);
    const input = readNotificationsSchema.parse(request.body ?? {});
    const all = input.all === true || input.ids === undefined;
    const marked = await markNotificationsRead(user.id, { ids: input.ids, all });
    const count = await notificationCounts(user.id);
    return { ok: true, marked, unread: count.unread, total: count.total, count };
  });
}

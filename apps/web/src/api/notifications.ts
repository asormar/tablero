/**
 * Notificaciones (punto 6 de la fase 5).
 *
 *   GET  /notifications?filter=unread|all → { notifications, unread }
 *   GET  /notifications/count             → { unread }
 *   POST /notifications/read              ← { ids?: string[] } → { unread }
 *
 * El contador que pinta la campana puede venir del propio listado o del
 * endpoint de conteo; `fetchUnreadCount` tolera las dos formas.
 */

import { type AppNotification, parseNotificationList } from '@/lib/notificationsView';

import { apiRequest } from './client';

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function fetchNotifications(
  filter: 'unread' | 'all' = 'unread',
): Promise<{ notifications: AppNotification[]; unread: number | null }> {
  const payload = await apiRequest<unknown>('/notifications', { query: { filter } });
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return {
    notifications: parseNotificationList(payload),
    unread: asNumber(record['unread']),
  };
}

export async function fetchUnreadCount(): Promise<number> {
  const payload = await apiRequest<unknown>('/notifications/count');
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return asNumber(record['unread']) ?? 0;
}

/** Marca como leídas las indicadas, o todas si `ids` es `null`. */
export async function markNotificationsRead(ids: string[] | null): Promise<number> {
  const payload = await apiRequest<unknown>('/notifications/read', {
    method: 'POST',
    body: ids === null ? {} : { ids },
  });
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return asNumber(record['unread']) ?? 0;
}

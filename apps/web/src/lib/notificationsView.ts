/**
 * Notificaciones (punto 6 de la fase 5): modelo de lectura.
 *
 * El servidor es la autoridad (tabla propia, contador de no leídas y
 * `POST /api/notifications/read`); acá solo se normaliza lo que llega, se
 * describe cada tipo y se resuelve **a dónde lleva un clic** (tablero +
 * elemento), que es lo que la interfaz necesita para saltar sin recargar.
 */

export const NOTIFICATION_KINDS = [
  'mention',
  'comment',
  'reply',
  'board_shared',
  'task_overdue',
  'invitation',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type AppNotification = {
  id: string;
  kind: NotificationKind | string;
  boardId: string | null;
  boardTitle: string | null;
  elementId: string | null;
  actorId: string | null;
  actorName: string | null;
  /** Texto del cuerpo del comentario o de la tarea, si el servidor lo manda. */
  excerpt: string | null;
  readAt: number | null;
  createdAt: number;
};

/** A dónde lleva un clic: el tablero siempre; el elemento si lo hay. */
export type NotificationTarget = { boardId: string; elementId: string | null };

const KIND_LABELS: Record<string, string> = {
  mention: 'Te mencionó',
  comment: 'Comentó en tu tablero',
  reply: 'Respondió a tu comentario',
  board_shared: 'Compartió un tablero contigo',
  task_overdue: 'Tarea vencida',
  invitation: 'Te invitó a un tablero',
};

export function notificationKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? 'Novedad';
}

/** «Ana te mencionó en "Compras"». */
export function describeNotification(notification: AppNotification): string {
  const actor = notification.actorName?.trim() || 'Alguien';
  const kind = notificationKindLabel(notification.kind);
  const board = notification.boardTitle?.trim();
  const where = board ? ` en «${board}»` : '';
  if (notification.kind === 'task_overdue') {
    return notification.excerpt ? `Tarea vencida: «${notification.excerpt}»` : 'Hay una tarea vencida';
  }
  return `${actor}: ${kind.toLowerCase()}${where}`;
}

export function notificationTarget(notification: AppNotification): NotificationTarget | null {
  if (!notification.boardId) return null;
  return { boardId: notification.boardId, elementId: notification.elementId };
}

export function isUnread(notification: AppNotification): boolean {
  return notification.readAt === null;
}

export function unreadCount(notifications: AppNotification[]): number {
  let count = 0;
  for (const notification of notifications) if (isUnread(notification)) count += 1;
  return count;
}

/** Más nuevas primero (lo que espera el panel). */
export function sortNotifications(notifications: AppNotification[]): AppNotification[] {
  return [...notifications].sort(
    (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  );
}

/** Filtro del panel: `unread` solo las pendientes; `all` todas. */
export function filterNotifications(
  notifications: AppNotification[],
  filter: 'unread' | 'all',
): AppNotification[] {
  const sorted = sortNotifications(notifications);
  return filter === 'unread' ? sorted.filter(isUnread) : sorted;
}

/** Marca como leídas las indicadas (o todas si no se indica ninguna). */
export function markReadLocally(
  notifications: AppNotification[],
  ids: string[] | null,
  now = Date.now(),
): AppNotification[] {
  const wanted = ids === null ? null : new Set(ids);
  return notifications.map((notification) => {
    if (wanted && !wanted.has(notification.id)) return notification;
    if (notification.readAt !== null) return notification;
    return { ...notification, readAt: now };
  });
}

export function parseNotification(raw: unknown): AppNotification | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'] : null;
  const createdAt = typeof record['createdAt'] === 'number' ? record['createdAt'] : null;
  if (!id || createdAt === null) return null;
  const actor = (record['actor'] ?? {}) as Record<string, unknown>;
  const board = (record['board'] ?? {}) as Record<string, unknown>;
  const readAt =
    typeof record['readAt'] === 'number' ? record['readAt'] : record['readAt'] === null ? null : null;
  return {
    id,
    kind: typeof record['kind'] === 'string' ? record['kind'] : 'unknown',
    boardId:
      typeof record['boardId'] === 'string'
        ? record['boardId']
        : typeof board['id'] === 'string'
          ? board['id']
          : null,
    boardTitle:
      typeof record['boardTitle'] === 'string'
        ? record['boardTitle']
        : typeof board['title'] === 'string'
          ? board['title']
          : null,
    elementId: typeof record['elementId'] === 'string' ? record['elementId'] : null,
    actorId:
      typeof record['actorId'] === 'string'
        ? record['actorId']
        : typeof actor['id'] === 'string'
          ? actor['id']
          : null,
    actorName:
      typeof record['actorName'] === 'string'
        ? record['actorName']
        : typeof actor['name'] === 'string'
          ? actor['name']
          : null,
    excerpt:
      typeof record['excerpt'] === 'string'
        ? record['excerpt']
        : typeof record['body'] === 'string'
          ? record['body']
          : null,
    readAt,
    createdAt,
  };
}

export function parseNotificationList(payload: unknown): AppNotification[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>)['notifications'])
      ? ((payload as Record<string, unknown>)['notifications'] as unknown[])
      : [];
  return list
    .map(parseNotification)
    .filter((notification): notification is AppNotification => notification !== null);
}

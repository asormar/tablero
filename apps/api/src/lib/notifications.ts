/**
 * Notificaciones (fase 5): menciones, respuestas, tableros compartidos y
 * tareas vencidas.
 *
 * Cada fila es un hecho para una persona. `dedupeKey` la hace idempotente: una
 * mención por (comentario, usuario) y una tarea vencida por (tarea, día,
 * usuario), así el hook de persistencia y el barrido periódico pueden repetir
 * su trabajo sin crear ruido.
 */

import { Prisma } from '@prisma/client';
import type { NotificationCount, NotificationKind, NotificationSummary } from '@tablero/shared';
import { bucketOf, flattenTasks, getOrderedElements, todayIso } from '@tablero/shared';

import { prisma } from '../db.js';
import { loadBoardDoc } from './documents.js';

export type NotificationInput = {
  userId: string;
  kind: NotificationKind;
  boardId?: string | null;
  elementId?: string | null;
  actorId?: string | null;
  meta?: Record<string, unknown>;
  /** Clave de idempotencia (repetir el hecho no duplica la fila). */
  dedupeKey?: string | null;
  createdAt?: Date;
};

function rowData(input: NotificationInput): Prisma.NotificationUncheckedCreateInput {
  return {
    userId: input.userId,
    kind: input.kind,
    boardId: input.boardId ?? null,
    elementId: input.elementId ?? null,
    actorId: input.actorId ?? null,
    meta: (input.meta ?? {}) as Prisma.InputJsonValue,
    dedupeKey: input.dedupeKey ?? null,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  };
}

/**
 * Crea la notificación. Con `dedupeKey` es idempotente (upsert sin cambios):
 * volver a procesar el mismo comentario no duplica la mención.
 */
export async function createNotification(input: NotificationInput): Promise<{ id: string; created: boolean }> {
  if (input.dedupeKey) {
    const existing = await prisma.notification.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } });
    if (existing) return { id: existing.id, created: false };
    const row = await prisma.notification.create({ data: rowData(input), select: { id: true } });
    return { id: row.id, created: true };
  }
  const row = await prisma.notification.create({ data: rowData(input), select: { id: true } });
  return { id: row.id, created: true };
}

/** Avisa a cada destinatario que le compartieron el tablero. */
export async function notifyBoardShared(options: {
  boardId: string;
  boardTitle: string;
  actorId: string;
  actorName: string;
  recipients: string[];
  role: string;
}): Promise<number> {
  let created = 0;
  for (const userId of options.recipients) {
    if (userId === options.actorId) continue;
    const result = await createNotification({
      userId,
      kind: 'board-shared',
      boardId: options.boardId,
      actorId: options.actorId,
      meta: { boardTitle: options.boardTitle, actorName: options.actorName, role: options.role },
      dedupeKey: `board-shared:${options.boardId}:${userId}`,
    });
    if (result.created) created += 1;
  }
  return created;
}

export type NotificationListOptions = { filter: 'all' | 'unread'; limit: number };

export async function listNotifications(userId: string, options: NotificationListOptions): Promise<NotificationSummary[]> {
  const rows = await prisma.notification.findMany({
    where: { userId, ...(options.filter === 'unread' ? { readAt: null } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit,
    include: {
      actor: { select: { name: true } },
      board: { select: { title: true, publishedSlug: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as NotificationKind,
    boardId: row.boardId,
    boardTitle: row.board?.title ?? null,
    boardSlug: row.board?.publishedSlug ?? null,
    elementId: row.elementId,
    actorId: row.actorId,
    actorName: row.actor?.name ?? null,
    meta: (row.meta ?? {}) as Record<string, unknown>,
    readAt: row.readAt ? row.readAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
  }));
}

export async function notificationCounts(userId: string): Promise<NotificationCount> {
  const [unread, total] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.count({ where: { userId } }),
  ]);
  return { unread, total };
}

/**
 * Marca como leídas las notificaciones indicadas (o todas). Devuelve cuántas
 * filas cambiaron: el contador de la campana cuadra con lo que se marcó.
 */
export async function markNotificationsRead(
  userId: string,
  options: { ids?: string[]; all?: boolean },
): Promise<number> {
  const where: Prisma.NotificationWhereInput = {
    userId,
    readAt: null,
    ...(options.all ? {} : { id: { in: options.ids ?? [] } }),
  };
  const result = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
  return result.count;
}

/** Borra una notificación del usuario (no se expone como ruta todavía). */
export async function deleteNotification(userId: string, id: string): Promise<number> {
  const result = await prisma.notification.deleteMany({ where: { id, userId } });
  return result.count;
}

export type OverdueSweepResult = { boards: number; tasks: number; notifications: number };

/**
 * Barrido de tareas vencidas: recorre los documentos persistidos, calcula las
 * tareas con `dueDate` anterior a hoy (sin completar) y avisa al asignado o, si
 * no hay asignado, a los miembros del tablero. Una notificación por tarea y día.
 *
 * Se ejecuta cada 15 minutos desde el arranque del servidor y también al abrir
 * el panel de notificaciones (`GET /api/notifications` con `filter=unread`), así
 * el contador no espera al próximo tick.
 */
export async function sweepOverdueTaskNotifications(options: { limit?: number; now?: Date } = {}): Promise<OverdueSweepResult> {
  const now = options.now ?? new Date();
  const today = todayIso(now);
  const limit = options.limit ?? 200;

  const rows = await prisma.boardDocument.findMany({ select: { boardId: true }, take: limit });
  let tasks = 0;
  let notifications = 0;

  for (const row of rows) {
    let doc;
    try {
      doc = await loadBoardDoc(row.boardId);
    } catch {
      continue; // Documento ilegible: no puede tumbar el barrido.
    }
    if (!doc) continue;

    const overdue: { elementId: string; itemId: string; text: string; assigneeId: string | null }[] = [];
    for (const element of getOrderedElements(doc)) {
      if (element.type !== 'todo') continue;
      const items = Array.isArray(element.items) ? element.items : [];
      for (const flat of flattenTasks(element.id, items)) {
        if (flat.checked || flat.text.trim().length === 0) continue;
        if (bucketOf(flat, today) !== 'overdue') continue;
        overdue.push({ elementId: element.id, itemId: flat.itemId, text: flat.text, assigneeId: flat.assigneeId ?? null });
      }
    }
    if (overdue.length === 0) continue;
    tasks += overdue.length;

    const [board, members] = await Promise.all([
      prisma.board.findUnique({ where: { id: row.boardId }, select: { ownerId: true, title: true } }),
      prisma.boardMember.findMany({ where: { boardId: row.boardId }, select: { userId: true } }),
    ]);
    if (!board) continue;
    const audience = [board.ownerId, ...members.map((member) => member.userId)];

    for (const task of overdue) {
      const targets = task.assigneeId ? [task.assigneeId] : audience;
      for (const userId of targets) {
        const result = await createNotification({
          userId,
          kind: 'task-overdue',
          boardId: row.boardId,
          elementId: task.elementId,
          meta: { itemId: task.itemId, text: task.text, dueDate: today, boardTitle: board.title },
          dedupeKey: `task-overdue:${row.boardId}:${task.elementId}:${task.itemId}:${today}:${userId}`,
        });
        if (result.created) notifications += 1;
      }
    }
  }

  return { boards: rows.length, tasks, notifications };
}

/** Intervalo del barrido en el proceso del servidor (15 minutos). */
export const OVERDUE_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Arranca el barrido periódico. Devuelve la función para detenerlo (apagado del
 * servidor). No se dispara en tests: lo llama `server.ts`.
 */
export function startOverdueSweep(
  onError?: (error: unknown) => void,
  intervalMs: number = OVERDUE_SWEEP_INTERVAL_MS,
): () => void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await sweepOverdueTaskNotifications();
    } catch (error) {
      onError?.(error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

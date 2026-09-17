/**
 * Notificaciones: normalización, descripción, destino del clic y contador.
 *
 * El contador de no leídas es un criterio de aceptación de la fase, así que se
 * prueba explícitamente: contar, marcar una, marcar todas.
 */

import { describe, expect, it } from 'vitest';

import {
  describeNotification,
  filterNotifications,
  isUnread,
  markReadLocally,
  notificationKindLabel,
  notificationTarget,
  parseNotification,
  parseNotificationList,
  sortNotifications,
  unreadCount,
  type AppNotification,
} from './notificationsView';

function notification(partial: Partial<AppNotification> & { id: string }): AppNotification {
  return {
    kind: 'mention',
    boardId: 'b1',
    boardTitle: 'Proyecto',
    elementId: null,
    actorId: 'u2',
    actorName: 'Ana',
    excerpt: null,
    readAt: null,
    createdAt: 1_000,
    ...partial,
  };
}

describe('notificaciones · contador', () => {
  const list = [
    notification({ id: 'n1', createdAt: 3_000 }),
    notification({ id: 'n2', readAt: 5_000, createdAt: 2_000 }),
    notification({ id: 'n3', createdAt: 1_000 }),
  ];

  it('cuenta solo las no leídas', () => {
    expect(unreadCount(list)).toBe(2);
    expect(isUnread(list[1]!)).toBe(false);
  });

  it('marca una por id', () => {
    const next = markReadLocally(list, ['n1'], 9_000);
    expect(unreadCount(next)).toBe(1);
    expect(next.find((item) => item.id === 'n1')!.readAt).toBe(9_000);
  });

  it('marca todas (ids null)', () => {
    const next = markReadLocally(list, null, 9_000);
    expect(unreadCount(next)).toBe(0);
    expect(next.find((item) => item.id === 'n2')!.readAt).toBe(5_000); // no se pisa
  });

  it('filtra por no leídas y ordena por fecha descendente', () => {
    expect(filterNotifications(list, 'unread').map((item) => item.id)).toEqual(['n1', 'n3']);
    expect(filterNotifications(list, 'all').map((item) => item.id)).toEqual(['n1', 'n2', 'n3']);
    expect(sortNotifications(list).map((item) => item.id)).toEqual(['n1', 'n2', 'n3']);
  });
});

describe('notificaciones · descripciones y destino', () => {
  it('describe una mención con tablero', () => {
    expect(describeNotification(notification({ id: 'n1' }))).toBe('Ana: te mencionó en «Proyecto»');
  });

  it('describe una tarea vencida con su texto', () => {
    expect(
      describeNotification(notification({ id: 'n1', kind: 'task_overdue', excerpt: 'Pagar luz' })),
    ).toBe('Tarea vencida: «Pagar luz»');
  });

  it('un tipo desconocido no rompe', () => {
    expect(notificationKindLabel('lo_que_sea')).toBe('Novedad');
    expect(describeNotification(notification({ id: 'n1', kind: 'lo_que_sea' }))).toContain('Ana');
  });

  it('el destino lleva al tablero y al elemento', () => {
    expect(notificationTarget(notification({ id: 'n1', elementId: 'el1' }))).toEqual({
      boardId: 'b1',
      elementId: 'el1',
    });
    expect(notificationTarget(notification({ id: 'n1', boardId: null }))).toBeNull();
  });
});

describe('notificaciones · parseo defensivo', () => {
  it('normaliza el formato anidado del API', () => {
    const parsed = parseNotification({
      id: 'n1',
      kind: 'reply',
      board: { id: 'b9', title: 'Diseño' },
      actor: { id: 'u7', name: 'Carla' },
      body: 'te respondí',
      readAt: null,
      createdAt: 42,
    });
    expect(parsed).toMatchObject({
      id: 'n1',
      kind: 'reply',
      boardId: 'b9',
      boardTitle: 'Diseño',
      actorName: 'Carla',
      excerpt: 'te respondí',
      readAt: null,
      createdAt: 42,
    });
  });

  it('acepta el listado pelado o envuelto', () => {
    expect(parseNotificationList([{ id: 'n1', createdAt: 1 }])).toHaveLength(1);
    expect(parseNotificationList({ notifications: [{ id: 'n2', createdAt: 2 }] })).toHaveLength(1);
    expect(parseNotificationList(null)).toEqual([]);
  });

  it('descarta entradas sin id o sin fecha', () => {
    expect(parseNotification({ createdAt: 1 })).toBeNull();
    expect(parseNotification({ id: 'n1' })).toBeNull();
    expect(parseNotification('nada')).toBeNull();
  });
});

/**
 * Notificaciones (punto 6 de la fase 5): campana con contador y panel.
 *
 * - `NotificationBell`: el botón de la barra con el contador de no leídas.
 * - `NotificationsPanel`: la lista (menciones, comentarios, respuestas, tablero
 *   compartido, tareas vencidas), con «marcar como leída» por fila y «marcar
 *   todas». Un clic lleva al tablero y al elemento **sin recargar la página**
 *   (`requestFocus` + apertura del tablero).
 *
 * El estado se refresca cada 30 s y al abrir el panel; la campana nunca rompe la
 * barra si la API no expone los endpoints (se queda sin contador y lo dice).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AtSign, Bell, BellOff, CheckCheck, MessageSquare, RefreshCw, TriangleAlert, Users, X } from 'lucide-react';

import { fetchNotifications, markNotificationsRead } from '@/api/notifications';
import { degradationMessage, isMissingEndpoint } from '@/api/degraded';
import { openBoardFromNotification } from '@/app/notificationNav';
import { relativeTime } from '@/collab/comments';
import {
  type AppNotification,
  filterNotifications,
  markReadLocally,
  notificationTarget,
  unreadCount,
} from '@/lib/notificationsView';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useUiStore } from '@/state/uiStore';

const POLL_MS = 30_000;

const KIND_ICONS: Record<string, JSX.Element> = {
  mention: <AtSign size={13} />,
  comment: <MessageSquare size={13} />,
  reply: <MessageSquare size={13} />,
  board_shared: <Users size={13} />,
  task_overdue: <TriangleAlert size={13} />,
};

type NotificationsState = {
  items: AppNotification[];
  unread: number | null;
  loading: boolean;
  missing: boolean;
  error: string | null;
  refresh: (silent?: boolean) => void;
};

export function useNotifications(enabled: boolean): NotificationsState {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const apiOnline = useAppStore((state) => state.apiOnline);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (silent = false): Promise<void> => {
      if (!apiOnline) {
        setMissing(true);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const result = await fetchNotifications('all');
        if (!mounted.current) return;
        setItems(result.notifications);
        setUnread(result.unread ?? unreadCount(result.notifications));
        setMissing(false);
        setError(null);
      } catch (cause) {
        if (!mounted.current) return;
        setMissing(isMissingEndpoint(cause));
        setError(degradationMessage(cause, 'Notificaciones'));
      } finally {
        if (!mounted.current) return;
        setLoading(false);
      }
    },
    [apiOnline],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    void load(true);
    const timer = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, load]);

  const refresh = useCallback(
    (silent = false): void => {
      void load(silent);
    },
    [load],
  );

  return { items, unread, loading, missing, error, refresh };
}

export function NotificationBell({ enabled = true }: { enabled?: boolean }): JSX.Element {
  const open = usePanelsStore((state) => state.notificationsOpen);
  const { items, unread } = useNotifications(enabled);
  const count = unread ?? unreadCount(items);

  return (
    <button
      type="button"
      className={`icon-button notification-bell${open ? ' is-active' : ''}`}
      title="Notificaciones"
      aria-label={count > 0 ? `Notificaciones (${count} sin leer)` : 'Notificaciones'}
      data-notification-bell
      data-notification-count={count}
      aria-pressed={open}
      onClick={() => {
        const store = usePanelsStore.getState();
        store.setNotificationsOpen(!open);
      }}
    >
      <Bell size={15} />
      {count > 0 ? <span className="notification-bell__badge" data-notification-badge>{count}</span> : null}
    </button>
  );
}

export function NotificationsPanel({ enabled = true }: { enabled?: boolean }): JSX.Element | null {
  const open = usePanelsStore((state) => state.notificationsOpen);
  const setOpen = usePanelsStore((state) => state.setNotificationsOpen);
  const { items, unread, loading, missing, error, refresh } = useNotifications(enabled);
  const [filter, setFilter] = useState<'unread' | 'all'>('all');
  const setNotice = useAppStore((state) => state.setNotice);

  const shown = useMemo(() => filterNotifications(items, filter), [items, filter]);
  const count = unread ?? unreadCount(items);

  if (!open) return null;

  const markOne = async (notification: AppNotification): Promise<void> => {
    setOpen(false);
    const target = notificationTarget(notification);
    if (target) openBoardFromNotification(target.boardId, target.elementId);
    try {
      await markNotificationsRead([notification.id]);
    } catch {
      // Si falla, el siguiente refresco lo vuelve a mostrar sin leer.
    }
    refresh(true);
  };

  const markAll = async (): Promise<void> => {
    try {
      await markNotificationsRead(null);
      refresh(true);
    } catch (cause) {
      setNotice(degradationMessage(cause, 'Marcar como leídas'));
    }
  };

  return (
    <aside className="notification-panel" role="dialog" aria-label="Notificaciones" data-notification-panel>
      <header className="notification-panel__head">
        <span className="notification-panel__title">
          <Bell size={13} /> Notificaciones
        </span>
        <button type="button" className="icon-button" title="Refrescar" onClick={() => refresh()}>
          <RefreshCw size={12} className={loading ? 'spin' : undefined} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Marcar todas como leídas"
          data-notification-mark-all
          disabled={count === 0}
          onClick={() => void markAll()}
        >
          <CheckCheck size={13} />
        </button>
        <button type="button" className="icon-button" title="Cerrar" onClick={() => setOpen(false)}>
          <X size={13} />
        </button>
      </header>

      <div className="notification-panel__filters" role="tablist" aria-label="Filtrar notificaciones">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`notification-panel__filter${filter === 'all' ? ' is-active' : ''}`}
          data-notification-filter="all"
          onClick={() => setFilter('all')}
        >
          Todas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'unread'}
          className={`notification-panel__filter${filter === 'unread' ? ' is-active' : ''}`}
          data-notification-filter="unread"
          onClick={() => setFilter('unread')}
        >
          Sin leer ({count})
        </button>
      </div>

      {missing ? (
        <p className="notification-panel__warning" data-notification-missing>
          La API todavía no expone las notificaciones.
        </p>
      ) : null}
      {error && !missing ? <p className="notification-panel__warning">{error}</p> : null}

      {shown.length === 0 ? (
        <p className="notification-panel__empty" data-notification-empty>
          <BellOff size={13} /> {filter === 'unread' ? 'No hay notificaciones sin leer.' : 'No hay notificaciones.'}
        </p>
      ) : (
        <ul className="notification-panel__list" data-notification-list={shown.length}>
          {shown.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                className={`notification-row${notification.readAt ? '' : ' is-unread'}`}
                data-notification={notification.id}
                data-notification-kind={notification.kind}
                data-notification-read={notification.readAt ? 'yes' : 'no'}
                onClick={() => void markOne(notification)}
              >
                <span className="notification-row__icon">{KIND_ICONS[notification.kind] ?? <Bell size={13} />}</span>
                <span className="notification-row__body">
                  <span className="notification-row__title">{notification.actorName ?? 'Alguien'}</span>
                  <span className="notification-row__text">
                    {notificationText(notification)}
                  </span>
                  <span className="notification-row__time">{relativeTime(notification.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function notificationText(notification: AppNotification): string {
  const board = notification.boardTitle ? ` en «${notification.boardTitle}»` : '';
  switch (notification.kind) {
    case 'mention':
      return `te mencionó${board}`;
    case 'comment':
      return `comentó${board}`;
    case 'reply':
      return `respondió a tu comentario${board}`;
    case 'board_shared':
      return `compartió un tablero contigo${board ? `: ${notification.boardTitle}` : ''}`;
    case 'task_overdue':
      return notification.excerpt ? `Tarea vencida: «${notification.excerpt}»` : 'Hay una tarea vencida';
    default:
      return `novedad${board}`;
  }
}

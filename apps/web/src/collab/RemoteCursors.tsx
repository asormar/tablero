/**
 * Capas de colaboración sobre el lienzo (punto 4 de la fase 5):
 *
 * - `RemoteCursorsOverlay`: cursores ajenos con nombre y color. Va en el espacio
 *   de pantalla (fuera del `transform` del mundo) y cada cursor se posiciona
 *   transformando su punto de mundo con el viewport local.
 * - `RemoteSelectionLayer`: la selección ajena resaltada. Va **dentro** del
 *   contenedor del mundo (coordenadas de mundo), así el zoom y el paneo la
 *   transforman igual que a las tarjetas.
 * - `PresenceWatchers`: el indicador de quién está mirando (avatares), con el
 *   respaldo REST (`GET /boards/:id/presence`) cuando no hay socket.
 */

import { useEffect, useState } from 'react';

import { worldToScreen } from '@tablero/shared';

import { fetchPresence, type PresenceUser } from '@/api/sharing';
import type { BoardSession } from '@/collab/BoardSession';
import {
  cursorColorFor,
  presenceInitials,
  uniqueByUser,
  watchersLabel,
  type RemotePresence,
} from '@/collab/presence';
import { useRemotePresence, useSessionLayout } from '@/collab/SessionContext';
import { rectOf } from '@/lib/layout';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

const CURSOR_TTL_POLL_MS = 5_000;

/** Cursores ajenos, con nombre y color. */
export function RemoteCursorsOverlay({ dark }: { dark: boolean }): JSX.Element | null {
  const presence = useRemotePresence();
  const viewport = useUiStore((state) => state.viewport);
  const canvasSize = useUiStore((state) => state.canvasSize);

  const cursors = presence.filter((entry) => entry.cursor !== null);
  if (cursors.length === 0) return null;

  return (
    <div className="remote-cursors" aria-hidden="true" data-remote-cursors={cursors.length}>
      {cursors.map((entry) => {
        const screen = worldToScreen(viewport, entry.cursor!);
        const color = entry.color ?? cursorColorFor(entry.userId, dark ? 'dark' : 'light');
        const offscreen =
          screen.x < -60 ||
          screen.y < -60 ||
          screen.x > canvasSize.width + 60 ||
          screen.y > canvasSize.height + 60;
        if (offscreen) return null;
        return (
          <div
            key={entry.clientId}
            className="remote-cursor"
            data-remote-cursor={entry.userId}
            style={{ transform: `translate3d(${screen.x}px, ${screen.y}px, 0)` }}
          >
            <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true">
              <path d="M1 1 L1 15.5 L5 11.5 L8 18 L11 16.5 L8 10.5 L14 10.5 Z" fill={color} />
            </svg>
            <span className="remote-cursor__label" style={{ background: color }}>
              {entry.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Selección ajena resaltada (en coordenadas de mundo). */
export function RemoteSelectionLayer(): JSX.Element | null {
  const presence = useRemotePresence();
  const layout = useSessionLayout();
  const measured = useUiStore((state) => state.measuredHeights);

  // La presencia ya viene sin este cliente: cualquier entrada con selección es
  // de otra conexión (aunque sea otra pestaña del mismo usuario).
  const shared = presence.filter((entry) => entry.selection.length > 0);
  if (shared.length === 0) return null;

  const byId = new Map(layout.map((item) => [item.id, item]));
  const boxes = shared.map((entry) => ({
    entry,
    rects: entry.selection
      .map((id) => byId.get(id))
      .filter((item): item is NonNullable<typeof item> => !!item)
      .map((item) => rectOf(item, measured)),
  })).filter((item) => item.rects.length > 0);

  if (boxes.length === 0) return null;

  return (
    <div className="remote-selection" aria-hidden="true" data-remote-selection={boxes.length}>
      {boxes.map(({ entry, rects }) => (
        <div
          key={entry.clientId}
          className="remote-selection__client"
          data-remote-selection-user={entry.userId}
        >
          {rects.map((rect, index) => (
            <span
              key={`${entry.clientId}-${index}`}
              className="remote-selection__rect"
              style={{
                transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                borderColor: entry.color ?? cursorColorFor(entry.userId),
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Indicador de quién está mirando: avatares con iniciales y color. Usa la
 * presencia del socket y, si el socket no está, cae al endpoint de presencia
 * (`GET /boards/:id/presence`, últimos 60 s), que es justamente para lo que
 * existe.
 */
export function PresenceWatchers({ boardId, dark = false }: { boardId: string; dark?: boolean }): JSX.Element | null {
  const presence = useRemotePresence();
  const socketLive = useAppStore((state) => state.syncState);
  const [fallback, setFallback] = useState<PresenceUser[]>([]);

  // El estado de awareness ya excluye a este cliente: lo que queda es «otras
  // conexiones mirando», incluida otra pestaña del mismo usuario.
  const socketEntries = uniqueByUser(presence);
  const socketAvailable = socketLive === 'saved' || socketLive === 'saving';
  const useFallback = socketEntries.length === 0 && !socketAvailable;

  useEffect(() => {
    if (!useFallback) return undefined;
    let cancelled = false;
    const load = (): void => {
      void fetchPresence(boardId)
        .then((users) => {
          if (!cancelled) setFallback(users);
        })
        .catch(() => {
          // Sin endpoint ni socket no hay indicador: no es un error.
          if (!cancelled) setFallback([]);
        });
    };
    load();
    const timer = setInterval(load, CURSOR_TTL_POLL_MS * 2);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [boardId, useFallback]);

  const entries: { key: string; name: string; userId: string; color: string | null }[] = useFallback
    ? fallback.map((user) => ({ key: user.userId, name: user.name, userId: user.userId, color: user.color }))
    : socketEntries.map((entry) => ({
        key: `${entry.userId}`,
        name: entry.name,
        userId: entry.userId,
        color: entry.color,
      }));

  if (entries.length === 0) return null;

  const names = entries.map((entry) => entry.name);

  return (
    <div
      className="watchers"
      title={`${watchersLabel(names)} viendo este tablero`}
      data-watchers={entries.length}
      role="status"
      aria-label={`${watchersLabel(names)} viendo este tablero`}
    >
      {entries.slice(0, 4).map((entry) => (
        <span
          key={entry.key}
          className="watchers__avatar"
          data-watcher={entry.userId}
          style={{ background: entry.color ?? cursorColorFor(entry.userId, dark ? 'dark' : 'light') }}
        >
          {presenceInitials(entry.name)}
        </span>
      ))}
      {entries.length > 4 ? <span className="watchers__more">+{entries.length - 4}</span> : null}
    </div>
  );
}

/**
 * Mantiene el estado de presencia «fresco» para el indicador: el latido se
 * renueva cada pocos segundos aunque no haya movimiento del puntero (el `at`
 * solo se actualiza al publicar).
 */
export function usePresenceHeartbeat(session: BoardSession, enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => session.refreshPresenceState(), CURSOR_TTL_POLL_MS);
    return () => clearInterval(timer);
  }, [session, enabled]);
}

/** ¿Cuántos cursores ajenos se están pintando? (útil para pruebas de humo) */
export function useRemoteCursorCount(): number {
  return useRemotePresence().filter((entry) => entry.cursor !== null).length;
}

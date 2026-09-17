/**
 * Registro de actividad del tablero (punto 7 de la fase 5).
 *
 * Vista de quién, qué y cuándo, **agrupada por día**, alcanzable desde la barra
 * superior. Se nutre de `GET /boards/:id/activity` (paginado por cursor) y de las
 * acciones que el cliente reporta por lotes mientras se trabaja.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ActivitySquare, RefreshCw, X } from 'lucide-react';

import { fetchBoardActivity } from '@/api/activity';
import { degradationMessage, isMissingEndpoint } from '@/api/degraded';
import {
  type ActivityEntry,
  activityActor,
  activityTime,
  describeActivity,
  groupActivityByDay,
} from '@/lib/activityView';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useUiStore } from '@/state/uiStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';

export function ActivityPanel({ boardId }: { boardId: string }): JSX.Element | null {
  const open = usePanelsStore((state) => state.activityOpen);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const setOpen = usePanelsStore((state) => state.setActivityOpen);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiOnline = useAppStore((state) => state.apiOnline);

  const load = useCallback(
    async (nextCursor: string | null = null): Promise<void> => {
      if (!apiOnline) {
        setMissing(true);
        return;
      }
      setLoading(true);
      try {
        const page = await fetchBoardActivity(boardId, { cursor: nextCursor, limit: 100 });
        setEntries((current) => (nextCursor ? [...current, ...page.entries] : page.entries));
        setCursor(page.nextCursor);
        setMissing(false);
        setError(null);
      } catch (cause) {
        setMissing(isMissingEndpoint(cause));
        setError(degradationMessage(cause, 'Registro de actividad'));
      } finally {
        setLoading(false);
      }
    },
    [apiOnline, boardId],
  );

  useEffect(() => {
    if (!open) return undefined;
    void load(null);
    return undefined;
  }, [open, load]);

  const groups = useMemo(() => groupActivityByDay(entries), [entries]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal activity-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Registro de actividad"
        data-activity-panel
        data-activity-count={entries.length}
        ref={trapRef}
      >
        <div className="modal__head">
          <h2 className="modal__title">
            <ActivitySquare size={15} /> Actividad del tablero
          </h2>
          <button
            type="button"
            className="icon-button"
            title="Refrescar"
            data-activity-refresh
            onClick={() => void load(null)}
          >
            <RefreshCw size={13} className={loading ? 'spin' : undefined} />
          </button>
          <button type="button" className="icon-button" title="Cerrar" onClick={() => setOpen(false)}>
            <X size={14} />
          </button>
        </div>

        <div className="modal__body">
          {missing ? (
            <p className="activity-panel__warning" data-activity-missing>
              La API todavía no expone el registro de actividad de este tablero.
            </p>
          ) : null}
          {error && !missing ? <p className="activity-panel__warning">{error}</p> : null}

          {groups.length === 0 && !missing ? (
            <p className="activity-panel__empty" data-activity-empty>
              Todavía no hay actividad registrada en este tablero.
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="activity-panel__day" data-activity-day={group.key}>
                <h3 className="activity-panel__day-label">{group.label}</h3>
                <ul className="activity-panel__list">
                  {group.entries.map((entry) => (
                    <li key={entry.id} className="activity-row" data-activity-entry={entry.id}>
                      <span className="activity-row__time">{activityTime(entry)}</span>
                      <span className="activity-row__text">
                        <strong>{activityActor(entry)}</strong> {describeActivity(entry)}
                      </span>
                      {entry.elementId ? (
                        <button
                          type="button"
                          className="activity-row__jump"
                          title="Ir al elemento"
                          data-activity-jump={entry.elementId}
                          onClick={() => {
                            useUiStore.getState().requestFocus(boardId, entry.elementId!);
                            setOpen(false);
                          }}
                        >
                          Ir
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

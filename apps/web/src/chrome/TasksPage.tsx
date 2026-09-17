/**
 * Vista global de tareas (§6.3): página «Tareas» con los filtros de
 * `GET /api/tasks?filter=` (vencidas, hoy, próximas, hechas).
 *
 * Las tareas no viven en Postgres: el API aplana los ítems de los elementos
 * `todo` de todos los tableros. Acá se agrupan por tablero y cada fila salta a su
 * tarjeta: se pide el foco del elemento y se abre el tablero (el espacio de
 * trabajo consume el salto cuando el documento está listo).
 */

import { useEffect, useMemo, useState } from 'react';

import { CalendarClock, CheckSquare, ExternalLink, ListChecks, Loader2, X } from 'lucide-react';

import { type TaskFilter, dueDateLabel, isOverdue } from '@tablero/shared';

import { type TaskRow, fetchTasks } from '@/api/tasks';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';

const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'overdue', label: 'Vencidas' },
  { id: 'today', label: 'Hoy' },
  { id: 'upcoming', label: 'Próximas' },
  { id: 'done', label: 'Hechas' },
];

type BoardGroup = { boardId: string; boardTitle: string; rows: TaskRow[] };

export function TasksPage({ onOpenBoard }: { onOpenBoard(boardId: string): void }): JSX.Element | null {
  const open = useUiStore((state) => state.tasksOpen);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const [filter, setFilter] = useState<TaskFilter>('overdue');
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchTasks(filter, { limit: 500 })
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setError('No se pudieron leer las tareas: hace falta la API.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, filter]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') useUiStore.getState().setTasksOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const groups = useMemo<BoardGroup[]>(() => {
    const byBoard = new Map<string, BoardGroup>();
    for (const row of rows) {
      const group = byBoard.get(row.boardId);
      if (group) group.rows.push(row);
      else byBoard.set(row.boardId, { boardId: row.boardId, boardTitle: row.boardTitle, rows: [row] });
    }
    return [...byBoard.values()];
  }, [rows]);

  if (!open) return null;

  const close = (): void => useUiStore.getState().setTasksOpen(false);

  /** Salta a la tarjeta que contiene la tarea (y cierra la página). */
  const jump = (row: TaskRow): void => {
    useUiStore.getState().requestFocus(row.boardId, row.elementId);
    close();
    onOpenBoard(row.boardId);
    useAppStore.getState().setNotice('Saltando a la tarjeta de la tarea…');
  };

  const total = rows.length;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Tareas">
      <div className="modal__panel tasks" ref={trapRef}>
        <div className="modal__head">
          <h2 className="modal__title">
            <ListChecks size={15} /> Tareas
          </h2>
          {loading ? <Loader2 size={14} className="spin" /> : null}
          <span className="tasks__total" data-tasks-total={total}>
            {total === 1 ? '1 tarea' : `${total} tareas`}
          </span>
          <button type="button" className="icon-button" title="Cerrar (Esc)" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="tasks__filters" role="tablist" aria-label="Filtros de tareas">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === filter}
              data-tasks-filter={entry.id}
              className={`tasks__filter${entry.id === filter ? ' is-active' : ''}`}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="modal__body tasks__body">
          {error ? <p className="tasks__empty">{error}</p> : null}
          {!error && total === 0 ? (
            <p className="tasks__empty">
              {filter === 'overdue' ? 'Nada vencido. Bien ahí.' : 'No hay tareas para este filtro.'}
            </p>
          ) : null}

          {groups.map((group) => (
            <section key={group.boardId} className="tasks__group" aria-label={group.boardTitle}>
              <h3 className="tasks__group-title">
                {group.boardTitle || 'Tablero'}
                <span className="tasks__group-count">{group.rows.length}</span>
              </h3>
              <ul className="tasks__list">
                {group.rows.map((row) => (
                  <li
                    key={`${row.listId}-${row.itemId}`}
                    className={`tasks__row${row.checked ? ' is-done' : ''}${row.depth > 0 ? ' tasks__row--child' : ''}`}
                    data-task-item={row.itemId}
                  >
                    <span className="tasks__check" aria-hidden="true">
                      <CheckSquare size={13} fill={row.checked ? 'currentColor' : 'none'} />
                    </span>
                    <span className="tasks__text" title={row.text}>
                      {row.text.trim().length > 0 ? row.text : 'Tarea sin texto'}
                    </span>
                    {row.dueDate ? (
                      <span className={`tasks__due${isOverdue(row.dueDate) ? ' is-overdue' : ''}`}>
                        <CalendarClock size={11} />
                        {dueDateLabel(row.dueDate)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="tasks__jump"
                      title="Ir a la tarjeta"
                      onClick={() => jump(row)}
                    >
                      <ExternalLink size={12} />
                      Ir
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

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

import { CalendarClock, CheckSquare, ExternalLink, ListChecks, Loader2 } from 'lucide-react';

import { type TaskFilter, dueDateLabel, isOverdue } from '@tablero/shared';

import { type TaskRow, fetchTasks } from '@/api/tasks';
import { toast } from '@/lib/toast';
import { useUiStore } from '@/state/uiStore';

import { EmptyState } from './EmptyState';
import { Modal } from './Modal';

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
    toast.info('Saltando a la tarjeta de la tarea…');
  };

  const total = rows.length;

  return (
    <Modal
      title="Tareas"
      icon={<ListChecks size={15} aria-hidden="true" />}
      onClose={close}
      panelClassName="tasks"
      headActions={
        <>
          {loading ? <Loader2 size={14} className="spin" /> : null}
          <span className="tasks__total" data-tasks-total={total}>
            {total === 1 ? '1 tarea' : `${total} tareas`}
          </span>
        </>
      }
    >
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
          <EmptyState
            icon={<CheckSquare size={26} />}
            title={filter === 'overdue' ? 'Nada vencido' : 'No hay tareas'}
            text={
              filter === 'overdue'
                ? 'Todas las tareas con fecha están al día.'
                : 'Ninguna tarea coincide con este filtro. Prueba con otro.'
            }
            data-tasks-empty
          />
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
    </Modal>
  );
}

/**
 * Tarjeta de lista de tareas.
 *
 * Teclado como en Milanote: `Enter` crea la siguiente tarea, `Tab`/`Shift+Tab`
 * sangran y desangran (un solo nivel), `Retroceso` con la tarea vacía la borra y
 * las flechas recorren la lista. Las filas se arrastran para reordenar y se
 * pueden soltar en otra lista (el arrastre entre tarjetas cambia el documento de
 * las dos, siempre en una transacción por lado).
 *
 * La fecha de vencimiento se escribe (`hoy`, `viernes`, `25/12`, `+7`) y se
 * interpreta con `parseDueDate`; el chip muestra `dueDateLabel`.
 */

import { useEffect, useRef, useState } from 'react';

import { CalendarDays, Eye, EyeOff, GripVertical, ListPlus, X } from 'lucide-react';

import {
  type CanvasElement,
  type TodoItem,
  addTask,
  countTasks,
  dueDateLabel,
  findTask,
  indentTask,
  isOverdue,
  outdentTask,
  parseDueDate,
  patchElement,
  progressLabel,
  removeTask,
  toggleTask,
  updateTask,
} from '@tablero/shared';

import { worldFromClient } from '@/canvas/canvasRef';
import type { BoardSession } from '@/collab/BoardSession';
import { InlineEdit } from '@/elements/InlineEdit';
import {
  insertTask,
  insertTaskAfter,
  lastTaskId,
  previousTaskId,
  taskDropTarget,
  taskRows,
  type TaskRowView,
} from '@/lib/taskEditing';
import { useUiStore } from '@/state/uiStore';

type TodoCardProps = {
  session: BoardSession;
  element: CanvasElement;
  simplified: boolean;
};

/** Cambia los ítems de la lista (una transacción). */
function commitItems(session: BoardSession, elementId: string, items: TodoItem[]): void {
  patchElement(session.doc, elementId, { items }, session.origin);
}

type RowDropTarget = { listId: string; parentId: string | null; index: number };

type DropFound = {
  target: RowDropTarget;
  /** Línea de inserción, en coordenadas de pantalla. */
  line: { x: number; y: number; width: number };
};

/**
 * Destino de una tarea soltada.
 *
 * Primero busca la **fila** bajo el puntero (antes/después de ella o como
 * subtarea, según `taskDropTarget`). Si no hay fila —se soltó en el hueco de
 * abajo, sobre el pie de la lista o sobre el encabezado— vale la **lista**
 * entera: la tarea entra al final del primer nivel. Sin esto, soltar en el
 * borde inferior de una lista (lo más natural del mundo) no hacía nada.
 */
function dropTargetAt(clientX: number, clientY: number): DropFound | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    const row = (node as HTMLElement).closest?.('[data-task-row]') as HTMLElement | null;
    if (!row) continue;
    const listId = row.dataset.listId;
    const rowId = row.dataset.taskRow;
    if (!listId || !rowId) continue;
    const rect = row.getBoundingClientRect();
    const depth = row.dataset.depth === '1' ? 1 : 0;
    const topIndex = Number(row.dataset.topIndex ?? '0');
    const target = taskDropTarget(
      { id: rowId, depth, topIndex },
      clientX,
      rect.left + 6,
      clientY,
      rect.top + rect.height / 2,
    );
    return {
      target: { listId, ...target },
      line: { x: rect.left + 4, y: rect.top, width: Math.max(24, rect.width - 8) },
    };
  }

  for (const node of stack) {
    const list = (node as HTMLElement).closest?.('[data-todo-id]') as HTMLElement | null;
    if (!list) continue;
    const listId = list.dataset.todoId;
    if (!listId) continue;
    const rows = list.querySelector('.todo__rows') ?? list;
    const rect = rows.getBoundingClientRect();
    return {
      target: { listId, parentId: null, index: Number.MAX_SAFE_INTEGER },
      line: { x: rect.left + 4, y: rect.bottom - 1, width: Math.max(24, rect.width - 8) },
    };
  }
  return null;
}

function TaskRow({
  session,
  elementId,
  item,
  depth,
  topIndex,
  items,
  focusId,
  onFocusHandled,
  onRequestFocus,
}: {
  session: BoardSession;
  elementId: string;
  item: TodoItem;
  depth: 0 | 1;
  topIndex: number;
  items: TodoItem[];
  focusId: string | null;
  onFocusHandled(): void;
  onRequestFocus(id: string): void;
}): JSX.Element {
  const [draft, setDraft] = useState(item.text);
  const [focused, setFocused] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [dueDraft, setDueDraft] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const rowNode = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!focused) setDraft(item.text);
  }, [item.text, focused]);

  useEffect(() => {
    if (focusId !== item.id) return;
    const node = input.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
    onFocusHandled();
  }, [focusId, item.id, onFocusHandled]);

  useEffect(() => {
    if (!dragging) return;
    let moved = false;
    const onMove = (event: PointerEvent): void => {
      if (
        !moved &&
        Math.abs(event.clientX - dragStart.current.x) < 4 &&
        Math.abs(event.clientY - dragStart.current.y) < 4
      ) {
        return;
      }
      moved = true;
      const found = dropTargetAt(event.clientX, event.clientY);
      const ui = useUiStore.getState();
      if (!found) {
        ui.setDropLine(null);
        return;
      }
      ui.setDropLine(found.line);
    };
    const onUp = (event: PointerEvent): void => {
      setDragging(false);
      useUiStore.getState().setDropLine(null);
      if (!moved) return;
      const found = dropTargetAt(event.clientX, event.clientY);
      if (!found) return;
      const source = session.getElement(elementId);
      if (!source || source.type !== 'todo') return;
      const sourceItems = source.items ?? [];
      const foundTask = findTask(sourceItems, item.id);
      if (!foundTask) return;
      const task = foundTask.item;
      const target = session.getElement(found.target.listId);
      if (!target || target.type !== 'todo') return;
      if (found.target.listId === elementId) {
        // Reordenar dentro de la misma lista (una transacción).
        const without = removeTask(sourceItems, item.id);
        const next = insertTask(without, task, found.target.parentId, found.target.index);
        commitItems(session, elementId, next);
        return;
      }
      // Mover a otra lista: un paso de deshacer por cada documento implicado.
      session.doc.transact(() => {
        patchElement(session.doc, elementId, { items: removeTask(sourceItems, item.id) }, session.origin, {
          touch: false,
        });
        patchElement(
          session.doc,
          found.target.listId,
          { items: insertTask(target.items ?? [], task, found.target.parentId, found.target.index) },
          session.origin,
        );
      }, session.origin);
    };
    const onCancel = (): void => {
      setDragging(false);
      useUiStore.getState().setDropLine(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    document.body.classList.add('is-dragging');
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.classList.remove('is-dragging');
    };
  }, [dragging, elementId, item.id, session]);

  const commitText = (): void => {
    setFocused(false);
    if (draft === item.text) return;
    commitItems(session, elementId, updateTask(items, item.id, { text: draft }));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation();
    const ui = useUiStore.getState();
    if (event.key === 'Enter') {
      event.preventDefault();
      // La tarea nueva queda lista para escribir (como en Milanote).
      const result = insertTaskAfter(items, item.id, '');
      commitItems(session, elementId, result.items);
      onRequestFocus(result.id);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      commitItems(
        session,
        elementId,
        event.shiftKey ? outdentTask(items, item.id) : indentTask(items, item.id),
      );
      return;
    }
    if (event.key === 'Backspace' && draft.length === 0) {
      event.preventDefault();
      const previous = previousTaskId(items, item.id);
      commitItems(session, elementId, removeTask(items, item.id));
      if (previous && rowNode.current) {
        const node = document.querySelector<HTMLInputElement>(`input[data-task-input="${CSS.escape(previous)}"]`);
        node?.focus();
      }
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const rows = taskRows(items);
      const index = rows.findIndex((row) => row.item.id === item.id);
      const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      const node = document.querySelector<HTMLInputElement>(`input[data-task-input="${CSS.escape(next.item.id)}"]`);
      node?.focus();
      return;
    }
    if (event.key === 'Escape') {
      setDraft(item.text);
      event.currentTarget.blur();
      return;
    }
    if (ui.dropLine) ui.setDropLine(null);
  };

  const overdue = isOverdue(item.dueDate);
  const classes = ['todo__row'];
  if (depth === 1) classes.push('todo__row--child');
  if (item.checked) classes.push('is-done');
  if (overdue) classes.push('is-overdue');

  return (
    <div
      ref={rowNode}
      className={dragging ? `${classes.join(' ')} is-dragging` : classes.join(' ')}
      data-task-row={item.id}
      data-list-id={elementId}
      data-depth={depth}
      data-top-index={topIndex}
      data-interactive
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="todo__handle"
        title="Arrastrar para reordenar o cambiar de lista"
        aria-label="Arrastrar tarea"
        onPointerDown={(event) => {
          event.stopPropagation();
          if (event.button !== 0) return;
          dragStart.current = { x: event.clientX, y: event.clientY };
          setDragging(true);
        }}
      >
        <GripVertical size={12} />
      </button>

      <label className="todo__check">
        <input
          type="checkbox"
          checked={item.checked}
          aria-label={item.checked ? 'Desmarcar tarea' : 'Marcar tarea como hecha'}
          onChange={() => commitItems(session, elementId, toggleTask(items, item.id))}
        />
      </label>

      <input
        ref={input}
        className="todo__text"
        data-task-input={item.id}
        value={draft}
        placeholder="Nueva tarea"
        aria-label="Texto de la tarea"
        onFocus={() => setFocused(true)}
        onBlur={commitText}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />

      {dueOpen ? (
        <span className="todo__due-editor">
          <input
            className="todo__due-input"
            autoFocus
            value={dueDraft}
            placeholder="hoy, viernes, 25/12, +7"
            aria-label="Fecha de vencimiento"
            onChange={(event) => setDueDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') {
                setDueOpen(false);
                return;
              }
              if (event.key !== 'Enter') return;
              const iso = parseDueDate(dueDraft);
              if (!iso) return;
              commitItems(session, elementId, updateTask(items, item.id, { dueDate: iso }));
              setDueOpen(false);
            }}
          />
          <button
            type="button"
            className="todo__chip"
            title="Hoy"
            onClick={() => {
              commitItems(session, elementId, updateTask(items, item.id, { dueDate: parseDueDate('hoy') }));
              setDueOpen(false);
            }}
          >
            hoy
          </button>
          <button
            type="button"
            className="todo__chip"
            title="Mañana"
            onClick={() => {
              commitItems(session, elementId, updateTask(items, item.id, { dueDate: parseDueDate('mañana') }));
              setDueOpen(false);
            }}
          >
            mañana
          </button>
          <button
            type="button"
            className="todo__chip"
            title="En una semana"
            onClick={() => {
              commitItems(session, elementId, updateTask(items, item.id, { dueDate: parseDueDate('+7') }));
              setDueOpen(false);
            }}
          >
            +7
          </button>
        </span>
      ) : null}

      {item.dueDate && !dueOpen ? (
        <button
          type="button"
          className={`todo__due${overdue ? ' is-overdue' : ''}`}
          title={`Vence el ${item.dueDate}`}
          onClick={() => {
            setDueDraft(item.dueDate ?? '');
            setDueOpen(true);
          }}
        >
          <CalendarDays size={11} />
          <span>{dueDateLabel(item.dueDate)}</span>
        </button>
      ) : null}

      {!item.dueDate && !dueOpen ? (
        <button
          type="button"
          className="todo__due todo__due--empty"
          title="Añadir fecha de vencimiento"
          onClick={() => {
            setDueDraft('');
            setDueOpen(true);
          }}
        >
          <CalendarDays size={11} />
        </button>
      ) : null}

      {item.dueDate && dueOpen ? (
        <button
          type="button"
          className="todo__due-clear"
          title="Quitar fecha"
          onClick={() => {
            commitItems(session, elementId, updateTask(items, item.id, { dueDate: null }));
            setDueOpen(false);
          }}
        >
          <X size={11} />
        </button>
      ) : null}

      <button
        type="button"
        className="todo__remove"
        title="Eliminar tarea"
        aria-label="Eliminar tarea"
        onClick={() => commitItems(session, elementId, removeTask(items, item.id))}
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function TodoCard({ session, element, simplified }: TodoCardProps): JSX.Element | null {
  const [focusId, setFocusId] = useState<string | null>(null);

  if (element.type !== 'todo') return null;

  const items = element.items ?? [];
  const hideCompleted = element.hideCompleted === true;
  const progress = countTasks(items);
  const ratio = Math.round(progress.ratio * 100);

  if (simplified) {
    return (
      <div className="el-simplified" title={progressLabel(items)}>
        {progressLabel(items)} · {items[0]?.text ?? 'Tareas'}
      </div>
    );
  }

  const rows = taskRows(items);
  const visible = hideCompleted ? rows.filter((row) => !row.item.checked) : rows;

  return (
    <div className="todo" data-todo-id={element.id} data-interactive>
      <header className="todo__head">
        <InlineEdit
          className="todo__title"
          value={element.title ?? ''}
          placeholder="Tareas"
          ariaLabel="Título de la lista de tareas"
          onCommit={(value) => patchElement(session.doc, element.id, { title: value }, session.origin)}
        />
        <button
          type="button"
          className="icon-button icon-button--small"
          title={hideCompleted ? 'Mostrar las completadas' : 'Ocultar las completadas'}
          aria-pressed={hideCompleted}
          onClick={() => patchElement(session.doc, element.id, { hideCompleted: !hideCompleted }, session.origin)}
        >
          {hideCompleted ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </header>

      <div className="todo__progress" role="group" aria-label="Progreso">
        <div className="todo__bar" role="progressbar" aria-valuenow={ratio} aria-valuemin={0} aria-valuemax={100}>
          <span className="todo__bar-fill" style={{ width: `${ratio}%` }} />
        </div>
        <span className="todo__progress-label">{progressLabel(items)}</span>
      </div>

      <div className="todo__rows">
        {visible.length === 0 ? <p className="todo__empty">Sin tareas todavía</p> : null}
        {visible.map((row: TaskRowView) => (
          <TaskRow
            key={row.item.id}
            session={session}
            elementId={element.id}
            item={row.item}
            depth={row.depth}
            topIndex={row.topIndex}
            items={items}
            focusId={focusId}
            onFocusHandled={() => setFocusId(null)}
            onRequestFocus={(id) => setFocusId(id)}
          />
        ))}
      </div>

      <button
        type="button"
        className="todo__add"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          const last = lastTaskId(items);
          const result = last ? insertTaskAfter(items, last, '') : { items: addTask(items, ''), id: '' };
          const id = last ? result.id : result.items[result.items.length - 1]?.id ?? '';
          commitItems(session, element.id, result.items);
          if (id) setFocusId(id);
        }}
      >
        <ListPlus size={13} />
        <span>Añadir tarea</span>
      </button>
    </div>
  );
}

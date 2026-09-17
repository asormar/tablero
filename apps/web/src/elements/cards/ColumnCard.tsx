/**
 * Tarjeta de columna: contenedor de tarjetas en fila (kanban con varias).
 *
 * Los hijos no tienen posición libre: se apilan en `childrenIds` y este
 * componente los pinta en el orden de esa lista, con un `<div data-child-id>`
 * por tarjeta. De ahí salen el reordenamiento (arrastrar dentro), el paso a otra
 * columna y la salida al lienzo: las posiciones se miden en el DOM, porque es el
 * flujo de la columna el que las decide.
 *
 * Las alturas de los hijos las mide el `ResizeObserver` compartido (cada tarjeta
 * lleva su `data-element-id`), así el resto del editor los ve con su tamaño real.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDown, ChevronRight, Inbox, ListPlus, StickyNote } from 'lucide-react';

import { type CanvasElement, isTrashed } from '@tablero/shared';

import { worldFromClient } from '@/canvas/canvasRef';
import { createChildInColumn, createTaskCardInColumn, pruneColumnChildren, setColumnCollapsed, setColumnTitle } from '@/canvas/columnCommands';
import { clearColumnHighlight, highlightColumn, startKanbanDrag, type KanbanDrag } from '@/canvas/kanbanDrag';
import type { BoardSession } from '@/collab/BoardSession';
import { useSessionElement } from '@/collab/SessionContext';
import { ElementContent } from '@/elements/ElementContent';
import { InlineEdit } from '@/elements/InlineEdit';
import { columnChildren } from '@/lib/columns';
import { columnCountLabel } from '@/lib/kanban';
import { observeHeight, unobserveHeight } from '@/canvas/measure';
import { registerNode } from '@/canvas/nodeRegistry';
import { noteSurface } from '@/lib/smartPaste';
import { useSettingsStore } from '@/settings/settingsStore';
import { useUiStore } from '@/state/uiStore';

/** Tarjeta dentro de una columna: misma tarjeta, sin posición absoluta. */
function ColumnChild({ session, id, simplified }: { session: BoardSession; id: string; simplified: boolean }) {
  const element = useSessionElement(id);
  const node = useRef<HTMLDivElement | null>(null);
  const editingId = useUiStore((state) => state.editingId);
  const selected = useUiStore((state) => state.selection.includes(id));
  const theme = useSettingsStore((state) => state.resolvedTheme);
  const [drag, setDrag] = useState<KanbanDrag | null>(null);
  // La clase de arrastre se pone recién cuando el gesto se movió: un clic (o el
  // doble clic que abre un documento) no puede quedar con `pointer-events: none`.
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const current = node.current;
    const target = current?.querySelector<HTMLElement>('[data-element-id]') ?? current;
    if (!target) return;
    registerNode(id, target);
    observeHeight(target);
    return () => {
      registerNode(id, null);
      unobserveHeight(target);
    };
  }, [id]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent): void => {
      drag.move(event.clientX, event.clientY);
      // La marca visual de arrastre (y el `pointer-events: none`) llega recién
      // cuando hubo movimiento real: así el clic y el doble clic siguen siendo
      // de la tarjeta.
      if (drag.moved) setMoving((current) => (current ? current : true));
    };
    const onUp = (): void => {
      drag.end(true);
      setDrag(null);
      setMoving(false);
    };
    const onCancel = (): void => {
      drag.end(false);
      setDrag(null);
      setMoving(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      onCancel();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    document.body.classList.add('is-dragging');
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('is-dragging');
      clearColumnHighlight();
      useUiStore.getState().setDropLine(null);
    };
  }, [drag]);

  if (!element || isTrashed(element)) return null;

  const startDrag = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const ui = useUiStore.getState();
    ui.select([id]);
    if (ui.editingId && ui.editingId !== id) ui.setEditing(null);
    setDrag(
      startKanbanDrag({
        session,
        id,
        worldAt: (x, y) => worldFromClient(x, y),
        onTarget: (target) => {
          useUiStore.getState().setDropLine(target ? target.line : null);
          highlightColumn(target?.columnId ?? null);
        },
        onOffset: (dx, dy) => {
          const current = node.current?.querySelector<HTMLElement>('[data-element-id]') ?? null;
          if (!current) return;
          current.style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`;
        },
      }),
    );
  };

  const classes = ['el', `el--${element.type}`, 'col__card'];
  if (selected) classes.push('is-selected');
  if (editingId === id) classes.push('is-editing');
  if (moving) classes.push('is-dragging');
  if (simplified) classes.push('is-zoomed-out');

  const surface = element.hex || (element.color !== undefined && element.color !== 'none')
    ? noteSurface(element.color, element.hex, theme)
    : null;

  return (
    <div ref={node} className="col__child" data-child-id={id} onPointerDown={startDrag}>
      <div
        className={classes.join(' ')}
        data-element-id={id}
        data-type={element.type}
        role="group"
        aria-label={element.type}
        style={surface ? { background: surface.background, color: surface.color } : undefined}
      >
        <ElementContent session={session} element={element} editing={editingId === id} simplified={simplified} />
      </div>
    </div>
  );
}

export type ColumnCardProps = {
  session: BoardSession;
  element: CanvasElement;
  simplified: boolean;
  editing: boolean;
};

export function ColumnCard({ session, element, simplified }: ColumnCardProps): JSX.Element | null {
  const collapsed = element.type === 'column' ? element.collapsed === true : false;
  const title = element.type === 'column' ? element.title : '';
  const children = useMemo(() => columnChildren(session, element.id), [session, element]);

  // Los hijos que ya no existen (borrados, movidos) se limpian de la lista:
  // si no, la columna acumularía ids muertos para siempre.
  useEffect(() => {
    const timer = setTimeout(() => pruneColumnChildren(session, element.id), 250);
    return () => clearTimeout(timer);
  }, [session, element.id, children.length]);

  if (element.type !== 'column') return null;

  return (
    <div className="col">
      <header className="col__head">
        <button
          type="button"
          className="col__toggle"
          title={collapsed ? 'Desplegar columna' : 'Plegar columna'}
          aria-expanded={!collapsed}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setColumnCollapsed(session, element.id, !collapsed)}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className="col__count" title={columnCountLabel(children.length)}>
          {children.length}
        </span>
        <InlineEdit
          className="col__title"
          value={title}
          placeholder="Columna sin título"
          ariaLabel="Título de la columna"
          onCommit={(value) => setColumnTitle(session, element.id, value)}
        />
        <div className="col__actions">
          <button
            type="button"
            className="icon-button icon-button--small"
            title="Nueva tarea en la columna"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              const id = createTaskCardInColumn(session, element.id);
              if (id) useUiStore.getState().select([id]);
            }}
          >
            <ListPlus size={14} />
          </button>
          <button
            type="button"
            className="icon-button icon-button--small"
            title="Nueva nota en la columna"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              const id = createChildInColumn(session, element.id, 'note');
              if (id) useUiStore.getState().select([id]);
            }}
          >
            <StickyNote size={14} />
          </button>
        </div>
      </header>

      {collapsed ? null : (
        <div className="col__body" data-column-body data-column-id={element.id}>
          {children.map((child) => (
            <ColumnChild key={child.id} session={session} id={child.id} simplified={simplified} />
          ))}
          {children.length === 0 ? (
            <div className="col__empty">
              <span className="col__empty-icon" aria-hidden="true">
                <Inbox size={20} />
              </span>
              <p>Suelta tarjetas aquí</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

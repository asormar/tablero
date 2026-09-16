/**
 * Lienzo infinito.
 *
 * Todas las interacciones de puntero se resuelven aquí por delegación (un solo
 * `pointerdown` en la raíz): selección, arrastre con guías, tiradores de ancho,
 * lazo, paneo, anclas de conector y menú contextual. El arrastre escribe en el
 * DOM y solo commitea al soltar, con una única transacción.
 *
 * Desde la fase 3 el mismo gesto de arrastre resuelve además el destino: una
 * columna (kanban) o una tarjeta de tablero / miga de pan (mover de tablero). Las
 * flechas siguen a las tarjetas porque su geometría se reescribe cada frame.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type ElementType,
  type FixedSide,
  type HeadingSize,
  type Point,
  type Rect,
  isRichTextType,
  moveElements,
  rectFromPoints,
  screenToWorld,
} from '@tablero/shared';

import { addElementsToColumn } from '@/canvas/columnCommands';
import { connectorAtPoint, refreshConnectorNodes } from '@/canvas/connectorGeometry';
import { startConnectorDrag } from '@/canvas/connectorDrag';
import { ConnectorLayer } from '@/canvas/ConnectorLayer';
import { highlightColumn, kanbanTargetAt, type KanbanTarget } from '@/canvas/kanbanDrag';
import type { BoardSession } from '@/collab/BoardSession';
import { createNoteAt, editElement, idsInRect, resizeSelectionWidth } from '@/canvas/commands';
import { HEADING_MIME, TOOL_MIME, createToolAt, createToolInColumn, hasFiles, isToolDrag } from '@/canvas/toolDrop';
import { attachFilesToBoard } from '@/canvas/uploadController';
import { transferElements, transferFailureMessage } from '@/lib/boardTransfer';
import { boardDropTargetAt, clearBoardHighlight, type BoardDropTarget } from '@/lib/boardDrop';
import { rectOf } from '@/lib/layout';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

import { canvasPoint, setCanvasRoot, worldFromClient } from './canvasRef';
import { ElementLayer } from './ElementLayer';
import { CanvasGrid, ConnectorDraftOverlay, DropLineOverlay, GuidesOverlay, MarqueeOverlay } from './Overlays';
import {
  type DragItem,
  type PointerDrag,
  startMoveDrag,
  startWidthResize,
} from './interactions';
import type { ResizeDirection } from '@/lib/dragMath';
import { isSpacePan } from './panMode';

type TrackOptions = {
  /** Esc cancela el gesto (arrastres); en paneo y lazo no hace falta. */
  cancelOnEscape?: boolean;
  cursorClass?: string;
};

/**
 * Escucha `pointermove`/`pointerup` en la ventana (no en el nodo, para no perder
 * el gesto al salir del elemento) y limpia siempre.
 */
function trackPointer(
  onMove: (event: PointerEvent) => void,
  onEnd: (commit: boolean, event: PointerEvent | null) => void,
  options: TrackOptions = {},
): () => void {
  let finished = false;
  let last: PointerEvent | null = null;

  const cleanup = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
    document.body.classList.remove('is-dragging');
    if (options.cursorClass) document.body.classList.remove(options.cursorClass);
  };

  function move(event: PointerEvent): void {
    last = event;
    onMove(event);
  }
  function up(event: PointerEvent): void {
    if (finished) return;
    finished = true;
    cleanup();
    onEnd(true, event);
  }
  function cancel(event: PointerEvent): void {
    if (finished) return;
    finished = true;
    cleanup();
    onEnd(false, event);
  }
  function key(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (finished) return;
    finished = true;
    cleanup();
    onEnd(false, last);
  }

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  if (options.cancelOnEscape !== false) window.addEventListener('keydown', key);
  document.body.classList.add('is-dragging');
  if (options.cursorClass) document.body.classList.add(options.cursorClass);

  return () => {
    finished = true;
    cleanup();
  };
}

export type CanvasProps = {
  session: BoardSession;
  onOpenBoard(boardId: string): void;
};

export function Canvas({ session, onOpenBoard }: CanvasProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeTrack = useRef<(() => void) | null>(null);
  const viewport = useUiStore((state) => state.viewport);
  const interaction = useUiStore((state) => state.interaction);

  // --- Montaje: referencia global + tamaño para virtualizar ------------------
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    setCanvasRoot(node);
    useUiStore.getState().setCanvasSize({ width: node.clientWidth, height: node.clientHeight });
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      useUiStore.getState().setCanvasSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      setCanvasRoot(null);
    };
  }, []);

  useEffect(() => {
    return () => {
      activeTrack.current?.();
      activeTrack.current = null;
    };
  }, []);

  // --- Rueda: desplaza; con Ctrl/Cmd hace zoom centrado en el cursor --------
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent): void => {
      const ui = useUiStore.getState();
      const point = canvasPoint(event.clientX, event.clientY);
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const dy = event.deltaY * factor;
      const dx = event.deltaX * factor;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        ui.zoomAtPoint(point, ui.viewport.scale * Math.exp(-dy * 0.002));
        return;
      }
      event.preventDefault();
      if (event.shiftKey && dx === 0) {
        ui.pan(-dy, 0);
        return;
      }
      ui.pan(-dx, -dy);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  // --- Gestos ---------------------------------------------------------------

  const startPan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    let lastX = event.clientX;
    let lastY = event.clientY;
    let accX = 0;
    let accY = 0;
    let frame = 0;
    useUiStore.getState().setInteraction('pan');
    activeTrack.current = trackPointer(
      (moveEvent) => {
        accX += moveEvent.clientX - lastX;
        accY += moveEvent.clientY - lastY;
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const stepX = accX;
          const stepY = accY;
          accX = 0;
          accY = 0;
          useUiStore.getState().pan(stepX, stepY);
        });
      },
      () => {
        if (frame !== 0) cancelAnimationFrame(frame);
        useUiStore.getState().setInteraction('idle');
        activeTrack.current = null;
      },
      { cancelOnEscape: false, cursorClass: 'is-panning' },
    );
  }, []);

  const startMarquee = useCallback(
    (startPoint: Point, additive: boolean) => {
      const ui = useUiStore.getState();
      const startWorld = screenToWorld(ui.viewport, startPoint);
      const base = additive ? [...ui.selection] : [];
      if (!additive) ui.clearSelection();
      ui.setEditing(null);
      ui.setInteraction('marquee');

      let latest = startPoint;
      let frame = 0;
      let lastKey = ui.selection.join('|');

      activeTrack.current = trackPointer(
        (event) => {
          latest = canvasPoint(event.clientX, event.clientY);
          if (frame !== 0) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            const state = useUiStore.getState();
            const rect: Rect = rectFromPoints(startWorld, screenToWorld(state.viewport, latest));
            state.setMarquee(rect);
            const hits = idsInRect(session.getLayout(), rect);
            const next = additive ? [...new Set([...base, ...hits])] : hits;
            const key = next.join('|');
            if (key === lastKey) return;
            lastKey = key;
            useUiStore.getState().select(next);
          });
        },
        () => {
          if (frame !== 0) cancelAnimationFrame(frame);
          const state = useUiStore.getState();
          state.setMarquee(null);
          state.setInteraction('idle');
          activeTrack.current = null;
        },
        { cancelOnEscape: false },
      );
    },
    [session],
  );

  /** Mueve tarjetas a otro tablero (soltar sobre una tarjeta de tablero o una miga). */
  const moveToBoard = useCallback(
    (ids: string[], boardId: string): void => {
      void transferElements(session, ids, boardId).then((result) => {
        const store = useAppStore.getState();
        if (result.failure) {
          store.setNotice(transferFailureMessage(result.failure));
          return;
        }
        store.setNotice(
          result.moved === 1 ? 'Se movió 1 tarjeta a otro tablero.' : `Se movieron ${result.moved} tarjetas a otro tablero.`,
        );
      });
    },
    [session],
  );

  const startMove = useCallback(
    (grabId: string, startPoint: Point) => {
      const ui = useUiStore.getState();
      const ids = ui.selection.includes(grabId) ? ui.selection : [grabId];
      const wanted = new Set(ids);
      const measured = ui.measuredHeights;
      const items: DragItem[] = [];
      for (const item of session.getLayout()) {
        if (!wanted.has(item.id) || item.locked) continue;
        items.push({ id: item.id, rect: rectOf(item, measured) });
      }
      if (items.length === 0) return;

      const moving = new Set(items.map((item) => item.id));
      const excluded = new Set(moving);
      const canvasSize = ui.canvasSize;
      const targets = session.getTargetRects(measured, excluded, {
        x: ui.viewport.x,
        y: ui.viewport.y,
        width: canvasSize.width / ui.viewport.scale,
        height: canvasSize.height / ui.viewport.scale,
      });

      let dropColumn: KanbanTarget | null = null;
      let dropBoard: BoardDropTarget | null = null;

      ui.setInteraction('move');
      ui.setGuides([]);
      const drag: PointerDrag = startMoveDrag({
        items,
        targets,
        viewport: ui.viewport,
        startPointer: startPoint,
        onFrame: (pointer) => {
          // Las flechas siguen a las tarjetas: geometría reescrita en el DOM.
          refreshConnectorNodes(session);
          const column = kanbanTargetAt(pointer.x, pointer.y, moving);
          dropColumn = column;
          const board = column ? null : boardDropTargetAt(pointer.x, pointer.y, session, moving);
          dropBoard = board;
          const store = useUiStore.getState();
          store.setDropLine(column ? column.line : null);
          if (column) highlightColumn(column.columnId);
          else highlightColumn(null);
          if (!board) clearBoardHighlight();
        },
        onCommit: (moves) => {
          if (dropColumn) {
            // Soltada dentro de una columna: manda el kanban, no la posición libre.
            addElementsToColumn(session, dropColumn.columnId, [...moving], dropColumn.index);
            return;
          }
          if (dropBoard) {
            moveToBoard([...moving], dropBoard.boardId);
            return;
          }
          moveElements(session.doc, moves, session.origin);
        },
      });
      activeTrack.current = trackPointer(
        (event) => drag.move({ x: event.clientX, y: event.clientY }),
        (commit) => {
          drag.end(commit);
          const store = useUiStore.getState();
          store.setDropLine(null);
          store.setInteraction('idle');
          highlightColumn(null);
          clearBoardHighlight();
          activeTrack.current = null;
        },
      );
    },
    [moveToBoard, session],
  );

  const startResize = useCallback(
    (id: string, direction: ResizeDirection | 'se', startPoint: Point) => {
      const ui = useUiStore.getState();
      const item = session.getLayout().find((entry) => entry.id === id);
      if (!item) return;
      ui.setInteraction('resize');
      const drag = startWidthResize({
        item: { id, rect: rectOf(item, ui.measuredHeights) },
        direction,
        viewport: ui.viewport,
        startPointer: startPoint,
        onCommit: (change) => {
          resizeSelectionWidth(session, [change]);
        },
      });
      activeTrack.current = trackPointer(
        (event) => drag.move(canvasPoint(event.clientX, event.clientY)),
        (commit) => {
          drag.end(commit);
          useUiStore.getState().setInteraction('idle');
          activeTrack.current = null;
        },
      );
    },
    [session],
  );

  /** Arrastra desde el borde de una tarjeta para crear un conector. */
  const startConnector = useCallback(
    (fromId: string, side: FixedSide, startClient: Point) => {
      const ui = useUiStore.getState();
      ui.setSelectedConnector(null);
      const drag = startConnectorDrag({
        session,
        fromId,
        side,
        startClient,
        onPreview: (draft) => useUiStore.getState().setConnectorDraft(draft),
      });
      activeTrack.current = trackPointer(
        (event) => drag.move(event.clientX, event.clientY),
        (commit, event) => {
          drag.end(commit, event?.clientX ?? startClient.x, event?.clientY ?? startClient.y);
          useUiStore.getState().setConnectorDraft(null);
          activeTrack.current = null;
        },
        { cancelOnEscape: false, cursorClass: 'is-connecting' },
      );
    },
    [session],
  );

  // --- Eventos de ratón ------------------------------------------------------

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest('[contenteditable="true"], input, textarea, select')) return;
      if (event.button === 1) event.preventDefault();
      if (event.button !== 0 && event.button !== 1) return;

      const ui = useUiStore.getState();
      if (ui.contextMenu) ui.setContextMenu(null);
      const startPoint = canvasPoint(event.clientX, event.clientY);

      if (event.button === 1 || isSpacePan()) {
        startPan(event);
        return;
      }

      const elementEl = target.closest('[data-element-id]') as HTMLElement | null;

      // Anclas de conector: arrastrar desde el borde de una tarjeta.
      const anchorEl = target.closest('[data-anchor]') as HTMLElement | null;
      if (anchorEl && elementEl) {
        const id = elementEl.dataset.elementId;
        const side = anchorEl.dataset.anchor;
        if (id && (side === 'left' || side === 'right' || side === 'top' || side === 'bottom')) {
          startConnector(id, side as FixedSide, { x: event.clientX, y: event.clientY });
          return;
        }
      }

      const handleEl = target.closest('[data-handle]');
      if (handleEl && elementEl) {
        const id = elementEl.dataset.elementId;
        const direction = handleEl.getAttribute('data-handle');
        if (id && (direction === 'w' || direction === 'e' || direction === 'se')) {
          startResize(id, direction, startPoint);
          return;
        }
      }

      if (!elementEl) {
        // Clic sobre una flecha: se selecciona el conector, no se abre lazo.
        const connector = connectorAtPoint(session, screenToWorld(ui.viewport, startPoint), 6);
        if (connector) {
          ui.setSelectedConnector(connector.id);
          ui.clearSelection();
          return;
        }
        ui.setSelectedConnector(null);
        startMarquee(startPoint, event.shiftKey);
        return;
      }

      const id = elementEl.dataset.elementId;
      if (!id) return;

      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      if (additive) ui.select([id], 'toggle');
      else if (!ui.selection.includes(id)) ui.select([id]);
      if (ui.editingId && ui.editingId !== id) ui.setEditing(null);
      ui.setSelectedConnector(null);

      // Zonas interactivas (rejilla de la tabla, lienzo del dibujo, mapa, filas
      // de tareas): seleccionan la tarjeta pero no la arrastran.
      if (target.closest('[data-interactive]')) return;

      const element = session.getElement(id);
      if (!element || element.locked) return;
      startMove(id, { x: event.clientX, y: event.clientY });
    },
    [session, startConnector, startMarquee, startMove, startPan, startResize],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest('[contenteditable="true"], input, textarea, select')) return;
      if (target.closest('[data-connector-label], [data-interactive]')) return;
      // El nodo de la tarjeta puede haberse recreado entre el `mousedown` y el
      // `dblclick` (un gesto que cambia su DOM), y entonces el `target` del
      // evento ya es el lienzo y su `closest` no la encuentra. Se resuelve por
      // geometría: la tarjeta que está bajo el puntero ahora mismo. Sin esto, el
      // doble clic sobre una tarjeta de tablero caía en el lienzo y, en vez de
      // abrir el tablero, creaba una nota nueva.
      const direct = target.closest('[data-element-id]') as HTMLElement | null;
      const geometric = direct
        ? null
        : ((document
            .elementsFromPoint(event.clientX, event.clientY)
            .find((node) => (node as HTMLElement).closest?.('[data-element-id]')) as HTMLElement | undefined) ?? null);
      const elementEl = direct ?? (geometric?.closest('[data-element-id]') as HTMLElement | null) ?? null;
      const id = elementEl?.getAttribute('data-element-id') ?? null;

      if (!id) {
        // Doble clic en vacío: nota nueva en el punto y a escribir.
        createNoteAt(session, worldFromClient(event.clientX, event.clientY));
        return;
      }

      const element = session.getElement(id);
      if (!element) return;
      if (element.type === 'board') {
        onOpenBoard(element.boardId);
        return;
      }
      if (element.type === 'document') {
        // El documento se abre a página completa (índice + editor amplio).
        useUiStore.getState().openDocument(id);
        return;
      }
      editElement(session, id);
    },
    [onOpenBoard, session],
  );

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const ui = useUiStore.getState();
    const elementEl = (event.target as HTMLElement).closest('[data-element-id]');
    const id = elementEl?.getAttribute('data-element-id') ?? null;
    if (id && !ui.selection.includes(id)) ui.select([id]);
    ui.setContextMenu({ x: event.clientX, y: event.clientY, targetId: id });
  }, []);

  // --- Soltado de herramientas y de archivos desde el sistema ---------------

  const [fileDragOver, setFileDragOver] = useState(false);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const files = hasFiles(event.dataTransfer);
    if (!files && !isToolDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (files) setFileDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFileDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      setFileDragOver(false);
      const world = worldFromClient(event.clientX, event.clientY);
      const column = kanbanTargetAt(event.clientX, event.clientY, new Set());

      // Archivos del sistema: imagen → imagen, vídeo → vídeo, resto → archivo.
      if (hasFiles(event.dataTransfer)) {
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) void attachFilesToBoard(session, files, { world, columnId: column?.columnId ?? null });
        return;
      }

      if (!isToolDrag(event.dataTransfer)) return;
      event.preventDefault();
      const type = event.dataTransfer.getData(TOOL_MIME) as ElementType | '';
      if (!type) return;
      const headingSize = (event.dataTransfer.getData(HEADING_MIME) || null) as HeadingSize | null;
      const parentBoardId = useAppStore.getState().currentBoardId;
      if (column) {
        const created = createToolInColumn(session, column.columnId, type, headingSize);
        if (created) {
          useUiStore.getState().setPendingTool(null);
          return;
        }
      }
      void createToolAt(session, type, world, headingSize, parentBoardId);
      useUiStore.getState().setPendingTool(null);
    },
    [session],
  );

  const pendingTool = useUiStore((state) => state.pendingTool);

  return (
    <div
      ref={rootRef}
      className={[
        'canvas',
        interaction === 'idle' ? '' : `is-${interaction}`,
        pendingTool ? 'is-dropping' : '',
        fileDragOver ? 'is-file-over' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <CanvasGrid />
      <div
        className="canvas__world"
        style={{ transform: `scale(${viewport.scale}) translate3d(${-viewport.x}px, ${-viewport.y}px, 0)` }}
      >
        <ConnectorLayer session={session} />
        <ElementLayer session={session} />
      </div>
      <GuidesOverlay />
      <MarqueeOverlay />
      <DropLineOverlay />
      <ConnectorDraftOverlay />
    </div>
  );
}

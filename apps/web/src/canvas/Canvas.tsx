/**
 * Lienzo infinito.
 *
 * Todas las interacciones de puntero se resuelven aquí por delegación (un solo
 * `pointerdown` en la raíz): selección, arrastre con guías, tiradores de ancho,
 * lazo, paneo y menú contextual. El arrastre escribe en el DOM y solo commitea
 * al soltar, con una única transacción.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type ElementType,
  type HeadingSize,
  type Point,
  type Rect,
  isRichTextType,
  moveElements,
  rectFromPoints,
  screenToWorld,
} from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { createNoteAt, idsInRect, resizeSelectionWidth } from '@/canvas/commands';
import { HEADING_MIME, TOOL_MIME, createToolAt, hasFiles, isToolDrag } from '@/canvas/toolDrop';
import { attachFilesToBoard } from '@/canvas/uploadController';
import { rectOf } from '@/lib/layout';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

import { canvasPoint, setCanvasRoot, worldFromClient } from './canvasRef';
import { ElementLayer } from './ElementLayer';
import { CanvasGrid, GuidesOverlay, MarqueeOverlay } from './Overlays';
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
  onEnd: (commit: boolean) => void,
  options: TrackOptions = {},
): () => void {
  let finished = false;

  const cleanup = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
    document.body.classList.remove('is-dragging');
    if (options.cursorClass) document.body.classList.remove(options.cursorClass);
  };

  function move(event: PointerEvent): void {
    onMove(event);
  }
  function up(): void {
    if (finished) return;
    finished = true;
    cleanup();
    onEnd(true);
  }
  function cancel(): void {
    if (finished) return;
    finished = true;
    cleanup();
    onEnd(false);
  }
  function key(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (finished) return;
    finished = true;
    cleanup();
    onEnd(false);
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

      const excluded = new Set(items.map((item) => item.id));
      const canvasSize = ui.canvasSize;
      const targets = session.getTargetRects(measured, excluded, {
        x: ui.viewport.x,
        y: ui.viewport.y,
        width: canvasSize.width / ui.viewport.scale,
        height: canvasSize.height / ui.viewport.scale,
      });

      ui.setInteraction('move');
      ui.setGuides([]);
      const drag: PointerDrag = startMoveDrag({
        items,
        targets,
        viewport: ui.viewport,
        startPointer: startPoint,
        onCommit: (moves) => {
          moveElements(session.doc, moves, session.origin);
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

  // --- Eventos de ratón ------------------------------------------------------

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest('[contenteditable="true"], input, textarea')) return;
      if (event.button === 1) event.preventDefault();
      if (event.button !== 0 && event.button !== 1) return;

      const ui = useUiStore.getState();
      if (ui.contextMenu) ui.setContextMenu(null);
      const startPoint = canvasPoint(event.clientX, event.clientY);

      if (event.button === 1 || isSpacePan()) {
        startPan(event);
        return;
      }

      const handleEl = target.closest('[data-handle]');
      const elementEl = target.closest('[data-element-id]') as HTMLElement | null;

      if (handleEl && elementEl) {
        const id = elementEl.dataset.elementId;
        const direction = handleEl.getAttribute('data-handle');
        if (id && (direction === 'w' || direction === 'e' || direction === 'se')) {
          startResize(id, direction, startPoint);
          return;
        }
      }

      if (!elementEl) {
        startMarquee(startPoint, event.shiftKey);
        return;
      }

      const id = elementEl.dataset.elementId;
      if (!id) return;

      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      if (additive) ui.select([id], 'toggle');
      else if (!ui.selection.includes(id)) ui.select([id]);
      if (ui.editingId && ui.editingId !== id) ui.setEditing(null);

      const element = session.getElement(id);
      if (!element || element.locked) return;
      startMove(id, startPoint);
    },
    [session, startMarquee, startMove, startPan, startResize],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest('[contenteditable="true"], input, textarea')) return;
      const elementEl = target.closest('[data-element-id]');
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
      if (isRichTextType(element.type)) {
        session.ensureTextFragment(id);
        useUiStore.getState().setEditing(id);
      }
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

      // Archivos del sistema: imagen → imagen, vídeo → vídeo, resto → archivo.
      if (hasFiles(event.dataTransfer)) {
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) void attachFilesToBoard(session, files, { world });
        return;
      }

      if (!isToolDrag(event.dataTransfer)) return;
      event.preventDefault();
      const type = event.dataTransfer.getData(TOOL_MIME) as ElementType | '';
      if (!type) return;
      const headingSize = (event.dataTransfer.getData(HEADING_MIME) || null) as HeadingSize | null;
      void createToolAt(session, type, world, headingSize, useAppStore.getState().currentBoardId);
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
        <ElementLayer session={session} />
      </div>
      <GuidesOverlay />
      <MarqueeOverlay />
    </div>
  );
}

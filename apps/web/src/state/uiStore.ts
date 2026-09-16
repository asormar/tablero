/**
 * Estado de interfaz (Zustand).
 *
 * Aquí vive todo lo efímero: viewport, selección, elemento en edición, estado
 * del arrastre, guías, lazo de selección y alturas medidas en el DOM. Nada de
 * esto se persiste ni viaja por la red.
 */

import { create } from 'zustand';

import {
  type ElementType,
  type Guide,
  type Rect,
  type Size,
  type Viewport,
  DEFAULT_VIEWPORT,
  clampScale,
  panBy,
  zoomAt,
  zoomToStep,
} from '@tablero/shared';

export type SelectionMode = 'replace' | 'add' | 'toggle';
export type InteractionKind = 'idle' | 'move' | 'resize' | 'pan' | 'marquee' | 'place';
export type ContextMenuState = { x: number; y: number; targetId: string | null } | null;

export type UiState = {
  /** Tamaño en pantalla del área del lienzo (para virtualizar y encajar). */
  canvasSize: Size;
  viewport: Viewport;
  selection: string[];
  editingId: string | null;
  interaction: InteractionKind;
  guides: Guide[];
  /** Lazo en coordenadas de mundo mientras se arrastra. */
  marquee: Rect | null;
  /** Alturas medidas por el ResizeObserver de cada tarjeta. */
  measuredHeights: Map<string, number>;
  contextMenu: ContextMenuState;
  helpOpen: boolean;
  panelOpen: boolean;
  /** Tipo de elemento que se está arrastrando desde la barra de herramientas. */
  pendingTool: ElementType | null;
  /** Tarjetas en movimiento (clase de arrastre, sombra elevada). */
  draggingIds: string[];

  setCanvasSize(size: Size): void;
  setViewport(viewport: Viewport): void;
  pan(dxScreen: number, dyScreen: number): void;
  zoomAtPoint(anchorScreen: { x: number; y: number }, scale: number): void;
  zoomStep(direction: 1 | -1, anchorScreen: { x: number; y: number }): void;
  zoomToFit(viewport: Viewport): void;

  select(ids: string[], mode?: SelectionMode): void;
  toggleSelected(id: string): void;
  clearSelection(): void;
  setEditing(id: string | null): void;
  setInteraction(kind: InteractionKind): void;
  setGuides(guides: Guide[]): void;
  setMarquee(rect: Rect | null): void;
  reportHeights(entries: { id: string; height: number }[]): void;
  forgetHeight(id: string): void;
  setContextMenu(menu: ContextMenuState): void;
  setHelpOpen(open: boolean): void;
  togglePanel(): void;
  setPendingTool(type: ElementType | null): void;
  /** Ids que se están arrastrando ahora mismo (se resalta su tarjeta). */
  setDraggingIds(ids: string[]): void;
  /** Reinicia la interfaz al cambiar de tablero. */
  resetWorkspace(): void;
};

function sameGuides(a: Guide[], b: Guide[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (!left || !right) return false;
    if (
      left.axis !== right.axis ||
      left.position !== right.position ||
      left.start !== right.start ||
      left.end !== right.end ||
      left.kind !== right.kind
    ) {
      return false;
    }
  }
  return true;
}

export const useUiStore = create<UiState>()((set, get) => ({
  canvasSize: { width: 1280, height: 720 },
  viewport: DEFAULT_VIEWPORT,
  selection: [],
  editingId: null,
  interaction: 'idle',
  guides: [],
  marquee: null,
  measuredHeights: new Map<string, number>(),
  contextMenu: null,
  helpOpen: false,
  panelOpen: true,
  pendingTool: null,
  draggingIds: [],

  setCanvasSize(size) {
    const current = get().canvasSize;
    if (current.width === size.width && current.height === size.height) return;
    set({ canvasSize: size });
  },
  setViewport(viewport) {
    const current = get().viewport;
    if (current.x === viewport.x && current.y === viewport.y && current.scale === viewport.scale) return;
    set({ viewport });
  },
  pan(dxScreen, dyScreen) {
    set({ viewport: panBy(get().viewport, dxScreen, dyScreen) });
  },
  zoomAtPoint(anchorScreen, scale) {
    set({ viewport: zoomAt(get().viewport, anchorScreen, clampScale(scale)) });
  },
  zoomStep(direction, anchorScreen) {
    set({ viewport: zoomToStep(get().viewport, anchorScreen, direction) });
  },
  zoomToFit(viewport) {
    set({ viewport });
  },

  select(ids, mode = 'replace') {
    const current = get().selection;
    let next: string[];
    if (mode === 'replace') {
      next = [...new Set(ids)];
    } else if (mode === 'add') {
      next = [...new Set([...current, ...ids])];
    } else {
      const result = new Set(current);
      for (const id of ids) {
        if (result.has(id)) result.delete(id);
        else result.add(id);
      }
      next = [...result];
    }
    if (next.length === current.length && next.every((id, index) => current[index] === id)) return;
    set({ selection: next });
  },
  toggleSelected(id) {
    get().select([id], 'toggle');
  },
  clearSelection() {
    if (get().selection.length === 0) return;
    set({ selection: [] });
  },
  setEditing(id) {
    if (get().editingId === id) return;
    set({ editingId: id });
  },
  setInteraction(kind) {
    if (get().interaction === kind) return;
    set({ interaction: kind });
  },
  setGuides(guides) {
    if (sameGuides(get().guides, guides)) return;
    set({ guides });
  },
  setMarquee(rect) {
    set({ marquee: rect });
  },
  reportHeights(entries) {
    if (entries.length === 0) return;
    const current = get().measuredHeights;
    let changed = false;
    const next = new Map(current);
    for (const entry of entries) {
      const previous = next.get(entry.id);
      if (previous !== undefined && Math.abs(previous - entry.height) < 0.5) continue;
      next.set(entry.id, entry.height);
      changed = true;
    }
    if (!changed) return;
    set({ measuredHeights: next });
  },
  forgetHeight(id) {
    const current = get().measuredHeights;
    if (!current.has(id)) return;
    const next = new Map(current);
    next.delete(id);
    set({ measuredHeights: next });
  },
  setContextMenu(menu) {
    set({ contextMenu: menu });
  },
  setHelpOpen(open) {
    set({ helpOpen: open });
  },
  togglePanel() {
    set({ panelOpen: !get().panelOpen });
  },
  setPendingTool(type) {
    set({ pendingTool: type });
  },
  setDraggingIds(ids) {
    const current = get().draggingIds;
    if (current.length === ids.length && current.every((id, index) => ids[index] === id)) return;
    set({ draggingIds: ids });
  },
  resetWorkspace() {
    set({
      viewport: DEFAULT_VIEWPORT,
      selection: [],
      editingId: null,
      interaction: 'idle',
      guides: [],
      marquee: null,
      contextMenu: null,
      measuredHeights: new Map<string, number>(),
      pendingTool: null,
      draggingIds: [],
    });
  },
}));

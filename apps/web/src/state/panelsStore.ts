/**
 * Estado de las superficies de la fase 4 (productividad): paleta de comandos,
 * búsqueda del tablero, plantillas, exportación e importación, historial,
 * ajustes, captura rápida, presentación y vista de lista.
 *
 * Va en un store propio para no tocar `uiStore` (que es el estado del lienzo y
 * de la fase 1–3 y tiene su propio `resetWorkspace`). Todo esto es efímero: no
 * se persiste.
 */

import { create } from 'zustand';

/** Superficies que cierra `closeTop` (la presentación tiene su propia salida). */
export type PanelKey =
  | 'paletteOpen'
  | 'boardSearchOpen'
  | 'settingsOpen'
  | 'templatesOpen'
  | 'saveTemplateOpen'
  | 'historyOpen'
  | 'exportOpen'
  | 'importOpen'
  | 'captureOpen'
  | 'listViewOpen'
  | 'shareOpen'
  | 'publishOpen'
  | 'notificationsOpen'
  | 'activityOpen';

/**
 * Orden de respaldo de `closeTop` para lo que esté abierto sin haber pasado por
 * un setter (no debería ocurrir): cierra primero lo que suele ir por encima.
 */
const FALLBACK_CLOSE_ORDER: readonly PanelKey[] = [
  'paletteOpen',
  'boardSearchOpen',
  'captureOpen',
  'shareOpen',
  'publishOpen',
  'notificationsOpen',
  'activityOpen',
  'settingsOpen',
  'templatesOpen',
  'saveTemplateOpen',
  'historyOpen',
  'exportOpen',
  'importOpen',
  'listViewOpen',
];

export type PanelsState = {
  /**
   * Superficies abiertas en el orden en que se abrieron (la última es la de
   * arriba). `closeTop` cierra de atrás hacia delante, así que con dos diálogos
   * apilados `Esc` cierra siempre el de encima.
   */
  openOrder: PanelKey[];
  /** Paleta de comandos (Ctrl/Cmd+K). */
  paletteOpen: boolean;
  /** Búsqueda dentro del tablero (Ctrl/Cmd+F). */
  boardSearchOpen: boolean;
  settingsOpen: boolean;
  templatesOpen: boolean;
  /** Diálogo «Guardar como plantilla». */
  saveTemplateOpen: boolean;
  historyOpen: boolean;
  exportOpen: boolean;
  importOpen: boolean;
  captureOpen: boolean;
  presentationOpen: boolean;
  listViewOpen: boolean;
  /** Fase 5: diálogo de compartir (miembros e invitaciones). */
  shareOpen: boolean;
  /** Fase 5: panel de publicar (slug, contraseña, subtableros). */
  publishOpen: boolean;
  /** Fase 5: panel de notificaciones (campana). */
  notificationsOpen: boolean;
  /** Fase 5: registro de actividad del tablero. */
  activityOpen: boolean;
  /** Tarjeta que se acaba de abrir desde una búsqueda y hay que destacar. */
  flashElementId: string | null;
  /** Instante del último destello (para reiniciar la animación si se repite). */
  flashToken: number;

  setPaletteOpen(open: boolean): void;
  setBoardSearchOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setTemplatesOpen(open: boolean): void;
  setSaveTemplateOpen(open: boolean): void;
  setHistoryOpen(open: boolean): void;
  setExportOpen(open: boolean): void;
  setImportOpen(open: boolean): void;
  setCaptureOpen(open: boolean): void;
  setPresentationOpen(open: boolean): void;
  setListViewOpen(open: boolean): void;
  setShareOpen(open: boolean): void;
  setPublishOpen(open: boolean): void;
  setNotificationsOpen(open: boolean): void;
  setActivityOpen(open: boolean): void;
  flashElement(id: string): void;
  clearFlash(): void;
  /** Cierra la superficie abierta más reciente; devuelve `true` si cerró algo. */
  closeTop(): boolean;
  /** Cierra todo (al cambiar de tablero). */
  closeAll(): void;
};

/** Cambio de una superficie y su posición en la pila de apertura. */
function panelPatch(state: PanelsState, key: PanelKey, open: boolean): Partial<PanelsState> {
  const rest = state.openOrder.filter((entry) => entry !== key);
  return { [key]: open, openOrder: open ? [...rest, key] : rest } as Partial<PanelsState>;
}

export const usePanelsStore = create<PanelsState>()((set, get) => ({
  openOrder: [],
  paletteOpen: false,
  boardSearchOpen: false,
  settingsOpen: false,
  templatesOpen: false,
  saveTemplateOpen: false,
  historyOpen: false,
  exportOpen: false,
  importOpen: false,
  captureOpen: false,
  presentationOpen: false,
  listViewOpen: false,
  shareOpen: false,
  publishOpen: false,
  notificationsOpen: false,
  activityOpen: false,
  flashElementId: null,
  flashToken: 0,

  setPaletteOpen(open) {
    if (get().paletteOpen === open) return;
    set(panelPatch(get(), 'paletteOpen', open));
  },
  setBoardSearchOpen(open) {
    if (get().boardSearchOpen === open) return;
    set(panelPatch(get(), 'boardSearchOpen', open));
  },
  setSettingsOpen(open) {
    set(panelPatch(get(), 'settingsOpen', open));
  },
  setTemplatesOpen(open) {
    set(panelPatch(get(), 'templatesOpen', open));
  },
  setSaveTemplateOpen(open) {
    set(panelPatch(get(), 'saveTemplateOpen', open));
  },
  setHistoryOpen(open) {
    set(panelPatch(get(), 'historyOpen', open));
  },
  setExportOpen(open) {
    set(panelPatch(get(), 'exportOpen', open));
  },
  setImportOpen(open) {
    set(panelPatch(get(), 'importOpen', open));
  },
  setCaptureOpen(open) {
    set(panelPatch(get(), 'captureOpen', open));
  },
  setPresentationOpen(open) {
    set({ presentationOpen: open });
  },
  setListViewOpen(open) {
    set(panelPatch(get(), 'listViewOpen', open));
  },
  setShareOpen(open) {
    set(panelPatch(get(), 'shareOpen', open));
  },
  setPublishOpen(open) {
    set(panelPatch(get(), 'publishOpen', open));
  },
  setNotificationsOpen(open) {
    set(panelPatch(get(), 'notificationsOpen', open));
  },
  setActivityOpen(open) {
    set(panelPatch(get(), 'activityOpen', open));
  },
  flashElement(id) {
    set({ flashElementId: id, flashToken: get().flashToken + 1 });
  },
  clearFlash() {
    if (get().flashElementId === null) return;
    set({ flashElementId: null });
  },
  closeTop() {
    const state = get();
    // La pila manda; lo abierto que no esté en ella cae al orden de respaldo.
    const stacked = [...state.openOrder].reverse();
    const candidates = [...stacked, ...FALLBACK_CLOSE_ORDER];
    for (const key of candidates) {
      if (!state[key]) continue;
      set(panelPatch(state, key, false));
      return true;
    }
    return false;
  },
  closeAll() {
    set({
      openOrder: [],
      paletteOpen: false,
      boardSearchOpen: false,
      settingsOpen: false,
      templatesOpen: false,
      saveTemplateOpen: false,
      historyOpen: false,
      exportOpen: false,
      importOpen: false,
      captureOpen: false,
      listViewOpen: false,
      shareOpen: false,
      publishOpen: false,
      notificationsOpen: false,
      activityOpen: false,
    });
  },
}));

/** ¿Hay alguna superficie de la fase 4 o 5 abierta? */
export function anyPanelOpen(state: PanelsState): boolean {
  return (
    state.paletteOpen ||
    state.boardSearchOpen ||
    state.settingsOpen ||
    state.templatesOpen ||
    state.saveTemplateOpen ||
    state.historyOpen ||
    state.exportOpen ||
    state.importOpen ||
    state.captureOpen ||
    state.listViewOpen ||
    state.shareOpen ||
    state.publishOpen ||
    state.notificationsOpen ||
    state.activityOpen
  );
}

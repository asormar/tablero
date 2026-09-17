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

export type PanelsState = {
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
  flashElement(id: string): void;
  clearFlash(): void;
  /** Cierra cualquier superficie abierta; devuelve `true` si cerró algo. */
  closeTop(): boolean;
  /** Cierra todo (al cambiar de tablero). */
  closeAll(): void;
};

export const usePanelsStore = create<PanelsState>()((set, get) => ({
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
  flashElementId: null,
  flashToken: 0,

  setPaletteOpen(open) {
    if (get().paletteOpen === open) return;
    set({ paletteOpen: open });
  },
  setBoardSearchOpen(open) {
    if (get().boardSearchOpen === open) return;
    set({ boardSearchOpen: open });
  },
  setSettingsOpen(open) {
    set({ settingsOpen: open });
  },
  setTemplatesOpen(open) {
    set({ templatesOpen: open });
  },
  setSaveTemplateOpen(open) {
    set({ saveTemplateOpen: open });
  },
  setHistoryOpen(open) {
    set({ historyOpen: open });
  },
  setExportOpen(open) {
    set({ exportOpen: open });
  },
  setImportOpen(open) {
    set({ importOpen: open });
  },
  setCaptureOpen(open) {
    set({ captureOpen: open });
  },
  setPresentationOpen(open) {
    set({ presentationOpen: open });
  },
  setListViewOpen(open) {
    set({ listViewOpen: open });
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
    const order: [keyof PanelsState, boolean][] = [
      ['paletteOpen', state.paletteOpen],
      ['boardSearchOpen', state.boardSearchOpen],
      ['captureOpen', state.captureOpen],
      ['settingsOpen', state.settingsOpen],
      ['templatesOpen', state.templatesOpen],
      ['saveTemplateOpen', state.saveTemplateOpen],
      ['historyOpen', state.historyOpen],
      ['exportOpen', state.exportOpen],
      ['importOpen', state.importOpen],
      ['listViewOpen', state.listViewOpen],
    ];
    for (const [key, open] of order) {
      if (!open) continue;
      set({ [key]: false } as Partial<PanelsState>);
      return true;
    }
    return false;
  },
  closeAll() {
    set({
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
    });
  },
}));

/** ¿Hay alguna superficie de la fase 4 abierta? */
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
    state.listViewOpen
  );
}

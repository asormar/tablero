/**
 * Pruebas del store de superficies: `closeTop` cierra siempre la más reciente.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { anyPanelOpen, usePanelsStore } from './panelsStore';

const panels = () => usePanelsStore.getState();

describe('panelsStore.closeTop', () => {
  beforeEach(() => panels().closeAll());

  it('sin nada abierto no cierra nada', () => {
    expect(panels().closeTop()).toBe(false);
  });

  it('cierra primero el diálogo abierto encima (galería y luego guardar plantilla)', () => {
    panels().setTemplatesOpen(true);
    panels().setSaveTemplateOpen(true);
    expect(panels().closeTop()).toBe(true);
    expect(panels().saveTemplateOpen).toBe(false);
    expect(panels().templatesOpen).toBe(true);
    expect(panels().closeTop()).toBe(true);
    expect(panels().templatesOpen).toBe(false);
  });

  it('respeta el orden de apertura aunque el de prioridad antigua fuera otro', () => {
    // En el orden fijo de antes la paleta ganaba a ajustes; ahora manda lo último abierto.
    panels().setPaletteOpen(true);
    panels().setSettingsOpen(true);
    panels().closeTop();
    expect(panels().settingsOpen).toBe(false);
    expect(panels().paletteOpen).toBe(true);
  });

  it('reabrir un diálogo lo sube a la cima', () => {
    panels().setExportOpen(true);
    panels().setImportOpen(true);
    panels().setExportOpen(true);
    panels().closeTop();
    expect(panels().exportOpen).toBe(false);
    expect(panels().importOpen).toBe(true);
  });

  it('cerrar uno por su setter lo saca de la pila', () => {
    panels().setHistoryOpen(true);
    panels().setShareOpen(true);
    panels().setShareOpen(false);
    expect(panels().openOrder).toEqual(['historyOpen']);
    panels().closeTop();
    expect(panels().historyOpen).toBe(false);
    expect(anyPanelOpen(panels())).toBe(false);
  });

  it('closeAll vacía la pila', () => {
    panels().setCaptureOpen(true);
    panels().setActivityOpen(true);
    panels().closeAll();
    expect(panels().openOrder).toEqual([]);
    expect(panels().closeTop()).toBe(false);
  });

  it('lo abierto sin pasar por un setter cae al orden de respaldo', () => {
    usePanelsStore.setState({ settingsOpen: true, paletteOpen: true });
    panels().closeTop();
    expect(panels().paletteOpen).toBe(false);
    expect(panels().settingsOpen).toBe(true);
  });
});

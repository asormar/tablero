/**
 * Atajos de la fase 4 (punto 1, 2, 5 y 6):
 *
 *   Ctrl/Cmd + K        → paleta de comandos y búsqueda global
 *   Ctrl/Cmd + F        → búsqueda dentro del tablero
 *   Ctrl/Cmd + Shift + N → captura rápida (nota en «Sin ordenar»)
 *   Esc                 → cierra la superficie de la fase 4 que esté abierta
 *
 * Esc se atiende en fase de captura para tener prioridad sobre el resto de los
 * atajos (el lienzo también usa Esc para deseleccionar).
 */

import { useEffect } from 'react';

import { usePanelsStore } from '@/state/panelsStore';
import { useUiStore } from '@/state/uiStore';

export function usePhase4Shortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const panels = usePanelsStore.getState();
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (event.key === 'Escape') {
        if (panels.closeTop()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        return;
      }

      if (!mod) return;

      if (key === 'k' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        panels.setPaletteOpen(!panels.paletteOpen);
        return;
      }
      if (key === 'f' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        // La búsqueda del navegador no se usa: se busca dentro del tablero.
        usePanelsStore.getState().setBoardSearchOpen(true);
        useUiStore.getState().setHelpOpen(false);
        return;
      }
      if (key === 'n' && event.shiftKey && !event.altKey) {
        event.preventDefault();
        usePanelsStore.getState().setCaptureOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}

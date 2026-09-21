/**
 * Atajos de teclado de la fase 1 (sección 10 del plan).
 *
 * Todo pasa por la ventana, con dos guardas: no se dispara nada mientras se
 * escribe (inputs, áreas de texto y editores de TipTap) y los atajos de contenido
 * se ignoran con un modal abierto. Esc es la excepción: siempre cierra.
 */

import { useEffect } from 'react';

import { setSpacePan } from '@/canvas/panMode';
import { createColumnAt } from '@/canvas/columnCommands';
import {
  clearSelectionAndEditing,
  copySelection,
  createNoteAt,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  fitToScreen,
  nudgeSelection,
  redoWithPrune,
  seedPerfNotes,
  selectAll,
  spawnPoint,
  undoWithPrune,
  zoomTo100,
  zoomToStepFromKey,
} from '@/canvas/commands';
import { createBoardCardAt } from '@/canvas/commands';
import type { BoardSession } from '@/collab/BoardSession';
import { nudgeDelta } from '@/lib/dragMath';
import { isDevBuild } from '@/lib/renderStats';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';
import { createNestedBoard } from '@/app/boardService';

function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as (HTMLElement & { closest?: (selector: string) => Element | null }) | null;
  if (!node || typeof node.closest !== 'function') return false;
  return node.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

export function useShortcuts(session: BoardSession): void {
  useEffect(() => {
    const isSpace = (event: KeyboardEvent): boolean => event.code === 'Space' || event.key === ' ';

    const onKeyDown = (event: KeyboardEvent): void => {
      const ui = useUiStore.getState();
      const typing = isTypingTarget(event.target);
      const mod = event.ctrlKey || event.metaKey;

      if (isSpace(event) && !typing) {
        if (!event.repeat) setSpacePan(true);
        event.preventDefault();
        return;
      }

      if (event.key === 'Escape') {
        if (ui.helpOpen) {
          ui.setHelpOpen(false);
          return;
        }
        if (ui.moveToOpen) {
          ui.setMoveToOpen(false);
          return;
        }
        if (ui.documentId) {
          ui.closeDocument();
          return;
        }
        if (ui.contextMenu) {
          ui.setContextMenu(null);
          return;
        }
        if (ui.selectedConnectorId) {
          ui.setSelectedConnector(null);
          return;
        }
        if (ui.editingId) {
          const editing = ui.editingId;
          const active = document.activeElement;
          if (active instanceof HTMLElement) active.blur();
          // Se sale de la edición pero **no** se pierde la selección: con el
          // teclado, el flujo es crear → escribir → `Esc` → mover con flechas
          // (fase 6). La tarjeta sigue seleccionada y el foco vuelve a ella.
          ui.setEditing(null);
          document.querySelector<HTMLElement>(`[data-element-id="${editing}"]`)?.focus();
          return;
        }
        if (ui.selection.length > 0) ui.clearSelection();
        return;
      }

      if (ui.helpOpen || typing) return;

      // --- Deshacer / rehacer -------------------------------------------------
      if (mod && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        if (event.shiftKey) redoWithPrune(session);
        else undoWithPrune(session);
        return;
      }
      if (mod && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault();
        redoWithPrune(session);
        return;
      }

      // --- Portapapeles -------------------------------------------------------
      if (mod && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault();
        selectAll(session);
        return;
      }
      if (mod && (event.key === 'c' || event.key === 'C')) {
        event.preventDefault();
        copySelection(session);
        return;
      }
      if (mod && (event.key === 'x' || event.key === 'X')) {
        event.preventDefault();
        cutSelection(session);
        return;
      }
      if (mod && (event.key === 'v' || event.key === 'V')) {
        // El pegado lo resuelve el evento `paste` del navegador (usePaste): así
        // llegan también los archivos del portapapeles y no se pierde el pegado
        // dentro de un editor.
        return;
      }
      if (mod && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        duplicateSelection(session);
        return;
      }
      if (mod && (event.key === 's' || event.key === 'S')) {
        // El guardado es continuo: solo se evita el diálogo del navegador.
        event.preventDefault();
        return;
      }
      if (mod && event.altKey && event.shiftKey && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault();
        if (isDevBuild) seedPerfNotes(session, 300);
        return;
      }
      if (mod && event.key === '0') {
        event.preventDefault();
        zoomTo100();
        return;
      }
      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        zoomToStepFromKey(1);
        return;
      }
      if (mod && (event.key === '-' || event.key === '_')) {
        event.preventDefault();
        zoomToStepFromKey(-1);
        return;
      }
      if (mod) return;

      // --- Borrado y movimiento ----------------------------------------------
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        // Una sola transacción para todo lo seleccionado: tarjetas (a la
        // papelera) y conectores (fuera del documento). Un `Deshacer` lo
        // devuelve entero, también cuando el lazo mezcló tarjetas y flechas.
        deleteSelection(session);
        return;
      }
      if (event.key.startsWith('Arrow')) {
        const step = nudgeDelta(event.shiftKey);
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        if (dx === 0 && dy === 0) return;
        event.preventDefault();
        nudgeSelection(session, dx, dy);
        return;
      }

      // --- Vista --------------------------------------------------------------
      if (event.key === '!' || (event.shiftKey && event.key === '1')) {
        event.preventDefault();
        fitToScreen(session);
        return;
      }
      if (event.key === '+' || event.key === '=' || event.key === '-') {
        event.preventDefault();
        zoomToStepFromKey(event.key === '-' ? -1 : 1);
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        useUiStore.getState().setHelpOpen(true);
        return;
      }

      // --- Creación -----------------------------------------------------------
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        createNoteAt(session, spawnPoint());
        return;
      }
      if (event.key === 'c' || event.key === 'C') {
        // Columna: varias en fila forman un kanban.
        event.preventDefault();
        createColumnAt(session, spawnPoint());
        return;
      }
      if (event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        const boardId = useAppStore.getState().currentBoardId;
        void createNestedBoard(boardId, 'Tablero sin título', null).then((board) => {
          createBoardCardAt(session, spawnPoint(), board);
        });
      }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (isSpace(event)) setSpacePan(false);
    };
    const onBlur = (): void => setSpacePan(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      setSpacePan(false);
    };
  }, [session]);
}

/**
 * Navegación desde una notificación (punto 6 de la fase 5).
 *
 * Un clic en una notificación tiene que llevar al tablero y al elemento **sin
 * recargar la página**. El salto al elemento se pide con `requestFocus`, que el
 * espacio de trabajo consume cuando el tablero ya tiene contenido (el mismo
 * camino que usa la búsqueda y la vista de tareas).
 */

import { ensureBoardInRegistry, writeBoardIdToUrl } from '@/app/boardService';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

export function openBoardFromNotification(boardId: string, elementId: string | null): void {
  const store = useAppStore.getState();
  if (store.currentBoardId !== boardId) {
    store.setCurrentBoard(boardId);
    writeBoardIdToUrl(boardId);
    void ensureBoardInRegistry(boardId);
  }
  if (elementId) useUiStore.getState().requestFocus(boardId, elementId);
}

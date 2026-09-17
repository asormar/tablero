/**
 * Puente entre el estado efímero de la interfaz y la presencia del documento.
 *
 * La sesión no conoce el `uiStore` (es estado de React/Zustand y la sesión es
 * agnóstica): este componente le pasa los lectores de selección y edición y
 * publica el puntero con el viewport actual. Además, al desmontar, avisa que
 * este cliente se va (`clearPresence`), para que los demás no esperen el
 * vencimiento de 2 minutos.
 */

import { useEffect } from 'react';

import type { BoardSession } from '@/collab/BoardSession';
import { canvasRoot, worldFromClient } from '@/canvas/canvasRef';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

export function PresenceBridge({ session }: { session: BoardSession }): null {
  // Lectores de selección/edición: la sesión los usa al publicar su estado.
  useEffect(() => {
    session.bindUiState({
      selection: () => useUiStore.getState().selection,
      editingId: () => useUiStore.getState().editingId,
    });
  }, [session]);

  // Cambios de selección o de edición → se republica la presencia.
  useEffect(() => {
    const unsubscribeSelection = useUiStore.subscribe((state, previous) => {
      if (state.selection !== previous.selection || state.editingId !== previous.editingId) {
        session.refreshPresenceState();
      }
    });
    return unsubscribeSelection;
  }, [session]);

  // El nombre del usuario puede llegar después del arranque (sesión de la API).
  const userId = useAppStore((state) => state.user.id);
  const userName = useAppStore((state) => state.user.name);

  useEffect(() => {
    if (!userName) return;
    session.setPresenceUser({ id: userId, name: userName });
  }, [session, userId, userName]);

  useEffect(() => {
    const node = canvasRoot();
    if (!node) return undefined;
    let frame: ReturnType<typeof setTimeout> | null = null;
    let latest: { x: number; y: number } | null = null;

    const flush = (): void => {
      frame = null;
      if (!latest) return;
      session.setPresenceCursor(worldFromClient(latest.x, latest.y));
    };

    const onMove = (event: PointerEvent): void => {
      latest = { x: event.clientX, y: event.clientY };
      // Temporizador y no `requestAnimationFrame`: en una pestaña en segundo
      // plano el rAF no corre y el cursor ajeno se quedaría congelado.
      if (frame !== null) return;
      frame = setTimeout(flush, 33);
    };
    const onLeave = (): void => {
      latest = null;
      session.setPresenceCursor(null);
    };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', onLeave);
    return () => {
      if (frame !== null) clearTimeout(frame);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
      session.setPresenceCursor(null);
    };
  }, [session, userName]);

  useEffect(() => {
    return () => session.clearPresence();
  }, [session]);

  return null;
}

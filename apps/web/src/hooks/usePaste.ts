/**
 * Pegado (Ctrl/Cmd+V).
 *
 * Se escucha el evento `paste` del navegador en lugar de interceptar la tecla:
 * así llegan los archivos que acompañan al texto (una imagen copiada en otra
 * pestaña o en el explorador) y el texto plano, y el pegado dentro de un editor
 * o de un campo sigue siendo del editor.
 *
 * Qué se crea lo decide `planPasteTarget`: archivos → tarjetas de archivo,
 * enlace → tarjeta de enlace (con el incrustado listo al instante), color →
 * muestra de color, texto → nota, y el portapapeles interno de Tablero → los
 * elementos copiados.
 */

import { useEffect } from 'react';

import { createFromPaste, pasteInternalAt, spawnPoint } from '@/canvas/commands';
import { attachFilesToBoard } from '@/canvas/uploadController';
import type { BoardSession } from '@/collab/BoardSession';
import { getInternalClipboard } from '@/lib/clipboard';
import { planPasteTarget } from '@/lib/pasteTargets';
import { useUiStore } from '@/state/uiStore';

function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as (HTMLElement & { closest?: (selector: string) => Element | null }) | null;
  if (!node || typeof node.closest !== 'function') return false;
  return node.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

export function usePaste(session: BoardSession): void {
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      if (useUiStore.getState().helpOpen) return;

      const data = event.clipboardData;
      const files = Array.from(data?.files ?? []).filter((file) => file.size > 0);
      const text = data?.getData('text/plain') ?? null;
      const internal = getInternalClipboard();
      const internalMatches =
        internal !== null && text !== null && text.trim().length > 0 && text.trim() === internal.plainText.trim();

      const plan = planPasteTarget({ text, fileCount: files.length, internalMatches });
      if (plan.kind === 'empty') return;
      event.preventDefault();

      const world = spawnPoint();
      if (plan.kind === 'files') {
        void attachFilesToBoard(session, files, { world });
        return;
      }
      if (plan.kind === 'elements') {
        pasteInternalAt(session, world);
        return;
      }
      // Enlace, muestra de color o nota: `createFromPaste` vuelve a decidir con
      // el mismo texto (la decisión es pura y determinista).
      createFromPaste(session, world, text);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [session]);
}

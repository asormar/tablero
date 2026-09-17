/**
 * Share Target (punto 7 de la fase 4): si la app se abrió desde «Compartir» del
 * sistema operativo, se guarda la nota en «Sin ordenar» sin pasar por la
 * interfaz y se limpia la URL para que al recargar no se duplique.
 *
 * Se intenta `POST /api/capture` y, si el endpoint todavía no está, se escribe
 * en el documento del tablero «Sin ordenar» desde el cliente.
 */

import { useEffect } from 'react';

import { ApiError } from '@/api/client';
import { captureNote } from '@/capture/api';
import { appendNoteToUnsorted } from '@/capture/unsortedNote';
import { useT } from '@/i18n';
import { parseShareParams, composeShareNote } from '@/pwa/share';
import { useAppStore } from '@/state/appStore';

export function useShareTarget(): void {
  const t = useT();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload = parseShareParams(window.location.search);
    if (!payload) return;
    const note = composeShareNote(payload);
    if (note.length === 0) return;

    // Limpieza inmediata: la nota no puede duplicarse con una recarga.
    try {
      const url = new URL(window.location.href);
      for (const key of ['share', 'title', 'text', 'url']) url.searchParams.delete(key);
      window.history.replaceState({}, '', url.toString());
    } catch {
      // sin history: se sigue igual
    }

    const user = useAppStore.getState().user;
    void (async () => {
      try {
        if (useAppStore.getState().apiOnline) {
          try {
            await captureNote(note);
          } catch (error) {
            if (error instanceof ApiError && (error.isNotFound || error.status === 405)) {
              await appendNoteToUnsorted(note, user.id);
            } else {
              throw error;
            }
          }
        } else {
          await appendNoteToUnsorted(note, user.id);
        }
        useAppStore.getState().setNotice(t('capture.saved'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        useAppStore.getState().setNotice(t('capture.failed', { message }));
      }
    })();
  }, [t]);
}

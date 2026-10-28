/**
 * Captura rápida (Ctrl/Cmd+Shift+N) — punto 6 de la fase 4.
 *
 * Una nota que cae en «Sin ordenar» sin salir del tablero actual. Primero se
 * intenta `POST /api/capture` (el mismo endpoint que usan los atajos del sistema
 * con token personal); si todavía no existe, se escribe en el documento del
 * tablero «Sin ordenar» desde el cliente.
 */

import { useEffect, useRef, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { ApiError } from '@/api/client';
import { Modal } from '@/chrome/Modal';
import { useT } from '@/i18n';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';

import { captureNote } from './api';
import { appendNoteToUnsorted } from './unsortedNote';

export function QuickCapture(): JSX.Element | null {
  const open = usePanelsStore((state) => state.captureOpen);
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setText('');
    setError(null);
    const timer = setTimeout(() => textareaRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const close = (): void => usePanelsStore.getState().setCaptureOpen(false);

  const save = async (): Promise<void> => {
    const value = text.trim();
    if (value.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const user = useAppStore.getState().user;
    try {
      if (useAppStore.getState().apiOnline) {
        try {
          await captureNote(value);
        } catch (apiError) {
          if (apiError instanceof ApiError && (apiError.isNotFound || apiError.status === 405)) {
            // Endpoint todavía inexistente: se escribe desde el cliente.
            await appendNoteToUnsorted(value, user.id);
          } else {
            throw apiError;
          }
        }
      } else {
        await appendNoteToUnsorted(value, user.id);
      }
      useAppStore.getState().setNotice(t('capture.saved'));
      close();
    } catch (failure) {
      const message = failure instanceof ApiError ? failure.message : failure instanceof Error ? failure.message : 'error';
      setError(t('capture.failed', { message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('capture.title')} onClose={close} panelClassName="capture">
      <div className="modal__body">
        <p className="sr-only" role="status" data-capture-status>
          {busy ? t('capture.saving') : ''}
        </p>
        <p className="capture__hint">{t('capture.hint')}</p>
        <textarea
          ref={textareaRef}
          className="capture__input"
          value={text}
          rows={4}
          placeholder={t('capture.placeholder')}
          aria-label={t('capture.title')}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void save();
            }
          }}
        />
        {error ? <p className="capture__error">{error}</p> : null}
      </div>
      <footer className="modal__foot">
        <button type="button" className="button" onClick={close} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="button button--primary"
          data-capture-save
          disabled={busy || text.trim().length === 0}
          onClick={() => void save()}
        >
          {busy ? <Loader2 size={14} className="spin" /> : null}
          {t('capture.save')}
        </button>
      </footer>
    </Modal>
  );
}

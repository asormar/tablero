/**
 * «Guardar como plantilla» (punto 2 de la fase 4): guarda el tablero actual y
 * sus subtableros como plantilla reutilizable.
 */

import { useEffect, useState } from 'react';

import { Loader2, X } from 'lucide-react';

import { ApiError } from '@/api/client';
import { useT } from '@/i18n';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';

import { saveBoardAsTemplate } from './api';

export function SaveTemplateDialog(): JSX.Element | null {
  const open = usePanelsStore((state) => state.saveTemplateOpen);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentBoardId = useAppStore((state) => state.currentBoardId);
  const board = useAppStore((state) => state.boards.find((item) => item.id === state.currentBoardId) ?? null);

  useEffect(() => {
    if (!open) return;
    setName(board?.title ?? '');
    setDescription('');
    setCategory('');
    setError(null);
  }, [open, board?.title]);

  if (!open) return null;

  const close = (): void => usePanelsStore.getState().setSaveTemplateOpen(false);

  const submit = (): void => {
    if (!currentBoardId || name.trim().length === 0 || busy) return;
    setBusy(true);
    setError(null);
    void saveBoardAsTemplate(currentBoardId, {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(category.trim() ? { category: category.trim() } : {}),
    })
      .then(() => {
        useAppStore.getState().setNotice(t('templates.saved'));
        close();
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiError ? failure.message : t('templates.unavailable'));
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('templates.saveTitle')}>
      <div className="modal__panel save-template" ref={trapRef}>
        <div className="modal__head">
          <h2 className="modal__title">{t('templates.saveTitle')}</h2>
          <button type="button" className="icon-button" title={t('common.close')} onClick={close}>
            <X size={15} />
          </button>
        </div>
        <div className="modal__body save-template__body">
          <p className="save-template__hint">{t('templates.saveHint')}</p>
          <label className="field">
            <span className="field__label">{t('common.name')}</span>
            <input
              className="field__input"
              value={name}
              placeholder={t('templates.namePlaceholder')}
              data-save-template-name
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape') close();
              }}
            />
          </label>
          <label className="field">
            <span className="field__label">{t('common.description')}</span>
            <input
              className="field__input"
              value={description}
              placeholder={t('templates.descriptionPlaceholder')}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">{t('common.category')}</span>
            <input
              className="field__input"
              value={category}
              placeholder={t('templates.categoryPlaceholder')}
              onChange={(event) => setCategory(event.target.value)}
            />
          </label>
          {error ? <p className="save-template__error">{error}</p> : null}
        </div>
        <footer className="modal__foot">
          <button type="button" className="button" onClick={close} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button--primary"
            data-save-template-submit
            disabled={busy || name.trim().length === 0}
            onClick={submit}
          >
            {busy ? <Loader2 size={14} className="spin" /> : null}
            {t('common.save')}
          </button>
        </footer>
      </div>
    </div>
  );
}

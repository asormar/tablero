/**
 * Galería de plantillas (punto 2 de la fase 4): se abre al crear un tablero
 * desde plantilla y desde «Guardar como plantilla».
 *
 * Las categorías salen de las propias plantillas (escritura, diseño,
 * planificación, moodboard, investigación, vídeo, personal…) y siempre hay una
 * opción de tablero en blanco. Al instanciar, el API copia el documento Yjs de
 * la plantilla al tablero nuevo y acá se navega a él.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { LayoutTemplate, Loader2, Plus, Save, X } from 'lucide-react';

import { ApiError } from '@/api/client';
import { useT } from '@/i18n';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';

import {
  type TemplateSummary,
  fetchTemplates,
  instantiateTemplate,
  templateCategories,
} from './api';

const ALL = '__all__';

export function TemplateGallery({
  onOpenBoard,
  onCreateBlank,
}: {
  onOpenBoard(boardId: string): void;
  onCreateBlank?(): void;
}): JSX.Element | null {
  const open = usePanelsStore((state) => state.templatesOpen);
  const t = useT();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>(ALL);
  const [busyId, setBusyId] = useState<string | null>(null);
  const currentBoardId = useAppStore((state) => state.currentBoardId);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await fetchTemplates());
    } catch (failure) {
      setTemplates([]);
      setError(failure instanceof ApiError && failure.isNotFound ? t('templates.unavailable') : t('templates.unavailable'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') usePanelsStore.getState().setTemplatesOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const categories = useMemo(() => templateCategories(templates), [templates]);
  const visible = useMemo(
    () => (category === ALL ? templates : templates.filter((template) => template.category === category)),
    [templates, category],
  );

  if (!open) return null;

  const close = (): void => usePanelsStore.getState().setTemplatesOpen(false);

  const instantiate = (template: TemplateSummary): void => {
    if (busyId) return;
    setBusyId(template.id);
    void instantiateTemplate(template.id, { parentBoardId: currentBoardId })
      .then((board) => {
        useAppStore.getState().upsertBoard(board);
        close();
        onOpenBoard(board.id);
      })
      .catch((failure: unknown) => {
        const message = failure instanceof ApiError ? failure.message : t('templates.unavailable');
        useAppStore.getState().setNotice(message);
      })
      .finally(() => setBusyId(null));
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('templates.title')}>
      <div className="modal__panel templates">
        <header className="modal__head">
          <h2 className="modal__title">
            <LayoutTemplate size={15} /> {t('templates.title')}
          </h2>
          {loading ? <Loader2 size={14} className="spin" /> : null}
          <button type="button" className="icon-button" title={t('common.close')} onClick={close}>
            <X size={15} />
          </button>
        </header>

        <div className="templates__body">
          <aside className="templates__sidebar" aria-label={t('templates.categories')}>
            <button
              type="button"
              className={`templates__cat${category === ALL ? ' is-active' : ''}`}
              onClick={() => setCategory(ALL)}
            >
              {t('templates.all')}
            </button>
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                className={`templates__cat${category === item ? ' is-active' : ''}`}
                data-template-category={item}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </aside>

          <div className="templates__grid-wrap">
            {error ? <p className="templates__error">{error}</p> : null}
            {!error && visible.length === 0 && !loading ? (
              <p className="templates__empty">{t('templates.empty')}</p>
            ) : null}
            <div className="templates__grid">
              <button
                type="button"
                className="template-card template-card--blank"
                data-template-blank
                onClick={() => {
                  close();
                  onCreateBlank?.();
                }}
              >
                <span className="template-card__icon" aria-hidden="true">
                  <Plus size={18} />
                </span>
                <span className="template-card__name">{t('templates.blank')}</span>
                <span className="template-card__desc">{t('templates.blankHint')}</span>
              </button>

              {visible.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="template-card"
                  data-template-id={template.id}
                  disabled={busyId !== null}
                  onClick={() => instantiate(template)}
                >
                  <span className="template-card__icon" aria-hidden="true">
                    {busyId === template.id ? <Loader2 size={16} className="spin" /> : <LayoutTemplate size={16} />}
                  </span>
                  <span className="template-card__name">{template.name}</span>
                  {template.description ? (
                    <span className="template-card__desc">{template.description}</span>
                  ) : null}
                  <span className="template-card__foot">
                    <span className="template-card__cat">{template.category}</span>
                    <span className="template-card__use">{t('templates.use')}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer className="modal__foot">
          <button
            type="button"
            className="button"
            data-templates-save
            onClick={() => {
              close();
              usePanelsStore.getState().setSaveTemplateOpen(true);
            }}
          >
            <Save size={14} /> {t('templates.fromBoard')}
          </button>
        </footer>
      </div>
    </div>
  );
}

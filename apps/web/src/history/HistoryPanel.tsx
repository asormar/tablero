/**
 * Panel de historial de versiones (punto 4 de la fase 4).
 *
 * Lista las instantáneas del tablero abierto (más nueva primero) con
 * previsualización —título, cantidad de elementos, fecha— y restaura con
 * confirmación. Al restaurar, el API sustituye el estado persistido y cierra las
 * conexiones del tablero; acá se recarga la página para que el documento vivo se
 * reconstruya desde la versión restaurada (la alternativa —aplicar un update
 * sobre el documento vivo— pisaría los cambios locales sin control).
 *
 * Si el endpoint todavía no responde (404), el panel lo dice y ofrece reintentar.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { History, Loader2, RotateCcw, X } from 'lucide-react';

import { ApiError } from '@/api/client';
import { useSession } from '@/collab/SessionContext';
import { useLanguage, useT } from '@/i18n';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';

import { listBoardVersions, restoreBoardVersion } from './api';
import { RELOAD_NOTICE_KEY } from './reloadNotice';
import { type VersionSnapshot, describeSnapshot, versionDelta } from './snapshots';

export { RELOAD_NOTICE_KEY };

export function HistoryPanel(): JSX.Element | null {
  const open = usePanelsStore((state) => state.historyOpen);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const session = useSession();
  const t = useT();
  const language = useLanguage();
  const boardId = session.boardId;
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const next = await listBoardVersions(boardId, signal);
        if (signal?.aborted) return;
        setVersions(next);
        setSelected(next[0]?.id ?? null);
        setConfirming(null);
      } catch (failure) {
        if (signal?.aborted) return;
        setVersions([]);
        setSelected(null);
        setError(t('history.unavailable'));
        void failure;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [boardId, t],
  );

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [open, load]);

  const current = useMemo(
    () => versions.find((version) => version.id === selected) ?? null,
    [selected, versions],
  );

  if (!open) return null;

  const close = (): void => usePanelsStore.getState().setHistoryOpen(false);

  const restore = async (version: VersionSnapshot): Promise<void> => {
    if (restoring) return;
    setRestoring(true);
    setError(null);
    try {
      const ok = await restoreBoardVersion(boardId, version.id);
      if (!ok) throw new Error('El servidor rechazó la restauración');
      // La copia local del tablero no puede sobrevivir a la restauración: al
      // recargar, el documento se arma desde el remoto y no se fusiona nada. Si
      // sobreviviera, la unión de CRDTs revive lo que la restauración quitó y el
      // proveedor lo vuelve a subir al servidor.
      session.discardLocalDocument();
      try {
        sessionStorage.setItem(RELOAD_NOTICE_KEY, t('history.restored'));
      } catch {
        // sin sessionStorage: el aviso se pierde, la restauración no
      }
      // El documento vivo se reconstruye desde cero: recargar evita mezclar el
      // estado local con la instantánea restaurada.
      window.location.reload();
    } catch (failure) {
      const message =
        failure instanceof ApiError && failure.isNotFound
          ? t('history.unavailable')
          : failure instanceof Error
            ? failure.message
            : String(failure);
      setError(message);
      setRestoring(false);
      setConfirming(null);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('history.title')}>
      <div className="modal__panel history" ref={trapRef}>
        <div className="modal__head">
          <h2 className="modal__title">
            <History size={15} aria-hidden="true" /> {t('history.title')}
          </h2>
          {loading || restoring ? <Loader2 size={14} className="spin" /> : null}
          <button type="button" className="icon-button" title={t('common.close')} onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal__body history__body">
          <p className="sr-only" role="status" data-history-status>
            {restoring ? t('history.restoring') : loading ? t('history.loading') : ''}
          </p>
          <p className="history__hint">{t('history.hint')}</p>

          {error ? (
            <div className="history__error" role="alert">
              <span>{error}</span>
              <button type="button" className="button" onClick={() => void load()}>
                {t('common.retry')}
              </button>
            </div>
          ) : null}

          {!error && versions.length === 0 && !loading ? (
            <p className="history__empty">{t('history.empty')}</p>
          ) : null}

          <div className="history__split">
            <ul className="history__list" role="listbox" aria-label={t('history.title')}>
              {versions.map((version, index) => {
                const delta = versionDelta(versions, index);
                return (
                  <li key={version.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={version.id === selected}
                      className={`history__item${version.id === selected ? ' is-active' : ''}`}
                      data-version={version.id}
                      onClick={() => setSelected(version.id)}
                    >
                      <span className="history__item-date">{describeSnapshot(version.createdAt, language)}</span>
                      <span className="history__item-meta">
                        {t('history.elements', { count: version.elementCount })}
                        {delta !== null && delta !== 0 ? (
                          <span className={`history__delta${delta > 0 ? ' is-up' : ' is-down'}`}>
                            {delta > 0 ? `+${delta}` : delta}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {current ? (
              <section className="history__preview" aria-label={t('history.preview')}>
                <h3 className="history__preview-title">{t('history.preview')}</h3>
                <p className="history__preview-board">{current.title || t('app.untitledBoard')}</p>
                <dl className="history__facts">
                  <div>
                    <dt>{t('history.preview')}</dt>
                    <dd>{t('history.elements', { count: current.elementCount })}</dd>
                  </div>
                  <div>
                    <dt>{t('history.title')}</dt>
                    <dd>{describeSnapshot(current.createdAt, language)}</dd>
                  </div>
                  {current.sizeBytes !== null ? (
                    <div>
                      <dt>{t('history.size', { size: '' }).trim() || 'Tamaño'}</dt>
                      <dd>{formatSize(current.sizeBytes)}</dd>
                    </div>
                  ) : null}
                </dl>

                {confirming === current.id ? (
                  <div className="history__confirm" role="alertdialog" aria-label={t('history.restore')}>
                    <p>{t('history.confirm', { date: describeSnapshot(current.createdAt, language) })}</p>
                    <div className="history__confirm-actions">
                      <button type="button" className="button" onClick={() => setConfirming(null)}>
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        className="button button--primary"
                        disabled={restoring}
                        data-restore-confirm={current.id}
                        onClick={() => void restore(current)}
                      >
                        {restoring ? t('history.restoring') : t('common.confirm')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button button--primary history__restore"
                    data-restore={current.id}
                    disabled={restoring}
                    onClick={() => setConfirming(current.id)}
                  >
                    <RotateCcw size={14} /> {t('history.restore')}
                  </button>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tamaño legible sin depender del módulo de ajustes (para la previsualización). */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

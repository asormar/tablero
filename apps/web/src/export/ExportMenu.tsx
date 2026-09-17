/**
 * Menú de exportación (punto 3 de la fase 4).
 *
 * Markdown, texto y ZIP los arma el servidor; PNG lo renderiza el navegador y
 * PDF sale por el diálogo de impresión con la hoja de estilo. Cada opción
 * muestra su estado y, si falla, el motivo real (nunca un «error» mudo).
 */

import { useState } from 'react';

import { FileArchive, FileDown, FileText, Image, Loader2, Package, Printer, X } from 'lucide-react';

import { ApiError } from '@/api/client';
import type { BoardSession } from '@/collab/BoardSession';
import { useT } from '@/i18n';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';

import { exportAccount, exportBoard, saveBlob } from './exportApi';
import { renderBoardToPng } from './exportPng';
import { fileNameFor } from './naming';
import { printBoard } from './printBoard';

export function ExportMenu({ session }: { session: BoardSession }): JSX.Element | null {
  const open = usePanelsStore((state) => state.exportOpen);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boardId = useAppStore((state) => state.currentBoardId);
  const board = useAppStore((state) => state.boards.find((item) => item.id === state.currentBoardId) ?? null);
  const title = board?.title ?? t('app.untitledBoard');

  if (!open) return null;

  const close = (): void => usePanelsStore.getState().setExportOpen(false);

  const fail = (failure: unknown): void => {
    const message =
      failure instanceof ApiError
        ? failure.message
        : failure instanceof Error
          ? failure.message
          : String(failure);
    setError(t('export.failed', { message }));
  };

  const run = (key: string, task: () => Promise<void>): void => {
    if (busy) return;
    setBusy(key);
    setError(null);
    void task()
      .then(() => {
        useAppStore.getState().setNotice(t('export.done'));
      })
      .catch(fail)
      .finally(() => setBusy(null));
  };

  const serverFormats: { key: 'markdown' | 'text' | 'zip'; label: string; hint: string; icon: JSX.Element }[] = [
    { key: 'markdown', label: t('export.markdown'), hint: t('export.markdownHint'), icon: <FileText size={15} /> },
    { key: 'text', label: t('export.text'), hint: t('export.textHint'), icon: <FileDown size={15} /> },
    { key: 'zip', label: t('export.zip'), hint: t('export.zipHint'), icon: <FileArchive size={15} /> },
  ];

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('export.title')}>
      <div className="modal__panel export" ref={trapRef}>
        <div className="modal__head">
          <h2 className="modal__title">{t('export.title')}</h2>
          {busy ? <Loader2 size={14} className="spin" /> : null}
          <button type="button" className="icon-button" title={t('common.close')} onClick={close}>
            <X size={15} />
          </button>
        </div>
        <div className="modal__body export__body">
          <p className="sr-only" role="status" data-export-status>
            {busy ? `Generando el archivo (${busy})…` : ''}
          </p>
          {serverFormats.map((format) => (
            <button
              key={format.key}
              type="button"
              className="export__row"
              data-export={format.key}
              disabled={busy !== null || !boardId}
              onClick={() =>
                run(format.key, async () => {
                  if (!boardId) return;
                  await exportBoard(boardId, format.key, fileNameFor(title, format.key, true));
                })
              }
            >
              <span className="export__icon" aria-hidden="true">
                {busy === format.key ? <Loader2 size={15} className="spin" /> : format.icon}
              </span>
              <span className="export__labels">
                <span className="export__label">{format.label}</span>
                <span className="export__hint">{format.hint}</span>
              </span>
            </button>
          ))}

          <button
            type="button"
            className="export__row"
            data-export="png"
            disabled={busy !== null}
            onClick={() =>
              run('png', async () => {
                const { blob, width, height } = await renderBoardToPng(session, 2);
                if (blob.size === 0) throw new Error('PNG vacío');
                saveBlob(blob, fileNameFor(title, 'png', true));
                useAppStore.getState().setNotice(`PNG ${width}×${height} listo.`);
              })
            }
          >
            <span className="export__icon" aria-hidden="true">
              {busy === 'png' ? <Loader2 size={15} className="spin" /> : <Image size={15} />}
            </span>
            <span className="export__labels">
              <span className="export__label">{t('export.png')}</span>
              <span className="export__hint">{t('export.pngHint')}</span>
            </span>
          </button>

          <button
            type="button"
            className="export__row"
            data-export="pdf"
            disabled={busy !== null}
            onClick={() =>
              run('pdf', async () => {
                const ok = await printBoard(session);
                if (!ok) throw new Error('el navegador bloqueó el diálogo de impresión');
              })
            }
          >
            <span className="export__icon" aria-hidden="true">
              {busy === 'pdf' ? <Loader2 size={15} className="spin" /> : <Printer size={15} />}
            </span>
            <span className="export__labels">
              <span className="export__label">{t('export.pdf')}</span>
              <span className="export__hint">{t('export.pdfHint')}</span>
            </span>
          </button>

          <button
            type="button"
            className="export__row"
            data-export="account"
            disabled={busy !== null || !useAppStore.getState().apiOnline}
            onClick={() =>
              run('account', async () => {
                await exportAccount(fileNameFor('cuenta-tablero', 'zip', true));
              })
            }
          >
            <span className="export__icon" aria-hidden="true">
              {busy === 'account' ? <Loader2 size={15} className="spin" /> : <Package size={15} />}
            </span>
            <span className="export__labels">
              <span className="export__label">{t('export.account')}</span>
              <span className="export__hint">{t('export.accountHint')}</span>
            </span>
          </button>

          {busy ? <p className="export__status">{t('export.working')}</p> : null}
          {error ? <p className="export__error">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Importación desde la interfaz (punto 3 de la fase 4).
 *
 * Acepta el ZIP de copia de seguridad (crea un tablero nuevo), Markdown (un
 * documento), CSV (tabla o lista de tareas, con los ayudantes compartidos) y un
 * lote de imágenes (las sube el camino normal de subida, con la cámara incluida).
 * Valida antes de tocar nada y resume lo que hizo.
 */

import { useMemo, useRef, useState } from 'react';

import { Loader2, Upload, X } from 'lucide-react';

import { type TableData, todoItemsFromDelimited, tableFromDelimited } from '@tablero/shared';

import { ApiError } from '@/api/client';
import { createElementAt, viewportCenter } from '@/canvas/commands';
import { attachFilesToBoard } from '@/canvas/uploadController';
import type { BoardSession } from '@/collab/BoardSession';
import { useT } from '@/i18n';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';

import {
  type ImportKind,
  detectImportKind,
  markdownToPlainText,
  parseBackupZip,
  titleFromFileName,
} from './importers';
import { importBackupAsBoard } from './importZip';

const ACCEPT = '.zip,.md,.markdown,.csv,.tsv,image/*';

export function ImportDialog({
  session,
  onOpenBoard,
}: {
  session: BoardSession;
  onOpenBoard(boardId: string): void;
}): JSX.Element | null {
  const open = usePanelsStore((state) => state.importOpen);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<'current' | 'root'>('current');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const currentBoardId = useAppStore((state) => state.currentBoardId);
  const board = useAppStore((state) => state.boards.find((item) => item.id === state.currentBoardId) ?? null);
  const title = useMemo(() => board?.title ?? t('app.untitledBoard'), [board?.title, t]);

  if (!open) return null;

  const close = (): void => usePanelsStore.getState().setImportOpen(false);

  const handleFile = async (file: File): Promise<void> => {
    const kind: ImportKind = detectImportKind(file.name, file.type);
    setError(null);
    setBusy(true);
    try {
      if (kind === 'zip') {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = parseBackupZip(bytes);
        const summary = await importBackupAsBoard(parsed, target === 'current' ? currentBoardId : null);
        useAppStore.getState().upsertBoard(summary.board);
        close();
        onOpenBoard(summary.board.id);
        useAppStore
          .getState()
          .setNotice(
            t('import.done', {
              summary: `${summary.board.title}${summary.assets > 0 ? ` · ${summary.assets} archivo(s)` : ''}`,
            }),
          );
        return;
      }

      if (kind === 'markdown') {
        const text = await file.text();
        const plain = markdownToPlainText(text);
        createElementAt(session, 'document', viewportCenter(), {
          size: { width: 340, height: 260 },
          init: { title: titleFromFileName(file.name) },
          text: plain,
        });
        useAppStore.getState().setNotice(t('import.done', { summary: file.name }));
        close();
        return;
      }

      if (kind === 'csv') {
        const text = await file.text();
        const asTasks = /^\[[ xX]\]|^\s*[-*•]\s/m.test(text) || window.confirm('¿Importar como lista de tareas? (Cancelar = tabla)');
        if (asTasks) {
          const items = todoItemsFromDelimited(text);
          createElementAt(session, 'todo', viewportCenter(), {
            size: { width: 300, height: 220 },
            init: { items, title: titleFromFileName(file.name) },
          });
        } else {
          const table: TableData = tableFromDelimited(text, true);
          createElementAt(session, 'table', viewportCenter(), {
            size: { width: 460, height: 240 },
            init: { table },
          });
        }
        useAppStore.getState().setNotice(t('import.done', { summary: file.name }));
        close();
        return;
      }

      if (kind === 'image') {
        await attachFilesToBoard(session, [file], { world: viewportCenter(), columnId: null });
        useAppStore.getState().setNotice(t('import.done', { summary: file.name }));
        close();
        return;
      }

      throw new Error('Formato no reconocido (.zip, .md, .csv o imágenes)');
    } catch (failure) {
      const message = failure instanceof ApiError ? failure.message : failure instanceof Error ? failure.message : String(failure);
      setError(t('import.failed', { message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('import.title')}>
      <div className="modal__panel import" ref={trapRef}>
        <div className="modal__head">
          <h2 className="modal__title">{t('import.title')}</h2>
          {busy ? <Loader2 size={14} className="spin" /> : null}
          <button type="button" className="icon-button" title={t('common.close')} onClick={close}>
            <X size={15} />
          </button>
        </div>
        <div className="modal__body import__body">
          <p className="sr-only" role="status" data-import-status>
            {busy ? t('import.working') : ''}
          </p>
          <p className="import__hint">{t('import.hint')}</p>
          <div
            className="import__drop"
            data-import-drop
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) void handleFile(file);
            }}
          >
            <Upload size={18} aria-hidden="true" />
            <p>{t('import.drop')}</p>
            <button
              type="button"
              className="button button--primary"
              data-import-pick
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {t('import.pick')}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              hidden
              data-import-input
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.target.value = '';
              }}
            />
          </div>

          <label className="field">
            <span className="field__label">{t('import.target')}</span>
            <select
              className="field__input"
              value={target}
              data-import-target
              onChange={(event) => setTarget(event.target.value === 'root' ? 'root' : 'current')}
            >
              <option value="current">{t('import.targetCurrent')}</option>
              <option value="root">{t('app.untitledBoard') === 'Untitled board' ? 'Root' : 'Nivel raíz'}</option>
            </select>
          </label>
          <p className="import__note">{t('import.markdownAsDocument')}</p>
          {busy ? <p className="import__status">{t('import.working')}</p> : null}
          {error ? <p className="import__error">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

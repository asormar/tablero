/**
 * Vista de lista del tablero (punto 8 de la fase 4): el lienzo aplastado a una
 * lista en orden de lectura, pensada para pantallas chicas.
 *
 * Cada fila lleva a su tarjeta (centra y resalta al volver al lienzo), y arriba
 * están las dos acciones del móvil: añadir nota y añadir foto con la cámara.
 * La vista no reemplaza al lienzo: es una capa que se cierra al ir a una tarjeta.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { Camera, List, Plus, X } from 'lucide-react';

import { type ElementType } from '@tablero/shared';

import { createNoteAt, focusElementInView, spawnPoint } from '@/canvas/commands';
import { attachFilesToBoard } from '@/canvas/uploadController';
import { useSession, useSessionElements } from '@/collab/SessionContext';
import { useT } from '@/i18n';
import { readingOrder } from '@/lib/readingOrder';
import { elementTypeLabel } from '@/search/typeLabels';
import { elementPlainText } from '@/search/searchLocal';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useUiStore } from '@/state/uiStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';

import { type ListRow, buildListRows, listSummary } from './listRows';

export function ListView(): JSX.Element | null {
  const open = usePanelsStore((state) => state.listViewOpen);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const t = useT();
  const session = useSession();
  const elements = useSessionElements();
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const rows = useMemo<ListRow[]>(() => {
    if (!open) return [];
    const ordered = readingOrder(elements);
    return buildListRows(
      ordered,
      (element) => elementPlainText(element, session.getTextBlocks(element.id)),
      (type) => elementTypeLabel(type, t),
    );
  }, [open, elements, session, t]);

  if (!open) return null;

  const close = (): void => usePanelsStore.getState().setListViewOpen(false);
  const summary = listSummary(rows);

  const goTo = (row: ListRow): void => {
    close();
    useUiStore.getState().setHomeOpen(false);
    focusElementInView(session, row.id);
    usePanelsStore.getState().flashElement(row.id);
  };

  const addNote = (): void => {
    const id = createNoteAt(session, spawnPoint());
    close();
    focusElementInView(session, id);
    usePanelsStore.getState().flashElement(id);
    useUiStore.getState().setEditing(id);
  };

  const onCamera = useCallback(
    async (file: File | null): Promise<void> => {
      if (!file || busy) return;
      setBusy(true);
      try {
        const { finished } = await attachFilesToBoard(session, [file], { world: spawnPoint() });
        await finished;
        useAppStore.getState().setNotice(t('listView.photo'));
      } finally {
        setBusy(false);
      }
    },
    [busy, session, t],
  );

  return (
    <div className="list-view" role="dialog" aria-modal="true" aria-label={t('listView.title')} data-list-view ref={trapRef}>
      <header className="list-view__head">
        <h2 className="list-view__title">
          <List size={15} aria-hidden="true" /> {t('listView.title')}
        </h2>
        <span className="list-view__count" data-list-count>
          {rows.length}
        </span>
        <button
          type="button"
          className="icon-button icon-button--small"
          title={t('listView.note')}
          data-list-add-note
          onClick={addNote}
        >
          <Plus size={15} />
        </button>
        <button
          type="button"
          className="icon-button icon-button--small"
          title={t('listView.photo')}
          data-list-photo
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera size={15} />
        </button>
        <button
          type="button"
          className="icon-button icon-button--small"
          title={t('listView.showCanvas')}
          data-list-close
          onClick={close}
        >
          <X size={15} />
        </button>
        <input
          ref={cameraRef}
          className="list-view__camera"
          type="file"
          accept="image/*"
          capture="environment"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = '';
            void onCamera(file);
          }}
        />
      </header>

      {rows.length === 0 ? (
        <p className="list-view__empty">{t('listView.empty')}</p>
      ) : (
        <ul className="list-view__rows" data-list-rows>
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={`list-view__row list-view__row--${row.type}`}
                style={{ paddingLeft: `${10 + row.depth * 18}px` }}
                data-list-row={row.id}
                data-list-depth={row.depth}
                onClick={() => goTo(row)}
              >
                <span className="list-view__type">{elementTypeLabel(row.type as ElementType, t)}</span>
                <span className="list-view__text">
                  <span className="list-view__primary">{row.primary}</span>
                  {row.secondary ? <span className="list-view__secondary">{row.secondary}</span> : null}
                </span>
                {row.progress && row.progress.total > 0 ? (
                  <span className="list-view__progress">
                    {row.progress.done}/{row.progress.total}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="list-view__foot">
        {summary.todos > 0 ? `${summary.done}/${summary.todos}` : ''} · {t('listView.open')}
      </footer>
    </div>
  );
}

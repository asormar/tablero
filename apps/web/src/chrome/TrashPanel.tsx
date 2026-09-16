/**
 * Panel de papelera (§7.4): los elementos del documento actual y los tableros
 * que están en papelera en el servidor, con restaurar y borrado definitivo.
 *
 * Son dos papeleras distintas y el panel las muestra juntas: los **elementos**
 * viven en el documento Yjs (marcados con `deletedAt`; se purgan a los 30 días al
 * abrir el tablero) y los **tableros** viven en Postgres (`Board.trashedAt`, con
 * su propia API).
 */

import { useEffect, useMemo, useState } from 'react';

import { Archive, ArchiveRestore, Loader2, RefreshCw, Trash2 } from 'lucide-react';

import { type BoardSummary, TRASH_TTL_MS, type ElementType, elementLabel } from '@tablero/shared';

import { fetchTrashBoards, purgeTrashedBoard, restoreTrashedBoard } from '@/api/boards';
import type { BoardSession } from '@/collab/BoardSession';
import { useSession, useTrashedElements } from '@/collab/SessionContext';
import { blocksToPlainText } from '@/lib/textBlocks';
import { emptyTrashForever, purgeExpiredTrash, restoreTrashedElements } from '@/lib/trashActions';
import { useAppStore } from '@/state/appStore';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Texto corto de un elemento eliminado (título de la fila). */
function titleOf(session: BoardSession, id: string, type: ElementType): string {
  const element = session.getElement(id);
  if (element && element.type === 'board') {
    const board = useAppStore.getState().boards.find((item) => item.id === element.boardId);
    return board?.title ?? 'Tablero';
  }
  const line = blocksToPlainText(session.getTextBlocks(id)).split('\n').find((text) => text.trim().length > 0);
  return line?.trim() ?? elementLabel(type);
}

/** Días que le quedan al elemento en la papelera antes del purgado automático. */
function daysLeft(deletedAt: number | null | undefined): number {
  if (!deletedAt) return 0;
  return Math.max(0, Math.ceil((TRASH_TTL_MS - (Date.now() - deletedAt)) / DAY_MS));
}

export function TrashPanelBody(): JSX.Element {
  const session = useSession();
  const trashed = useTrashedElements();
  const apiOnline = useAppStore((state) => state.apiOnline);
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  /** Confirmación en dos pasos para el borrado definitivo. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Purgado de los 30 días cada vez que se abre la papelera (además del que hace
  // el espacio de trabajo al abrir el tablero).
  useEffect(() => {
    void purgeExpiredTrash(session);
  }, [session]);

  useEffect(() => {
    if (!apiOnline) {
      setBoards([]);
      return undefined;
    }
    let cancelled = false;
    setError(null);
    void fetchTrashBoards()
      .then((list) => {
        if (!cancelled) setBoards(list);
      })
      .catch(() => {
        if (!cancelled) {
          setBoards([]);
          setError('No se pudo leer la papelera de tableros.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiOnline, revision]);

  const elements = useMemo(
    () =>
      trashed.map((element) => ({
        id: element.id,
        type: element.type,
        title: titleOf(session, element.id, element.type),
        deletedAt: element.deletedAt ?? 0,
      })),
    [session, trashed],
  );

  const restore = (id: string): void => {
    const restored = restoreTrashedElements(session, [id]);
    if (restored.length > 0) useAppStore.getState().setNotice('Se restauró 1 elemento.');
  };

  const emptyElements = (): void => {
    if (confirming !== 'elements' || busy) return;
    setBusy(true);
    void emptyTrashForever(session)
      .then((ids) => {
        useAppStore.getState().setNotice(
          ids.length === 1 ? 'Se borró 1 elemento para siempre.' : `Se borraron ${ids.length} elementos para siempre.`,
        );
        setConfirming(null);
      })
      .finally(() => setBusy(false));
  };

  const restoreBoard = (id: string): void => {
    if (busy) return;
    setBusy(true);
    void restoreTrashedBoard(id)
      .then((board) => {
        useAppStore.getState().upsertBoard(board);
        useAppStore.getState().setNotice(`Se restauró «${board.title}».`);
        setRevision((value) => value + 1);
      })
      .catch(() => useAppStore.getState().setNotice('No se pudo restaurar el tablero.'))
      .finally(() => setBusy(false));
  };

  const purgeBoard = (id: string): void => {
    if (confirming !== id || busy) return;
    setBusy(true);
    void purgeTrashedBoard(id)
      .then(() => {
        useAppStore.getState().setNotice('Se borró el tablero para siempre.');
        setConfirming(null);
        setRevision((value) => value + 1);
      })
      .catch(() => useAppStore.getState().setNotice('No se pudo borrar el tablero.'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="trash">
      <section className="trash__section" aria-label="Elementos en papelera">
        <header className="trash__head">
          <h3 className="trash__title">Elementos de este tablero</h3>
          {elements.length > 0 ? (
            <button
              type="button"
              className="trash__action trash__action--danger"
              disabled={busy}
              onClick={() => (confirming === 'elements' ? emptyElements() : setConfirming('elements'))}
            >
              <Trash2 size={12} />
              {confirming === 'elements' ? 'Confirmar borrado' : 'Vaciar papelera'}
            </button>
          ) : null}
        </header>

        {elements.length === 0 ? (
          <p className="trash__empty">No hay elementos en la papelera.</p>
        ) : (
          <ul className="trash__list">
            {elements.map((element) => (
              <li key={element.id} className="trash__item" data-trash-element={element.id}>
                <span className="trash__item-type">{elementLabel(element.type)}</span>
                <span className="trash__item-title" title={element.title}>
                  {element.title}
                </span>
                <span className="trash__item-age" title="Días antes del borrado definitivo">
                  {daysLeft(element.deletedAt)} d
                </span>
                <button
                  type="button"
                  className="trash__action"
                  title="Restaurar el elemento"
                  onClick={() => restore(element.id)}
                >
                  <ArchiveRestore size={12} />
                  Restaurar
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="trash__hint">
          Lo que quede en la papelera más de 30 días se borra para siempre al abrir el tablero.
        </p>
      </section>

      <section className="trash__section" aria-label="Tableros en papelera">
        <header className="trash__head">
          <h3 className="trash__title">Tableros</h3>
          <button
            type="button"
            className="icon-button icon-button--small"
            title="Recargar la lista"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={12} />
          </button>
        </header>

        {!apiOnline ? <p className="trash__empty">Sin conexión: los tableros en papelera viven en el servidor.</p> : null}
        {error ? <p className="trash__empty">{error}</p> : null}
        {boards === null && apiOnline ? (
          <p className="trash__empty">
            <Loader2 size={12} className="spin" /> Leyendo…
          </p>
        ) : null}
        {boards && boards.length === 0 ? <p className="trash__empty">No hay tableros en la papelera.</p> : null}

        {boards && boards.length > 0 ? (
          <ul className="trash__list">
            {boards.map((board) => (
              <li key={board.id} className="trash__item" data-trash-board={board.id}>
                <span className="trash__item-type" aria-hidden="true">
                  {board.icon ?? <Archive size={12} />}
                </span>
                <span className="trash__item-title" title={board.title}>
                  {board.title || 'Tablero sin título'}
                </span>
                <button
                  type="button"
                  className="trash__action"
                  title="Restaurar el tablero"
                  disabled={busy}
                  onClick={() => restoreBoard(board.id)}
                >
                  <ArchiveRestore size={12} />
                  Restaurar
                </button>
                <button
                  type="button"
                  className="trash__action trash__action--danger"
                  title="Borrar el tablero para siempre"
                  disabled={busy}
                  onClick={() => (confirming === board.id ? purgeBoard(board.id) : setConfirming(board.id))}
                >
                  <Trash2 size={12} />
                  {confirming === board.id ? 'Confirmar' : 'Borrar'}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

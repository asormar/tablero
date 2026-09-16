/**
 * «Mover a…»: buscador de tableros para mover la selección.
 *
 * El movimiento es del lado del cliente (`transferElements`): abre una sesión
 * temporal del destino, copia y solo entonces borra del origen.
 */

import { useEffect, useMemo, useState } from 'react';

import { FolderInput, Search, X } from 'lucide-react';

import { ROOT_BOARD_TITLE, buildBreadcrumbPath } from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { transferElements, transferFailureMessage } from '@/lib/boardTransfer';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

export function MoveToDialog({ session }: { session: BoardSession }): JSX.Element | null {
  const open = useUiStore((state) => state.moveToOpen);
  const selection = useUiStore((state) => state.selection);
  const boards = useAppStore((state) => state.boards);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return boards
      .filter((board) => board.trashedAt === null && board.id !== session.boardId)
      .map((board) => {
        const path = buildBreadcrumbPath(boards, board.id)
          .map((item) => item.title || ROOT_BOARD_TITLE)
          .join(' › ');
        return { id: board.id, title: board.title || 'Tablero sin título', path, onServer: !board.id.startsWith('bd_') };
      })
      .filter((option) => option.onServer)
      .filter((option) => (needle.length === 0 ? true : `${option.title} ${option.path}`.toLowerCase().includes(needle)))
      .slice(0, 40);
  }, [boards, query, session.boardId]);

  if (!open) return null;

  const close = (): void => useUiStore.getState().setMoveToOpen(false);

  const move = (boardId: string): void => {
    if (busy || selection.length === 0) return;
    setBusy(true);
    void transferElements(session, selection, boardId)
      .then((result) => {
        const store = useAppStore.getState();
        if (result.failure) {
          store.setNotice(transferFailureMessage(result.failure));
          return;
        }
        store.setNotice(
          result.moved === 1 ? 'Se movió 1 tarjeta.' : `Se movieron ${result.moved} tarjetas.`,
        );
        useUiStore.getState().clearSelection();
        close();
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Mover a otro tablero">
      <div className="modal__panel move-to">
        <header className="modal__head">
          <h2 className="modal__title">
            <FolderInput size={15} /> Mover a…
          </h2>
          <button type="button" className="icon-button" title="Cerrar (Esc)" onClick={close}>
            <X size={15} />
          </button>
        </header>
        <div className="modal__body">
          <label className="move-to__search">
            <Search size={13} />
            <input
              autoFocus
              value={query}
              placeholder="Buscar tablero…"
              aria-label="Buscar tablero destino"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') close();
                if (event.key === 'Enter' && options[0]) move(options[0].id);
              }}
            />
          </label>
          <ul className="move-to__list">
            {options.length === 0 ? (
              <li className="move-to__empty">No hay otro tablero que coincida.</li>
            ) : (
              options.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className="move-to__item"
                    disabled={busy}
                    onClick={() => move(option.id)}
                  >
                    <span className="move-to__item-title">{option.title}</span>
                    {option.path.length > 0 ? <span className="move-to__item-path">{option.path}</span> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
          <p className="move-to__hint">
            {selection.length === 0
              ? 'No hay nada seleccionado: elegí tarjetas en el lienzo.'
              : `Se ${selection.length === 1 ? 'moverá 1 tarjeta' : `moverán ${selection.length} tarjetas`} con su texto.`}
          </p>
        </div>
      </div>
    </div>
  );
}

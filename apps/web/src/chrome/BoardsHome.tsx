/**
 * Página «Tableros» (§7.6): favoritos y recientes, la vista de inicio del
 * catálogo. La estrella marca y desmarca con `PATCH /api/boards/:id { favorite }`
 * y las listas salen de `?filter=favorites` y `?filter=recent` (con el catálogo
 * local como respaldo si la API no está).
 */

import { useCallback, useEffect, useState } from 'react';

import { Clock, Home, Loader2, Star, X } from 'lucide-react';

import { type BoardSummary, ROOT_BOARD_TITLE, buildBreadcrumbPath } from '@tablero/shared';

import { listBoards, setBoardFavorite } from '@/api/boards';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';

function byRecent(a: BoardSummary, b: BoardSummary): number {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

export function BoardsHome({ onOpenBoard }: { onOpenBoard(boardId: string): void }): JSX.Element | null {
  const open = useUiStore((state) => state.homeOpen);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const boards = useAppStore((state) => state.boards);
  const apiOnline = useAppStore((state) => state.apiOnline);
  const [favorites, setFavorites] = useState<BoardSummary[]>([]);
  const [recent, setRecent] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (apiOnline) {
        const [favs, recents] = await Promise.all([listBoards('favorites'), listBoards('recent')]);
        setFavorites(favs);
        setRecent(recents);
        return;
      }
      const local = useAppStore.getState().boards;
      setFavorites(local.filter((board) => board.favorited === true).sort(byRecent));
      setRecent([...local].filter((board) => board.trashedAt === null).sort(byRecent));
    } catch {
      useAppStore.getState().setNotice('No se pudo leer el catálogo de tableros.');
    } finally {
      setLoading(false);
    }
  }, [apiOnline]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') useUiStore.getState().setHomeOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const close = (): void => useUiStore.getState().setHomeOpen(false);

  const toggleFavorite = (board: BoardSummary): void => {
    const next = !board.favorited;
    // Optimista: la estrella responde ya; si la API falla se revierte.
    useAppStore.getState().upsertBoard({ ...board, favorited: next });
    void setBoardFavorite(board.id, next)
      .then((updated) => {
        useAppStore.getState().upsertBoard(updated);
        void refresh();
      })
      .catch(() => {
        useAppStore.getState().upsertBoard({ ...board, favorited: !next });
        useAppStore.getState().setNotice('No se pudo cambiar el favorito.');
      });
  };

  const pathOf = (board: BoardSummary): string => {
    const path = buildBreadcrumbPath(boards, board.id).map((item) => item.title || ROOT_BOARD_TITLE);
    return path.length > 0 ? path.join(' › ') : '';
  };

  const row = (board: BoardSummary): JSX.Element => (
    <li key={board.id} className="home__item" data-board-row={board.id}>
      <button type="button" className="home__open" onClick={() => { close(); onOpenBoard(board.id); }}>
        <span className="home__icon" aria-hidden="true">
          {board.icon ?? '📋'}
        </span>
        <span className="home__labels">
          <span className="home__title">{board.title || 'Tablero sin título'}</span>
          {pathOf(board).length > 0 ? <span className="home__path">{pathOf(board)}</span> : null}
        </span>
      </button>
      <button
        type="button"
        className={`home__star${board.favorited ? ' is-active' : ''}`}
        title={board.favorited ? 'Quitar de favoritos' : 'Marcar como favorito'}
        aria-pressed={board.favorited === true}
        onClick={() => toggleFavorite(board)}
      >
        <Star size={14} fill={board.favorited ? 'currentColor' : 'none'} />
      </button>
    </li>
  );

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Tableros">
      <div className="modal__panel home" ref={trapRef}>
        <div className="modal__head">
          <h2 className="modal__title">
            <Home size={15} /> Tableros
          </h2>
          {loading ? <Loader2 size={14} className="spin" /> : null}
          <button type="button" className="icon-button" title="Cerrar (Esc)" onClick={close}>
            <X size={15} />
          </button>
        </div>
        <div className="modal__body home__body">
          <section className="home__section" aria-label="Favoritos">
            <h3 className="home__section-title">
              <Star size={13} /> Favoritos
            </h3>
            {favorites.length === 0 ? (
              <p className="home__empty">Todavía no marcaste ningún tablero con la estrella.</p>
            ) : (
              <ul className="home__list">{favorites.map(row)}</ul>
            )}
          </section>

          <section className="home__section" aria-label="Recientes">
            <h3 className="home__section-title">
              <Clock size={13} /> Recientes
            </h3>
            {recent.length === 0 ? (
              <p className="home__empty">Sin tableros para mostrar.</p>
            ) : (
              <ul className="home__list">{recent.map(row)}</ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

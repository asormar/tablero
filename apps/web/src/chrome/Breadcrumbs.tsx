/**
 * Migas de pan con la ruta de tableros anidados.
 *
 * La ruta se calcula con el catálogo local (`buildBreadcrumbPath`) y, si está
 * incompleta, se pide al backend. Cada tramo menos el actual es navegable.
 * Los tramos quedan marcados como zona de soltado para la fase 3 (mover una
 * tarjeta de tablero dentro de otro tablero arrastrándola a las migas).
 */

import { useEffect, useState } from 'react';

import { type BoardSummary, ROOT_BOARD_TITLE } from '@tablero/shared';
import { ChevronRight } from 'lucide-react';

import { breadcrumbsFor } from '@/app/boardService';
import { useAppStore } from '@/state/appStore';

export type BreadcrumbsProps = {
  boardId: string;
  onOpenBoard(boardId: string): void;
};

export function Breadcrumbs({ boardId, onOpenBoard }: BreadcrumbsProps): JSX.Element {
  const [path, setPath] = useState<BoardSummary[]>([]);
  const boards = useAppStore((state) => state.boards);

  useEffect(() => {
    let cancelled = false;
    void breadcrumbsFor(boardId).then((result) => {
      if (!cancelled) setPath(result);
    });
    return () => {
      cancelled = true;
    };
  }, [boardId, boards]);

  return (
    <nav className="crumbs" aria-label="Ruta de tableros">
      {path.map((board, index) => {
        const isLast = index === path.length - 1;
        const label = index === 0 ? (board.title || ROOT_BOARD_TITLE) : board.title || 'Tablero';
        return (
          <span key={board.id} className="crumbs__item">
            {index > 0 ? <ChevronRight size={14} className="crumbs__sep" aria-hidden="true" /> : null}
            <button
              type="button"
              className={`crumbs__link${isLast ? ' is-current' : ''}`}
              data-drop-target="breadcrumb"
              data-board-id={board.id}
              aria-current={isLast ? 'page' : undefined}
              title={isLast ? label : `Ir a ${label}`}
              onClick={() => {
                if (!isLast) onOpenBoard(board.id);
              }}
            >
              {board.icon ? <span className="crumbs__icon">{board.icon}</span> : null}
              <span className="crumbs__text">{label}</span>
            </button>
          </span>
        );
      })}
      {path.length === 0 ? <span className="crumbs__placeholder" /> : null}
    </nav>
  );
}

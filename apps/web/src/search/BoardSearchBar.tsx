/**
 * Búsqueda dentro del tablero actual (Ctrl/Cmd+F) — punto 1 de la fase 4.
 *
 * Barra flotante sobre el lienzo: escribe, ve las coincidencias en orden de
 * lectura y navega con Enter / Shift+Enter (o con las flechas). Cada salto
 * centra la tarjeta y la destaca.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

import { type ElementType } from '@tablero/shared';

import { focusElementInView } from '@/canvas/commands';
import { useSession, useSessionElements } from '@/collab/SessionContext';
import { useT } from '@/i18n';
import { readingOrder } from '@/lib/readingOrder';
import { usePanelsStore } from '@/state/panelsStore';

import { highlightSegments } from './highlight';
import { type LocalHit, searchCards } from './searchLocal';
import { elementTypeLabel } from './typeLabels';

const VISIBLE_LIMIT = 40;

export function BoardSearchBar(): JSX.Element | null {
  const open = usePanelsStore((state) => state.boardSearchOpen);
  const session = useSession();
  const elements = useSessionElements();
  const t = useT();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  /** Última tarjeta a la que se saltó, para no repetir el encuadre. */
  const jumpedTo = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const hits = useMemo<LocalHit[]>(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length === 0) return [];
    const cards = readingOrder(elements).map((element) => ({
      id: element.id,
      type: element.type as ElementType,
      element,
      blocks: session.getTextBlocks(element.id),
    }));
    return searchCards(cards, trimmed, VISIBLE_LIMIT);
  }, [open, query, elements, session]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    jumpedTo.current = null;
    const timer = setTimeout(() => inputRef.current?.select(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  const jump = useCallback(
    (index: number) => {
      const hit = hits[index];
      if (!hit) return;
      jumpedTo.current = hit.elementId;
      focusElementInView(session, hit.elementId);
      usePanelsStore.getState().flashElement(hit.elementId);
    },
    [hits, session],
  );

  // Al cambiar la lista (o el índice activo) se salta a la coincidencia.
  useEffect(() => {
    if (!open) return;
    const hit = hits[active];
    if (!hit) return;
    if (jumpedTo.current === hit.elementId) return;
    jump(active);
  }, [open, active, hits, jump]);

  if (!open) return null;

  const close = (): void => {
    usePanelsStore.getState().setBoardSearchOpen(false);
  };

  const step = (direction: 1 | -1): void => {
    if (hits.length === 0) return;
    setActive((current) => (current + direction + hits.length) % hits.length);
  };

  return (
    <div className="board-search" role="search" aria-label={t('boardSearch.aria')}>
      <div className="board-search__bar">
        <Search size={14} aria-hidden="true" />
        <input
          ref={inputRef}
          className="board-search__input"
          type="text"
          value={query}
          placeholder={t('boardSearch.placeholder')}
          aria-label={t('boardSearch.aria')}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            jumpedTo.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              // Primer Enter: si todavía no se saltó, va a la primera.
              if (jumpedTo.current === null && hits.length > 0) jump(active);
              else step(event.shiftKey ? -1 : 1);
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              step(1);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              step(-1);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        />
        <span className="board-search__count" data-board-search-count>
          {hits.length === 0
            ? query.trim().length > 0
              ? t('boardSearch.none')
              : ''
            : t('boardSearch.count', { current: active + 1, total: hits.length })}
        </span>
        <button
          type="button"
          className="icon-button icon-button--small"
          title={t('boardSearch.prev')}
          disabled={hits.length === 0}
          onClick={() => step(-1)}
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          className="icon-button icon-button--small"
          title={t('boardSearch.next')}
          disabled={hits.length === 0}
          onClick={() => step(1)}
        >
          <ChevronDown size={14} />
        </button>
        <button
          type="button"
          className="icon-button icon-button--small"
          title={t('boardSearch.close')}
          onClick={() => usePanelsStore.getState().setBoardSearchOpen(false)}
        >
          <X size={14} />
        </button>
      </div>

      {hits.length > 0 ? (
        <ul className="board-search__results">
          {hits.slice(0, 8).map((hit, index) => (
            <li key={hit.elementId}>
              <button
                type="button"
                className={`board-search__result${index === active ? ' is-active' : ''}`}
                data-board-search-hit={hit.elementId}
                onClick={() => {
                  setActive(index);
                  jump(index);
                }}
              >
                <span className="board-search__type">{elementTypeLabel(hit.elementType, t)}</span>
                <span className="board-search__snippet">
                  {highlightSegments(hit.snippet, hit.terms).map((segment, segmentIndex) =>
                    segment.match ? <mark key={segmentIndex}>{segment.text}</mark> : <span key={segmentIndex}>{segment.text}</span>,
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

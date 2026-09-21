/**
 * Paleta de comandos y búsqueda global (Ctrl/Cmd+K) — punto 1 de la fase 4.
 *
 * Tres bloques en la misma lista: coincidencias en el tablero abierto (locales,
 * siempre disponibles), resultados del índice del servidor agrupados por tablero
 * y acciones. Al elegir un resultado se abre su tablero, se centra el elemento y
 * se lo destaca; si el servidor todavía no expone `/api/search`, la paleta
 * degrada a la búsqueda local con un aviso claro.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Download,
  History,
  Inbox,
  Keyboard,
  LayoutList,
  LayoutTemplate,
  Moon,
  Monitor,
  Plus,
  Search,
  Settings,
  Sun,
  Upload,
  Zap,
} from 'lucide-react';

import { type ElementType, ROOT_BOARD_TITLE } from '@tablero/shared';

import { fetchUnsortedBoard } from '@/api/boards';
import { ApiError } from '@/api/client';
import { createNestedBoard } from '@/app/boardService';
import { focusElementInView } from '@/canvas/commands';
import type { BoardSession } from '@/collab/BoardSession';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useT } from '@/i18n';
import { readingOrder } from '@/lib/readingOrder';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useUiStore } from '@/state/uiStore';
import { useSettingsStore } from '@/settings/settingsStore';

import { type SearchGroup, reindexSearch, searchRemote } from './api';
import { highlightSegments, tokenizeQuery } from './highlight';
import { type LocalHit, searchCards } from './searchLocal';
import { ELEMENT_TYPE_LABELS, elementTypeLabel } from './typeLabels';

const DEBOUNCE_MS = 180;

const FILTERS: { value: 'all' | ElementType | 'board'; labelKey: string }[] = [
  { value: 'all', labelKey: 'palette.typeAll' },
  { value: 'note', labelKey: 'type.note' },
  { value: 'document', labelKey: 'type.document' },
  { value: 'todo', labelKey: 'type.todo' },
  { value: 'link', labelKey: 'type.link' },
  { value: 'image', labelKey: 'type.image' },
  { value: 'board', labelKey: 'type.board' },
  { value: 'table', labelKey: 'type.table' },
  { value: 'heading', labelKey: 'type.heading' },
];

export type PaletteActionEntry = {
  kind: 'action';
  id: string;
  label: string;
  icon: JSX.Element;
  run(): void;
};

export type PaletteEntry =
  | { kind: 'local'; hit: LocalHit }
  | { kind: 'remote'; group: SearchGroup; hit: SearchGroup['hits'][number] }
  | PaletteActionEntry;

export function CommandPalette({
  session,
  onOpenBoard,
}: {
  session: BoardSession;
  onOpenBoard(boardId: string): void;
}): JSX.Element | null {
  const open = usePanelsStore((state) => state.paletteOpen);
  const t = useT();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | ElementType | 'board'>('all');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const currentBoardId = useAppStore((state) => state.currentBoardId);
  const boards = useAppStore((state) => state.boards);

  const close = useCallback(() => {
    usePanelsStore.getState().setPaletteOpen(false);
    setQuery('');
    setGroups([]);
    setRemoteFailed(false);
    setActive(0);
  }, []);

  // Foco real al abrir (React no ve un `value` puesto por JavaScript, así que el
  // foco se pide al nodo, no al estado).
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  // Búsqueda remota con rebote y cancelación.
  useEffect(() => {
    if (!open) return undefined;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setGroups([]);
      setRemoteFailed(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void searchRemote({ q: trimmed, type: filter, boardId: null, limit: 40, signal: controller.signal })
        .then((next) => {
          if (controller.signal.aborted) return;
          setGroups(next);
          setRemoteFailed(false);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setGroups([]);
          // Sin endpoint (404) o sin servidor: se sigue con la búsqueda local.
          setRemoteFailed(error instanceof ApiError ? error.isNotFound || error.isOffline || true : true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, filter]);

  // Coincidencias en el tablero abierto (siempre locales, aunque el índice del
  // servidor no esté).
  const localHits = useMemo(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length === 0) return [] as LocalHit[];
    const cards = readingOrder(session.getAllElements())
      .filter((element) => filter === 'all' || element.type === filter)
      .map((element) => ({
        id: element.id,
        type: element.type,
        element: element,
        blocks: session.getTextBlocks(element.id),
      }));
    return searchCards(cards, trimmed, 12);
  }, [open, query, filter, session, groups]);

  const openResult = useCallback(
    (boardId: string, elementId: string, elementType: string) => {
      const panels = usePanelsStore.getState();
      const ui = useUiStore.getState();
      const isBoardItself = elementType === 'board' && elementId === boardId;
      if (isBoardItself) {
        close();
        if (boardId !== useAppStore.getState().currentBoardId) onOpenBoard(boardId);
        return;
      }
      close();
      if (boardId !== useAppStore.getState().currentBoardId) {
        onOpenBoard(boardId);
        ui.requestFocus(boardId, elementId);
        panels.flashElement(elementId);
        return;
      }
      focusElementInView(session, elementId);
      panels.flashElement(elementId);
      ui.setHomeOpen(false);
    },
    [close, onOpenBoard, session],
  );

  const actions = useMemo<PaletteActionEntry[]>(() => {
    const panels = usePanelsStore.getState();
    const settings = useSettingsStore.getState();
    const items: { id: string; key: string; icon: JSX.Element; run(): void }[] = [
      {
        id: 'new-board',
        key: 'palette.action.newBoard',
        icon: <Plus size={14} />,
        run: () => {
          const parent = useAppStore.getState().currentBoardId;
          void createNestedBoard(parent, t('app.untitledBoard'), null).then((board) => {
            if (useAppStore.getState().apiOnline) onOpenBoard(board.id);
          });
        },
      },
      {
        id: 'new-template',
        key: 'palette.action.newFromTemplate',
        icon: <LayoutTemplate size={14} />,
        run: () => panels.setTemplatesOpen(true),
      },
      {
        id: 'capture',
        key: 'palette.action.capture',
        icon: <Zap size={14} />,
        run: () => panels.setCaptureOpen(true),
      },
      {
        id: 'theme-light',
        key: 'palette.action.themeLight',
        icon: <Sun size={14} />,
        run: () => settings.setTheme('light'),
      },
      {
        id: 'theme-dark',
        key: 'palette.action.themeDark',
        icon: <Moon size={14} />,
        run: () => settings.setTheme('dark'),
      },
      {
        id: 'theme-system',
        key: 'palette.action.themeSystem',
        icon: <Monitor size={14} />,
        run: () => settings.setTheme('system'),
      },
      {
        id: 'settings',
        key: 'palette.action.settings',
        icon: <Settings size={14} />,
        run: () => panels.setSettingsOpen(true),
      },
      {
        id: 'shortcuts',
        key: 'palette.action.shortcuts',
        icon: <Keyboard size={14} />,
        run: () => useUiStore.getState().setHelpOpen(true),
      },
      {
        id: 'export',
        key: 'palette.action.export',
        icon: <Download size={14} />,
        run: () => panels.setExportOpen(true),
      },
      {
        id: 'import',
        key: 'palette.action.import',
        icon: <Upload size={14} />,
        run: () => panels.setImportOpen(true),
      },
      {
        id: 'history',
        key: 'palette.action.history',
        icon: <History size={14} />,
        run: () => panels.setHistoryOpen(true),
      },
      {
        id: 'list-view',
        key: 'palette.action.listView',
        icon: <LayoutList size={14} />,
        run: () => panels.setListViewOpen(true),
      },
      {
        id: 'unsorted',
        key: 'palette.action.unsorted',
        icon: <Inbox size={14} />,
        run: () => {
          void fetchUnsortedBoard()
            .then(({ board }) => {
              useAppStore.getState().upsertBoard(board);
              onOpenBoard(board.id);
            })
            .catch(() => useAppStore.getState().setNotice('No se pudo abrir «Sin ordenar».'));
        },
      },
    ];
    return items.map((item) => ({
      kind: 'action' as const,
      id: item.id,
      label: t(item.key),
      icon: item.icon,
      run: item.run,
    }));
  }, [t, onOpenBoard]);

  const flattened = useMemo<PaletteEntry[]>(() => {
    const entries: PaletteEntry[] = [];
    for (const hit of localHits) entries.push({ kind: 'local', hit });
    for (const group of groups) {
      for (const hit of group.hits) entries.push({ kind: 'remote', group, hit });
    }
    return entries;
  }, [localHits, groups]);

  const visibleActions = useMemo(() => {
    const terms = tokenizeQuery(query);
    if (terms.length === 0) return actions;
    // Todas las palabras de la consulta tienen que aparecer en la etiqueta
    // («tema oscuro» encuentra «Cambiar tema: oscuro»).
    return actions.filter((action) => {
      const label = action.label.toLowerCase();
      return terms.every((term) => label.includes(term));
    });
  }, [actions, query]);

  const total = flattened.length + visibleActions.length;

  useEffect(() => {
    setActive((current) => (current >= total ? 0 : current));
  }, [total]);

  const run = useCallback(
    (entry: PaletteEntry, index: number) => {
      setActive(index);
      if (entry.kind === 'action') {
        close();
        entry.run();
        return;
      }
      if (entry.kind === 'local') {
        const boardId = useAppStore.getState().currentBoardId;
        if (!boardId) return;
        openResult(boardId, entry.hit.elementId, entry.hit.elementType);
        return;
      }
      openResult(entry.hit.boardId, entry.hit.elementId, entry.hit.elementType);
    },
    [close, openResult],
  );

  if (!open) return null;

  const boardTitleOf = (boardId: string): string => {
    const board = boards.find((item) => item.id === boardId);
    return board?.title || (boardId === currentBoardId ? t('app.untitledBoard') : boardId);
  };

  const terms = tokenizeQuery(query);

  return (
    <div className="modal palette" role="dialog" aria-modal="true" aria-label={t('palette.aria')}>
      <div className="modal__panel palette__panel" ref={trapRef}>
        <div className="palette__search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={inputRef}
            className="palette__input"
            type="text"
            value={query}
            placeholder={t('palette.placeholder')}
            aria-label={t('common.search')}
            data-autofocus
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((current) => (current + 1) % Math.max(1, total));
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((current) => (current - 1 + Math.max(1, total)) % Math.max(1, total));
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                const entry = [...flattened, ...visibleActions][active];
                if (entry) run(entry, active);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              }
            }}
          />
          {loading ? <span className="palette__spinner" aria-hidden="true" /> : null}
          <button type="button" className="palette__close" onClick={close} aria-label={t('common.close')}>
            Esc
          </button>
        </div>

        <div className="palette__filters" role="group" aria-label={t('palette.filterByType')}>
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`palette__chip${filter === item.value ? ' is-active' : ''}`}
              aria-pressed={filter === item.value}
              data-filter={item.value}
              onClick={() => {
                setFilter(item.value);
                setActive(0);
              }}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>

        <div className="palette__body" role="listbox" aria-label={t('palette.results')}>
          {query.trim().length === 0 ? (
            <p className="palette__hint">{t('palette.hintNavigate')}</p>
          ) : null}

          {remoteFailed && query.trim().length > 0 ? (
            <div className="palette__warning">
              <span>{t('palette.offline')}</span>
              <button
                type="button"
                className="palette__reindex"
                disabled={reindexing}
                onClick={() => {
                  setReindexing(true);
                  void reindexSearch()
                    .then((count) => {
                      useAppStore.getState().setNotice(`${t('palette.reindexed')} (${count})`);
                      setRemoteFailed(false);
                    })
                    .catch(() => useAppStore.getState().setNotice(t('palette.offline')))
                    .finally(() => setReindexing(false));
                }}
              >
                {t('palette.reindex')}
              </button>
            </div>
          ) : null}

          {localHits.length > 0 ? (
            <div className="palette__group" role="group" aria-label={t('palette.inBoard')}>
              <p className="palette__group-title">{t('palette.inBoard')}</p>
              {localHits.map((hit, index) => {
                const entryIndex = index;
                return (
                  <button
                    key={`local-${hit.elementId}`}
                    type="button"
                    role="option"
                    aria-selected={active === entryIndex}
                    className={`palette__row${active === entryIndex ? ' is-active' : ''}`}
                    data-palette-local={hit.elementId}
                    onMouseEnter={() => setActive(entryIndex)}
                    onClick={() => run({ kind: 'local', hit }, entryIndex)}
                  >
                    <span className="palette__row-type">{elementTypeLabel(hit.elementType, t)}</span>
                    <span className="palette__row-text">
                      {highlightSegments(hit.snippet, hit.terms).map((segment, segmentIndex) =>
                        segment.match ? (
                          <mark key={segmentIndex}>{segment.text}</mark>
                        ) : (
                          <span key={segmentIndex}>{segment.text}</span>
                        ),
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {groups.map((group) => (
            <div key={group.boardId} className="palette__group" role="group" aria-label={group.boardTitle}>
              <p className="palette__group-title">
                <span className="palette__group-icon" aria-hidden="true">
                  📋
                </span>
                {group.boardTitle || boardTitleOf(group.boardId)}
              </p>
              {group.hits.map((hit) => {
                const entryIndex = flattened.findIndex(
                  (entry) => entry.kind === 'remote' && entry.hit.elementId === hit.elementId,
                );
                return (
                  <button
                    key={`${group.boardId}-${hit.elementId}`}
                    type="button"
                    role="option"
                    aria-selected={active === entryIndex}
                    className={`palette__row${active === entryIndex ? ' is-active' : ''}`}
                    data-palette-hit={hit.elementId}
                    onMouseEnter={() => setActive(entryIndex)}
                    onClick={() => run({ kind: 'remote', group, hit }, entryIndex)}
                  >
                    <span className="palette__row-type">
                      {elementTypeLabel(hit.elementType as ElementType, t)}
                    </span>
                    <span className="palette__row-text">
                      {highlightSegments(hit.snippet, terms).map((segment, segmentIndex) =>
                        segment.match ? (
                          <mark key={segmentIndex}>{segment.text}</mark>
                        ) : (
                          <span key={segmentIndex}>{segment.text}</span>
                        ),
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}

          {query.trim().length > 0 && !loading && flattened.length === 0 && visibleActions.length === 0 ? (
            <div className="palette__empty">
              <p>{t('palette.empty')}</p>
              <p className="palette__hint">{t('palette.emptyHint')}</p>
            </div>
          ) : null}

          {visibleActions.length > 0 ? (
            <div className="palette__group" role="group" aria-label={t('palette.actions')}>
              <p className="palette__group-title">{t('palette.actions')}</p>
              {visibleActions.map((action, index) => {
                const entryIndex = flattened.length + index;
                return (
                  <button
                    key={`action-${action.id}`}
                    type="button"
                    role="option"
                    aria-selected={active === entryIndex}
                    className={`palette__row palette__row--action${active === entryIndex ? ' is-active' : ''}`}
                    data-palette-action={action.id}
                    onMouseEnter={() => setActive(entryIndex)}
                    onClick={() => run(action, entryIndex)}
                  >
                    <span className="palette__row-icon" aria-hidden="true">
                      {action.icon}
                    </span>
                    <span className="palette__row-text">{action.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <span className="sr-only" role="status" data-palette-status>
          {loading ? t('palette.searching') : t('palette.resultCount', { count: String(total) })}
        </span>
        <footer className="palette__footer">
          <span>{t('palette.hintNavigate')}</span>
          <span className="palette__footer-hint">
            {t('palette.inBoard')} + {t('palette.everything')} · {ELEMENT_TYPE_LABELS.length} {t('palette.filterByType')}
          </span>
        </footer>
      </div>
    </div>
  );
}

export const PALETTE_ROOT_TITLE = ROOT_BOARD_TITLE;

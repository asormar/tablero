/**
 * Barra superior: migas de pan, título editable en línea, deshacer/rehacer,
 * zoom, estado de sincronización y accesos a la ayuda, al panel lateral y a las
 * superficies de la fase 4 (búsqueda, historial, exportar/importar, plantillas,
 * presentación, vista de lista, captura rápida y ajustes).
 */

import { useEffect, useState } from 'react';

import {
  Archive,
  Download,
  History,
  Home,
  LayoutGrid,
  List,
  ListChecks,
  Maximize2,
  MessageSquarePlus,
  PanelRight,
  Play,
  Redo2,
  Save,
  Search,
  Settings2,
  Undo2,
  Upload,
} from 'lucide-react';

import { renameBoard } from '@/app/boardService';
import { fitToScreen, redoWithPrune, undoWithPrune } from '@/canvas/commands';
import type { BoardSession } from '@/collab/BoardSession';
import { useCanRedo, useCanUndo } from '@/collab/SessionContext';
import { useT } from '@/i18n';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useUiStore } from '@/state/uiStore';

import { Breadcrumbs } from './Breadcrumbs';
import { SyncIndicator } from './SyncIndicator';
import { ZoomControlCompact } from './ZoomControl';

export type TopBarProps = {
  session: BoardSession;
  boardId: string;
  onOpenBoard(boardId: string): void;
};

export function TopBar({ session, boardId, onOpenBoard }: TopBarProps): JSX.Element {
  const board = useAppStore((state) => state.boards.find((item) => item.id === boardId) ?? null);
  const [title, setTitle] = useState(board?.title ?? '');
  const panelOpen = useUiStore((state) => state.panelOpen);
  const panelTab = useUiStore((state) => state.panelTab);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const t = useT();
  const paletteOpen = usePanelsStore((state) => state.paletteOpen);
  const captureOpen = usePanelsStore((state) => state.captureOpen);

  useEffect(() => {
    setTitle(board?.title ?? '');
  }, [board?.id, board?.title]);

  useEffect(() => {
    document.title = title.length > 0 ? `${title} · Tablero` : 'Tablero';
  }, [title]);

  const commitTitle = (): void => {
    const next = title.trim();
    if (next.length === 0) {
      setTitle(board?.title ?? '');
      return;
    }
    if (next === board?.title) return;
    void renameBoard(boardId, next);
  };

  return (
    <header className="topbar">
      <div className="topbar__left">
        <Breadcrumbs boardId={boardId} onOpenBoard={onOpenBoard} />
      </div>

      <div className="topbar__center">
        <input
          className="topbar__title"
          value={title}
          placeholder={t('app.untitledBoard')}
          aria-label={t('topbar.boardTitleAria')}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              setTitle(board?.title ?? '');
              event.currentTarget.blur();
            }
          }}
        />
      </div>

      <div className="topbar__right">
        <button
          type="button"
          className={`topbar__search${paletteOpen ? ' is-active' : ''}`}
          title={t('topbar.search')}
          data-topbar-search
          aria-keyshortcuts="Control+K"
          onClick={() => usePanelsStore.getState().setPaletteOpen(true)}
        >
          <Search size={14} aria-hidden="true" />
          <span className="topbar__search-text">{t('common.search')}</span>
          <kbd className="topbar__search-kbd">Ctrl K</kbd>
        </button>

        <div className="topbar__group" role="group" aria-label={t('topbar.historyGroup')}>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.undo')}
            disabled={!canUndo}
            onClick={() => undoWithPrune(session)}
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.redo')}
            disabled={!canRedo}
            onClick={() => redoWithPrune(session)}
          >
            <Redo2 size={15} />
          </button>
        </div>

        <button
          type="button"
          className="icon-button"
          title={t('topbar.fit')}
          onClick={() => fitToScreen(session)}
        >
          <Maximize2 size={15} />
        </button>

        <ZoomControlCompact session={session} />
        <SyncIndicator />

        <div className="topbar__group topbar__group--phase4" role="group" aria-label={t('topbar.menu')}>
          <button
            type="button"
            className={`icon-button${captureOpen ? ' is-active' : ''}`}
            title={t('toolbar.capture')}
            data-topbar-capture
            aria-pressed={captureOpen}
            onClick={() => usePanelsStore.getState().setCaptureOpen(true)}
          >
            <MessageSquarePlus size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.history')}
            data-topbar-history
            onClick={() => usePanelsStore.getState().setHistoryOpen(true)}
          >
            <History size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.export')}
            data-topbar-export
            onClick={() => usePanelsStore.getState().setExportOpen(true)}
          >
            <Download size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.import')}
            data-topbar-import
            onClick={() => usePanelsStore.getState().setImportOpen(true)}
          >
            <Upload size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('templates.title')}
            data-topbar-templates
            onClick={() => usePanelsStore.getState().setTemplatesOpen(true)}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.saveTemplate')}
            data-topbar-save-template
            onClick={() => usePanelsStore.getState().setSaveTemplateOpen(true)}
          >
            <Save size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.present')}
            data-topbar-present
            onClick={() => usePanelsStore.getState().setPresentationOpen(true)}
          >
            <Play size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.listView')}
            data-topbar-list
            onClick={() => usePanelsStore.getState().setListViewOpen(true)}
          >
            <List size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.settings')}
            data-topbar-settings
            onClick={() => usePanelsStore.getState().setSettingsOpen(true)}
          >
            <Settings2 size={15} />
          </button>
        </div>

        <button
          type="button"
          className={`icon-button${panelOpen && panelTab === 'unsorted' ? ' is-active' : ''}`}
          title={t('topbar.unsorted')}
          aria-pressed={panelOpen && panelTab === 'unsorted'}
          onClick={() => useUiStore.getState().openPanel('unsorted')}
        >
          <PanelRight size={15} />
        </button>

        <button
          type="button"
          className={`icon-button${panelOpen && panelTab === 'trash' ? ' is-active' : ''}`}
          title={t('topbar.trash')}
          aria-pressed={panelOpen && panelTab === 'trash'}
          onClick={() => useUiStore.getState().openPanel('trash')}
        >
          <Archive size={15} />
        </button>

        <button
          type="button"
          className="icon-button"
          title={t('topbar.boards')}
          onClick={() => useUiStore.getState().setHomeOpen(true)}
        >
          <Home size={15} />
        </button>

        <button
          type="button"
          className="icon-button"
          title={t('topbar.tasks')}
          onClick={() => useUiStore.getState().setTasksOpen(true)}
        >
          <ListChecks size={15} />
        </button>

        <button
          type="button"
          className="icon-button"
          title={t('topbar.shortcuts')}
          onClick={() => useUiStore.getState().setHelpOpen(true)}
        >
          ?
        </button>
      </div>
    </header>
  );
}

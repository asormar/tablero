/**
 * Barra superior: migas de pan, título editable en línea, deshacer/rehacer,
 * zoom, estado de sincronización y accesos a la ayuda, al panel lateral y a las
 * superficies de la fase 4 (búsqueda, historial, exportar/importar, plantillas,
 * presentación, vista de lista, captura rápida y ajustes).
 */

import { useEffect, useState } from 'react';

import {
  ActivitySquare,
  Archive,
  Download,
  Globe,
  History,
  Home,
  LayoutGrid,
  List,
  ListChecks,
  MessageSquarePlus,
  PanelRight,
  Play,
  Redo2,
  Save,
  Search,
  Settings2,
  Share2,
  Undo2,
  Upload,
} from 'lucide-react';

import { reportBoardActivityById } from '@/collab/activityBridge';
import { renameBoard } from '@/app/boardService';
import { redoWithPrune, undoWithPrune } from '@/canvas/commands';
import type { BoardSession } from '@/collab/BoardSession';
import { PresenceWatchers } from '@/collab/RemoteCursors';
import { ROLE_LABELS, capabilityRefusal } from '@/collab/roles';
import { useCanRedo, useCanUndo, useSessionPermission } from '@/collab/SessionContext';
import { useT } from '@/i18n';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useUiStore } from '@/state/uiStore';
import { useSettingsStore } from '@/settings/settingsStore';

import { Breadcrumbs } from './Breadcrumbs';
import { NotificationBell } from './NotificationsPanel';
import { SyncIndicator } from './SyncIndicator';
import { UserMenu } from './UserMenu';

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
  const shareOpen = usePanelsStore((state) => state.shareOpen);
  const publishOpen = usePanelsStore((state) => state.publishOpen);
  const activityOpen = usePanelsStore((state) => state.activityOpen);
  const permission = useSessionPermission();
  const theme = useSettingsStore((state) => state.resolvedTheme);
  /** Nombre accesible del botón de publicar (coincide con lo que se ve). */
  const publishHint =
    permission.role === 'owner' || permission.role === null
      ? 'Publicar el tablero'
      : 'Solo el dueño puede publicar';

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
    if (permission.readOnly) {
      // Renombrar es escribir: con rol de lectura vuelve al valor del servidor y
      // se explica por qué.
      setTitle(board?.title ?? '');
      useAppStore.getState().setNotice(capabilityRefusal(permission.role, 'edit') ?? 'El tablero está en solo lectura.');
      return;
    }
    void renameBoard(boardId, next).then(() => {
      reportBoardActivityById(boardId, { action: 'board.rename', meta: { title: next } });
    });
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
          readOnly={permission.readOnly}
          data-topbar-readonly={permission.readOnly ? 'yes' : 'no'}
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
          aria-label={t('topbar.search')}
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
            aria-label={t('topbar.undo')}
            disabled={!canUndo}
            onClick={() => undoWithPrune(session)}
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.redo')}
            aria-label={t('topbar.redo')}
            disabled={!canRedo}
            onClick={() => redoWithPrune(session)}
          >
            <Redo2 size={15} />
          </button>
        </div>

        {/*
         * El zoom y «encajar a pantalla» viven solo en el control flotante del
         * lienzo (`ZoomControl`, abajo a la derecha): acá había además una copia
         * compacta y un botón de encaje, tres formas de hacer lo mismo. Los
         * atajos siguen igual (`Ctrl` `+`/`-`, `Ctrl+0`, `Shift+1`).
         */}

        <PresenceWatchers boardId={boardId} dark={theme === 'dark'} />
        {permission.readOnly ? (
          <span
            className="topbar__role"
            data-topbar-role={permission.role ?? 'unknown'}
            title={capabilityRefusal(permission.role, 'edit') ?? 'Solo lectura'}
          >
            {permission.role ? ROLE_LABELS[permission.role] : 'Solo lectura'}
          </span>
        ) : null}
        <SyncIndicator />

        <div className="topbar__group topbar__group--phase4" role="group" aria-label={t('topbar.menu')}>
          <button
            type="button"
            className={`icon-button${captureOpen ? ' is-active' : ''}`}
            title={t('toolbar.capture')}
            aria-label={t('toolbar.capture')}
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
            aria-label={t('topbar.history')}
            data-topbar-history
            onClick={() => usePanelsStore.getState().setHistoryOpen(true)}
          >
            <History size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.export')}
            aria-label={t('topbar.export')}
            data-topbar-export
            onClick={() => usePanelsStore.getState().setExportOpen(true)}
          >
            <Download size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.import')}
            aria-label={t('topbar.import')}
            data-topbar-import
            onClick={() => usePanelsStore.getState().setImportOpen(true)}
          >
            <Upload size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('templates.title')}
            aria-label={t('templates.title')}
            data-topbar-templates
            onClick={() => usePanelsStore.getState().setTemplatesOpen(true)}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.saveTemplate')}
            aria-label={t('topbar.saveTemplate')}
            data-topbar-save-template
            onClick={() => usePanelsStore.getState().setSaveTemplateOpen(true)}
          >
            <Save size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.present')}
            aria-label={t('topbar.present')}
            data-topbar-present
            onClick={() => usePanelsStore.getState().setPresentationOpen(true)}
          >
            <Play size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.listView')}
            aria-label={t('topbar.listView')}
            data-topbar-list
            onClick={() => usePanelsStore.getState().setListViewOpen(true)}
          >
            <List size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.settings')}
            aria-label={t('topbar.settings')}
            data-topbar-settings
            onClick={() => usePanelsStore.getState().setSettingsOpen(true)}
          >
            <Settings2 size={15} />
          </button>
        </div>

        <button
          type="button"
          className={`icon-button${panelOpen && panelTab === 'comments' ? ' is-active' : ''}`}
          title="Comentarios del tablero"
          aria-label="Comentarios del tablero"
          data-topbar-comments
          aria-pressed={panelOpen && panelTab === 'comments'}
          onClick={() => useUiStore.getState().openPanel('comments')}
        >
          <MessageSquarePlus size={15} />
        </button>

        <div className="topbar__group topbar__group--phase5" role="group" aria-label="Colaboración">
          <button
            type="button"
            className={`icon-button${shareOpen ? ' is-active' : ''}`}
            title="Compartir el tablero"
            aria-label="Compartir el tablero"
            data-topbar-share
            aria-pressed={shareOpen}
            onClick={() => usePanelsStore.getState().setShareOpen(true)}
          >
            <Share2 size={15} />
          </button>
          <button
            type="button"
            className={`icon-button${publishOpen ? ' is-active' : ''}`}
            title={publishHint}
            aria-label={publishHint}
            data-topbar-publish
            data-publish-allowed={permission.role === 'owner' || permission.role === null ? 'yes' : 'no'}
            aria-pressed={publishOpen}
            disabled={permission.role !== null && permission.role !== 'owner'}
            onClick={() => usePanelsStore.getState().setPublishOpen(true)}
          >
            <Globe size={15} />
          </button>
          <button
            type="button"
            className={`icon-button${activityOpen ? ' is-active' : ''}`}
            title="Actividad del tablero"
            aria-label="Actividad del tablero"
            data-topbar-activity
            aria-pressed={activityOpen}
            onClick={() => usePanelsStore.getState().setActivityOpen(true)}
          >
            <ActivitySquare size={15} />
          </button>
          <NotificationBell />
        </div>

        <button
          type="button"
          className={`icon-button${panelOpen && panelTab === 'unsorted' ? ' is-active' : ''}`}
          title={t('topbar.unsorted')}
          aria-label={t('topbar.unsorted')}
          aria-pressed={panelOpen && panelTab === 'unsorted'}
          onClick={() => useUiStore.getState().openPanel('unsorted')}
        >
          <PanelRight size={15} />
        </button>

        <button
          type="button"
          className={`icon-button${panelOpen && panelTab === 'trash' ? ' is-active' : ''}`}
          title={t('topbar.trash')}
          aria-label={t('topbar.trash')}
          aria-pressed={panelOpen && panelTab === 'trash'}
          onClick={() => useUiStore.getState().openPanel('trash')}
        >
          <Archive size={15} />
        </button>

        <button
          type="button"
          className="icon-button"
          title={t('topbar.boards')}
          aria-label={t('topbar.boards')}
          onClick={() => useUiStore.getState().setHomeOpen(true)}
        >
          <Home size={15} />
        </button>

        <button
          type="button"
          className="icon-button"
          title={t('topbar.tasks')}
          aria-label={t('topbar.tasks')}
          onClick={() => useUiStore.getState().setTasksOpen(true)}
        >
          <ListChecks size={15} />
        </button>

        <button
          type="button"
          className="icon-button"
          title={t('topbar.shortcuts')}
          aria-label={t('topbar.shortcuts')}
          onClick={() => useUiStore.getState().setHelpOpen(true)}
        >
          ?
        </button>

        <UserMenu />
      </div>
    </header>
  );
}

/**
 * Barra superior: migas de pan, título editable en línea, deshacer/rehacer,
 * zoom, estado de sincronización y accesos a la ayuda, al panel lateral y a las
 * superficies de la fase 4 (búsqueda, historial, exportar/importar, plantillas,
 * presentación, vista de lista, captura rápida y ajustes).
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import {
  ActivitySquare,
  Archive,
  Bell,
  Download,
  Globe,
  History,
  Home,
  Keyboard,
  LayoutTemplate,
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
  Zap,
} from 'lucide-react';

import { reportBoardActivityById } from '@/collab/activityBridge';
import { renameBoard } from '@/app/boardService';
import { redoWithPrune, undoWithPrune } from '@/canvas/commands';
import type { BoardSession } from '@/collab/BoardSession';
import { PresenceWatchers } from '@/collab/RemoteCursors';
import { ROLE_LABELS, capabilityRefusal } from '@/collab/roles';
import { useCanRedo, useCanUndo, useSessionPermission } from '@/collab/SessionContext';
import { useT } from '@/i18n';
import { isMac, shortcutLabel } from '@/lib/platform';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useUiStore } from '@/state/uiStore';
import { useSettingsStore } from '@/settings/settingsStore';

import { Breadcrumbs } from './Breadcrumbs';
import { NotificationBell, useUnreadNotifications } from './NotificationsPanel';
import { SyncIndicator } from './SyncIndicator';
import { TopBarOverflow, type OverflowItem } from './TopBarOverflow';
import { UserMenu } from './UserMenu';
import { useMediaQuery } from './useMediaQuery';

/** Por debajo de este ancho la barra deja a la vista lo esencial y agrupa el resto en «Más». */
const COMPACT_QUERY = '(max-width: 1024px)';

/** Una acción de la barra: se pinta como botón de icono o como elemento del menú «Más». */
type TopAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect(): void;
  /** La superficie que abre ya está abierta (resalta el botón). */
  active?: boolean;
  /** Se expone como `aria-pressed` (interruptores de panel). */
  pressed?: boolean;
  disabled?: boolean;
  /** Atributos `data-*` (sin el prefijo) que usan las pruebas. */
  data?: Record<string, string | boolean>;
};

function ActionButton({ action }: { action: TopAction }): JSX.Element {
  const dataAttributes = Object.fromEntries(
    Object.entries(action.data ?? {}).map(([name, value]) => [`data-${name}`, value]),
  );
  return (
    <button
      type="button"
      className={`icon-button${action.active ? ' is-active' : ''}`}
      title={action.label}
      aria-label={action.label}
      aria-pressed={action.pressed}
      disabled={action.disabled}
      onClick={action.onSelect}
      {...dataAttributes}
    >
      {action.icon}
    </button>
  );
}

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
  const notificationsOpen = usePanelsStore((state) => state.notificationsOpen);
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
      toast.error(capabilityRefusal(permission.role, 'edit') ?? 'El tablero está en solo lectura.');
      return;
    }
    void renameBoard(boardId, next).then(() => {
      reportBoardActivityById(boardId, { action: 'board.rename', meta: { title: next } });
    });
  };

  const compact = useMediaQuery(COMPACT_QUERY);
  /** Con la campana a la vista ella ya cuenta las no leídas: solo se consulta en modo compacto. */
  const unreadNotifications = useUnreadNotifications(compact);
  const canPublish = permission.role === 'owner' || permission.role === null;
  const commentsActive = panelOpen && panelTab === 'comments';

  // Acciones de la barra: una sola definición que se pinta como botón de icono
  // (ventana ancha) o como elemento del menú «Más» (≤ 1024 px).
  const toolActions: TopAction[] = [
    {
      id: 'capture',
      label: t('toolbar.capture'),
      // Rayo: la captura rápida no es un comentario (ese es el globo).
      icon: <Zap size={15} />,
      active: captureOpen,
      pressed: captureOpen,
      data: { 'topbar-capture': true },
      onSelect: () => usePanelsStore.getState().setCaptureOpen(true),
    },
    {
      id: 'history',
      label: t('topbar.history'),
      icon: <History size={15} />,
      data: { 'topbar-history': true },
      onSelect: () => usePanelsStore.getState().setHistoryOpen(true),
    },
    {
      id: 'export',
      label: t('topbar.export'),
      icon: <Download size={15} />,
      data: { 'topbar-export': true },
      onSelect: () => usePanelsStore.getState().setExportOpen(true),
    },
    {
      id: 'import',
      label: t('topbar.import'),
      icon: <Upload size={15} />,
      data: { 'topbar-import': true },
      onSelect: () => usePanelsStore.getState().setImportOpen(true),
    },
    {
      id: 'templates',
      label: t('templates.title'),
      // Plantillas: el mismo icono que la galería (`TemplateGallery`).
      icon: <LayoutTemplate size={15} />,
      data: { 'topbar-templates': true },
      onSelect: () => usePanelsStore.getState().setTemplatesOpen(true),
    },
    {
      id: 'save-template',
      label: t('topbar.saveTemplate'),
      icon: <Save size={15} />,
      data: { 'topbar-save-template': true },
      onSelect: () => usePanelsStore.getState().setSaveTemplateOpen(true),
    },
    {
      id: 'present',
      label: t('topbar.present'),
      icon: <Play size={15} />,
      data: { 'topbar-present': true },
      onSelect: () => usePanelsStore.getState().setPresentationOpen(true),
    },
    {
      id: 'list',
      label: t('topbar.listView'),
      icon: <List size={15} />,
      data: { 'topbar-list': true },
      onSelect: () => usePanelsStore.getState().setListViewOpen(true),
    },
    {
      id: 'settings',
      label: t('topbar.settings'),
      icon: <Settings2 size={15} />,
      data: { 'topbar-settings': true },
      onSelect: () => usePanelsStore.getState().setSettingsOpen(true),
    },
  ];

  const comments: TopAction = {
    id: 'comments',
    label: 'Comentarios del tablero',
    icon: <MessageSquarePlus size={15} />,
    active: commentsActive,
    pressed: commentsActive,
    data: { 'topbar-comments': true },
    onSelect: () => useUiStore.getState().openPanel('comments'),
  };
  const share: TopAction = {
    id: 'share',
    label: 'Compartir el tablero',
    icon: <Share2 size={15} />,
    active: shareOpen,
    pressed: shareOpen,
    data: { 'topbar-share': true },
    onSelect: () => usePanelsStore.getState().setShareOpen(true),
  };
  const publish: TopAction = {
    id: 'publish',
    label: publishHint,
    icon: <Globe size={15} />,
    active: publishOpen,
    pressed: publishOpen,
    disabled: !canPublish,
    data: { 'topbar-publish': true, 'publish-allowed': canPublish ? 'yes' : 'no' },
    onSelect: () => usePanelsStore.getState().setPublishOpen(true),
  };
  const activity: TopAction = {
    id: 'activity',
    label: 'Actividad del tablero',
    icon: <ActivitySquare size={15} />,
    active: activityOpen,
    pressed: activityOpen,
    data: { 'topbar-activity': true },
    onSelect: () => usePanelsStore.getState().setActivityOpen(true),
  };

  const unsortedActive = panelOpen && panelTab === 'unsorted';
  const trashActive = panelOpen && panelTab === 'trash';
  const navActions: TopAction[] = [
    {
      id: 'unsorted',
      label: t('topbar.unsorted'),
      icon: <PanelRight size={15} />,
      active: unsortedActive,
      pressed: unsortedActive,
      onSelect: () => useUiStore.getState().openPanel('unsorted'),
    },
    {
      id: 'trash',
      label: t('topbar.trash'),
      icon: <Archive size={15} />,
      active: trashActive,
      pressed: trashActive,
      onSelect: () => useUiStore.getState().openPanel('trash'),
    },
    {
      id: 'boards',
      label: t('topbar.boards'),
      icon: <Home size={15} />,
      onSelect: () => useUiStore.getState().setHomeOpen(true),
    },
    {
      id: 'tasks',
      label: t('topbar.tasks'),
      icon: <ListChecks size={15} />,
      onSelect: () => useUiStore.getState().setTasksOpen(true),
    },
    {
      id: 'shortcuts',
      label: t('topbar.shortcuts'),
      icon: '?',
      onSelect: () => useUiStore.getState().setHelpOpen(true),
    },
  ];

  // Menú «Más»: todo lo que no queda a la vista (solo se mantiene fuera «Compartir»),
  // agrupado en herramientas, colaboración y navegación. La campana pasa a ser un
  // elemento con su contador de no leídas.
  const overflowItems: OverflowItem[] = [
    ...toolActions,
    { ...comments, separatorBefore: true },
    publish,
    activity,
    {
      id: 'notifications',
      label: 'Notificaciones',
      icon: <Bell size={15} />,
      active: notificationsOpen,
      badge: unreadNotifications,
      onSelect: () => {
        const panels = usePanelsStore.getState();
        panels.setNotificationsOpen(!panels.notificationsOpen);
      },
    },
    ...navActions.map((action, index) => ({
      ...action,
      // El «?» de la barra es texto; en el menú va un icono como los demás.
      icon: action.id === 'shortcuts' ? <Keyboard size={15} /> : action.icon,
      separatorBefore: index === 0,
    })),
  ];

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
          title={t('topbar.search', { shortcut: shortcutLabel('K') })}
          aria-label={t('topbar.search', { shortcut: shortcutLabel('K') })}
          data-topbar-search
          aria-keyshortcuts={isMac() ? 'Meta+K' : 'Control+K'}
          onClick={() => usePanelsStore.getState().setPaletteOpen(true)}
        >
          <Search size={14} aria-hidden="true" />
          <span className="topbar__search-text">{t('common.search')}</span>
          <kbd className="topbar__search-kbd">{shortcutLabel('K')}</kbd>
        </button>

        <div className="topbar__group" role="group" aria-label={t('topbar.historyGroup')}>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.undo', { shortcut: shortcutLabel('Z') })}
            aria-label={t('topbar.undo', { shortcut: shortcutLabel('Z') })}
            disabled={!canUndo}
            onClick={() => undoWithPrune(session)}
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('topbar.redo', { shortcut: shortcutLabel('Z', { shift: true }) })}
            aria-label={t('topbar.redo', { shortcut: shortcutLabel('Z', { shift: true }) })}
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

        {compact ? (
          <>
            <ActionButton action={share} />
            <TopBarOverflow items={overflowItems} badge={unreadNotifications} />
          </>
        ) : (
          <>
            <div className="topbar__group topbar__group--tools" role="group" aria-label={t('topbar.menu')}>
              {toolActions.map((action) => (
                <ActionButton key={action.id} action={action} />
              ))}
            </div>

            <ActionButton action={comments} />

            <div className="topbar__group topbar__group--collab" role="group" aria-label="Colaboración">
              <ActionButton action={share} />
              <ActionButton action={publish} />
              <ActionButton action={activity} />
              <NotificationBell />
            </div>

            {navActions.map((action) => (
              <ActionButton key={action.id} action={action} />
            ))}
          </>
        )}

        <UserMenu />
      </div>
    </header>
  );
}

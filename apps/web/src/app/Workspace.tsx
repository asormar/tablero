/**
 * Espacio de trabajo: arranque, sesión por tablero y composición de la interfaz.
 *
 * Un tablero = una `BoardSession` (Y.Doc + colaboración + deshacer). Al navegar a
 * otro tablero se destruye la sesión anterior y se crea otra con el nombre del
 * documento igual al id del tablero.
 */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';

import { X } from 'lucide-react';

import { fitToScreen, focusElementInView } from '@/canvas/commands';
import { Canvas } from '@/canvas/Canvas';
import { FlashEffect } from '@/canvas/FlashEffect';
import { BoardsHome } from '@/chrome/BoardsHome';
import { ConnectorBar } from '@/chrome/ConnectorBar';
import { ContextBar } from '@/chrome/ContextBar';
import { ContextMenu } from '@/chrome/ContextMenu';
import { DocumentPage } from '@/chrome/DocumentPage';
import { MoveToDialog } from '@/chrome/MoveToDialog';
import { PerfOverlay } from '@/chrome/PerfOverlay';
import { ShortcutsModal } from '@/chrome/ShortcutsModal';
import { SidePanel } from '@/chrome/SidePanel';
import { TasksPage } from '@/chrome/TasksPage';
import { Toolbar } from '@/chrome/Toolbar';
import { TopBar } from '@/chrome/TopBar';
import { ZoomControl } from '@/chrome/ZoomControl';
import { BoardSession } from '@/collab/BoardSession';
import { SessionProvider, useSessionLayout, useSessionStatus } from '@/collab/SessionContext';
import { RELOAD_NOTICE_KEY } from '@/history/reloadNotice';
import { usePaste } from '@/hooks/usePaste';
import { usePhase4Shortcuts } from '@/hooks/usePhase4Shortcuts';
import { useShareTarget } from '@/hooks/useShareTarget';
import { useShortcuts } from '@/hooks/useShortcuts';
import { purgeExpiredTrash } from '@/lib/trashActions';
import { useAppStore, boardById } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useUiStore } from '@/state/uiStore';

import { rememberBoardCount } from './boardCounts';
import { bootstrap, createNestedBoard, ensureBoardInRegistry, writeBoardIdToUrl } from './boardService';

// Los visores pesados (visor de imagen, recorte y grabadora) solo se descargan
// cuando se abren: el chunk de arranque del lienzo no los necesita.
const LazyImageViewer = lazy(async () => {
  const module = await import('@/chrome/ImageViewer');
  return { default: module.ImageViewer };
});
const LazyCropEditor = lazy(async () => {
  const module = await import('@/chrome/CropEditor');
  return { default: module.CropEditor };
});
const LazyRecorderPanel = lazy(async () => {
  const module = await import('@/chrome/RecorderPanel');
  return { default: module.RecorderPanel };
});

// Superficies de la fase 4 (productividad). Todas van con `React.lazy` y se
// montan solo cuando están abiertas, para que el chunk principal no crezca.
const LazyCommandPalette = lazy(async () => {
  const module = await import('@/search/CommandPalette');
  return { default: module.CommandPalette };
});
const LazyBoardSearchBar = lazy(async () => {
  const module = await import('@/search/BoardSearchBar');
  return { default: module.BoardSearchBar };
});
const LazyTemplateGallery = lazy(async () => {
  const module = await import('@/templates/TemplateGallery');
  return { default: module.TemplateGallery };
});
const LazySaveTemplateDialog = lazy(async () => {
  const module = await import('@/templates/SaveTemplateDialog');
  return { default: module.SaveTemplateDialog };
});
const LazyExportMenu = lazy(async () => {
  const module = await import('@/export/ExportMenu');
  return { default: module.ExportMenu };
});
const LazyImportDialog = lazy(async () => {
  const module = await import('@/export/ImportDialog');
  return { default: module.ImportDialog };
});
const LazyHistoryPanel = lazy(async () => {
  const module = await import('@/history/HistoryPanel');
  return { default: module.HistoryPanel };
});
const LazySettingsPanel = lazy(async () => {
  const module = await import('@/settings/SettingsPanel');
  return { default: module.SettingsPanel };
});
const LazyQuickCapture = lazy(async () => {
  const module = await import('@/capture/QuickCapture');
  return { default: module.QuickCapture };
});
const LazyPresentationMode = lazy(async () => {
  const module = await import('@/presentation/PresentationMode');
  return { default: module.PresentationMode };
});
const LazyListView = lazy(async () => {
  const module = await import('@/mobile/ListView');
  return { default: module.ListView };
});

export function Workspace(): JSX.Element {
  const boardId = useAppStore((state) => state.currentBoardId);
  const booting = useAppStore((state) => state.booting);
  const [session, setSession] = useState<BoardSession | null>(null);
  const [sessionBoardId, setSessionBoardId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bootstrap()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) useAppStore.getState().setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!boardId) return;
    useUiStore.getState().resetWorkspace();
    const next = new BoardSession({ boardId, connect: true });
    setSession(next);
    setSessionBoardId(boardId);
    void next.init();
    return () => {
      next.destroy();
    };
  }, [boardId]);

  const openBoard = useCallback((id: string) => {
    useAppStore.getState().setCurrentBoard(id);
    writeBoardIdToUrl(id);
    void ensureBoardInRegistry(id);
  }, []);

  if (!session || sessionBoardId !== boardId) {
    return (
      <div className="boot" role="status">
        <div className="boot__card">
          <span className="boot__spinner" aria-hidden="true" />
          <p className="boot__text">{booting ? 'Cargando tableros…' : 'Abriendo tablero…'}</p>
        </div>
      </div>
    );
  }

  return (
    <SessionProvider session={session}>
      <WorkspaceShell session={session} boardId={boardId ?? session.boardId} onOpenBoard={openBoard} />
    </SessionProvider>
  );
}

function WorkspaceShell({
  session,
  boardId,
  onOpenBoard,
}: {
  session: BoardSession;
  boardId: string;
  onOpenBoard(boardId: string): void;
}): JSX.Element {
  useShortcuts(session);
  usePaste(session);
  usePhase4Shortcuts();
  useShareTarget();

  const status = useSessionStatus();
  const setSyncState = useAppStore((state) => state.setSyncState);
  const notice = useAppStore((state) => state.notice);
  const setNotice = useAppStore((state) => state.setNotice);
  const viewerId = useUiStore((state) => state.viewerId);
  const cropTargetId = useUiStore((state) => state.cropTargetId);
  const recorderOpen = useUiStore((state) => state.recorderOpen);
  const paletteOpen = usePanelsStore((state) => state.paletteOpen);
  const boardSearchOpen = usePanelsStore((state) => state.boardSearchOpen);
  const templatesOpen = usePanelsStore((state) => state.templatesOpen);
  const saveTemplateOpen = usePanelsStore((state) => state.saveTemplateOpen);
  const exportOpen = usePanelsStore((state) => state.exportOpen);
  const importOpen = usePanelsStore((state) => state.importOpen);
  const historyOpen = usePanelsStore((state) => state.historyOpen);
  const settingsOpen = usePanelsStore((state) => state.settingsOpen);
  const captureOpen = usePanelsStore((state) => state.captureOpen);
  const presentationOpen = usePanelsStore((state) => state.presentationOpen);
  const listViewOpen = usePanelsStore((state) => state.listViewOpen);

  useEffect(() => {
    setSyncState(status.state);
  }, [status.state, setSyncState]);

  // Aviso que dejó el historial de versiones antes de recargar la página.
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(RELOAD_NOTICE_KEY);
      if (!pending) return;
      sessionStorage.removeItem(RELOAD_NOTICE_KEY);
      setNotice(pending);
    } catch {
      // sin sessionStorage no hay aviso pendiente
    }
  }, [setNotice]);

  const createBlankBoard = useCallback((): void => {
    const parent = useAppStore.getState().currentBoardId;
    void createNestedBoard(parent, 'Tablero sin título', null).then((board) => {
      usePanelsStore.getState().setTemplatesOpen(false);
      onOpenBoard(board.id);
    });
  }, [onOpenBoard]);

  return (
    <div className="workspace">
      <TopBar session={session} boardId={boardId} onOpenBoard={onOpenBoard} />
      <div className="workspace__main">
        <Toolbar session={session} onOpenBoard={onOpenBoard} />
        <div className="workspace__canvas">
          <Canvas session={session} onOpenBoard={onOpenBoard} />
          <FlashEffect />
          <ZoomControl session={session} />
          <ContextBar session={session} />
          <ConnectorBar session={session} />
          <PerfOverlay />
        </div>
        <SidePanel />
      </div>
      <ContextMenu session={session} />
      <ShortcutsModal />
      <DocumentPage session={session} />
      <MoveToDialog session={session} />
      <BoardsHome onOpenBoard={onOpenBoard} />
      <TasksPage onOpenBoard={onOpenBoard} />
      {viewerId ? (
        <Suspense fallback={null}>
          <LazyImageViewer session={session} />
        </Suspense>
      ) : null}
      {cropTargetId ? (
        <Suspense fallback={null}>
          <LazyCropEditor session={session} />
        </Suspense>
      ) : null}
      {recorderOpen ? (
        <Suspense fallback={null}>
          <LazyRecorderPanel session={session} />
        </Suspense>
      ) : null}

      {/* Fase 4 */}
      {paletteOpen ? (
        <Suspense fallback={null}>
          <LazyCommandPalette session={session} onOpenBoard={onOpenBoard} />
        </Suspense>
      ) : null}
      {boardSearchOpen ? (
        <Suspense fallback={null}>
          <LazyBoardSearchBar />
        </Suspense>
      ) : null}
      {templatesOpen ? (
        <Suspense fallback={null}>
          <LazyTemplateGallery onOpenBoard={onOpenBoard} onCreateBlank={createBlankBoard} />
        </Suspense>
      ) : null}
      {saveTemplateOpen ? (
        <Suspense fallback={null}>
          <LazySaveTemplateDialog />
        </Suspense>
      ) : null}
      {exportOpen ? (
        <Suspense fallback={null}>
          <LazyExportMenu session={session} />
        </Suspense>
      ) : null}
      {importOpen ? (
        <Suspense fallback={null}>
          <LazyImportDialog session={session} onOpenBoard={onOpenBoard} />
        </Suspense>
      ) : null}
      {historyOpen ? (
        <Suspense fallback={null}>
          <LazyHistoryPanel />
        </Suspense>
      ) : null}
      {settingsOpen ? (
        <Suspense fallback={null}>
          <LazySettingsPanel />
        </Suspense>
      ) : null}
      {captureOpen ? (
        <Suspense fallback={null}>
          <LazyQuickCapture />
        </Suspense>
      ) : null}
      {listViewOpen ? (
        <Suspense fallback={null}>
          <LazyListView />
        </Suspense>
      ) : null}
      {presentationOpen ? (
        <Suspense fallback={null}>
          <LazyPresentationMode onOpenBoard={onOpenBoard} />
        </Suspense>
      ) : null}

      <BoardEffects session={session} boardId={boardId} />
      {notice ? (
        <div className="notice" role="status">
          <span className="notice__text">{notice}</span>
          <button
            type="button"
            className="notice__close"
            title="Descartar aviso"
            onClick={() => setNotice(null)}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Efectos ligados al contenido del tablero: encaje inicial de la vista,
 * publicación del contador de elementos del tablero actual, purgado de la
 * papelera vencida y el salto pendiente a una tarjeta (vista de tareas).
 *
 * El encaje se hace una vez por sesión (no por id de tablero): cuando se navega,
 * el componente sobrevive y todavía ve la sesión anterior durante un render.
 */
function BoardEffects({ session, boardId }: { session: BoardSession; boardId: string }): null {
  const layout = useSessionLayout();
  const count = layout.length;
  const fittedFor = useRef<BoardSession | null>(null);
  const purgedFor = useRef<BoardSession | null>(null);
  const focusRequest = useUiStore((state) => state.focusRequest);

  useEffect(() => {
    if (fittedFor.current === session) return;
    if (count === 0) return;
    fittedFor.current = session;
    fitToScreen(session);
  }, [count, session]);

  useEffect(() => {
    const timer = setTimeout(() => {
      rememberBoardCount(boardId, count);
      const board = boardById(useAppStore.getState().boards, boardId);
      if (board && board.elementCount !== count) {
        useAppStore.getState().upsertBoard({ ...board, elementCount: count });
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [boardId, count]);

  // Papelera: lo que superó los 30 días se borra para siempre al abrir el
  // tablero. Se deja un margen para que el documento remoto termine de llegar.
  useEffect(() => {
    if (purgedFor.current === session) return undefined;
    purgedFor.current = session;
    const timer = setTimeout(() => {
      if (session.destroyed_) return;
      void purgeExpiredTrash(session).then((ids) => {
        if (ids.length === 0) return;
        useAppStore
          .getState()
          .setNotice(
            ids.length === 1
              ? 'Se borró 1 elemento que llevaba más de 30 días en la papelera.'
              : `Se borraron ${ids.length} elementos que llevaban más de 30 días en la papelera.`,
          );
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [session]);

  // Salto a una tarjeta pedido por la vista de tareas (u otra superficie): se
  // consume cuando el tablero ya tiene contenido.
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.boardId !== boardId) {
      // Petición de otro tablero: la navegación la descartó.
      useUiStore.getState().clearFocusRequest();
      return;
    }
    if (count === 0) return; // el documento todavía no llegó
    focusElementInView(session, focusRequest.elementId);
    // El destello se re-dispara acá: la tarjeta recién ahora está montada (una
    // búsqueda en otro tablero llega antes que el documento).
    usePanelsStore.getState().flashElement(focusRequest.elementId);
    useUiStore.getState().clearFocusRequest();
  }, [focusRequest, boardId, count, session]);

  useEffect(() => {
    if (!focusRequest) return undefined;
    // Red de seguridad: un salto a un elemento que ya no existe no puede quedar
    // pendiente para siempre.
    const timer = setTimeout(() => useUiStore.getState().clearFocusRequest(), 5000);
    return () => clearTimeout(timer);
  }, [focusRequest]);

  return null;
}

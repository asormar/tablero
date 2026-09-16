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
import { usePaste } from '@/hooks/usePaste';
import { useShortcuts } from '@/hooks/useShortcuts';
import { purgeExpiredTrash } from '@/lib/trashActions';
import { boardById, useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

import { rememberBoardCount } from './boardCounts';
import { bootstrap, ensureBoardInRegistry, writeBoardIdToUrl } from './boardService';

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

  const status = useSessionStatus();
  const setSyncState = useAppStore((state) => state.setSyncState);
  const notice = useAppStore((state) => state.notice);
  const setNotice = useAppStore((state) => state.setNotice);
  const viewerId = useUiStore((state) => state.viewerId);
  const cropTargetId = useUiStore((state) => state.cropTargetId);
  const recorderOpen = useUiStore((state) => state.recorderOpen);

  useEffect(() => {
    setSyncState(status.state);
  }, [status.state, setSyncState]);

  return (
    <div className="workspace">
      <TopBar session={session} boardId={boardId} onOpenBoard={onOpenBoard} />
      <div className="workspace__main">
        <Toolbar session={session} onOpenBoard={onOpenBoard} />
        <div className="workspace__canvas">
          <Canvas session={session} onOpenBoard={onOpenBoard} />
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

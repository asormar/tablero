/**
 * Espacio de trabajo: arranque, sesión por tablero y composición de la interfaz.
 *
 * Un tablero = una `BoardSession` (Y.Doc + colaboración + deshacer). Al navegar a
 * otro tablero se destruye la sesión anterior y se crea otra con el nombre del
 * documento igual al id del tablero.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { X } from 'lucide-react';

import { fitToScreen } from '@/canvas/commands';
import { Canvas } from '@/canvas/Canvas';
import { ConnectorBar } from '@/chrome/ConnectorBar';
import { ContextBar } from '@/chrome/ContextBar';
import { ContextMenu } from '@/chrome/ContextMenu';
import { CropEditor } from '@/chrome/CropEditor';
import { DocumentPage } from '@/chrome/DocumentPage';
import { ImageViewer } from '@/chrome/ImageViewer';
import { MoveToDialog } from '@/chrome/MoveToDialog';
import { PerfOverlay } from '@/chrome/PerfOverlay';
import { RecorderPanel } from '@/chrome/RecorderPanel';
import { ShortcutsModal } from '@/chrome/ShortcutsModal';
import { Toolbar } from '@/chrome/Toolbar';
import { TopBar } from '@/chrome/TopBar';
import { UnorderedPanel } from '@/chrome/UnorderedPanel';
import { ZoomControl } from '@/chrome/ZoomControl';
import { BoardSession } from '@/collab/BoardSession';
import { SessionProvider, useSessionLayout, useSessionStatus } from '@/collab/SessionContext';
import { usePaste } from '@/hooks/usePaste';
import { useShortcuts } from '@/hooks/useShortcuts';
import { boardById, useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

import { rememberBoardCount } from './boardCounts';
import { bootstrap, ensureBoardInRegistry, writeBoardIdToUrl } from './boardService';

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
        <UnorderedPanel />
      </div>
      <ContextMenu session={session} />
      <ShortcutsModal />
      <ImageViewer session={session} />
      <CropEditor session={session} />
      <RecorderPanel session={session} />
      <DocumentPage session={session} />
      <MoveToDialog session={session} />
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
 * Efectos ligados al contenido del tablero: encaje inicial de la vista y
 * publicación del contador de elementos del tablero actual.
 *
 * El encaje se hace una vez por sesión (no por id de tablero): cuando se navega,
 * el componente sobrevive y todavía ve la sesión anterior durante un render.
 */
function BoardEffects({ session, boardId }: { session: BoardSession; boardId: string }): null {
  const layout = useSessionLayout();
  const count = layout.length;
  const fittedFor = useRef<BoardSession | null>(null);

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

  return null;
}

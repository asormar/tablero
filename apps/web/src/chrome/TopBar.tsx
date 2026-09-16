/**
 * Barra superior: migas de pan, título editable en línea, deshacer/rehacer,
 * zoom, estado de sincronización y accesos a la ayuda y al panel lateral.
 */

import { useEffect, useState } from 'react';

import { Maximize2, PanelRight, Redo2, Undo2 } from 'lucide-react';

import { renameBoard } from '@/app/boardService';
import { fitToScreen, redoWithPrune, undoWithPrune } from '@/canvas/commands';
import type { BoardSession } from '@/collab/BoardSession';
import { useCanRedo, useCanUndo } from '@/collab/SessionContext';
import { useAppStore } from '@/state/appStore';
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
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

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
          placeholder="Tablero sin título"
          aria-label="Título del tablero"
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
        <div className="topbar__group" role="group" aria-label="Historial">
          <button
            type="button"
            className="icon-button"
            title="Deshacer (Ctrl+Z)"
            disabled={!canUndo}
            onClick={() => undoWithPrune(session)}
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Rehacer (Ctrl+Shift+Z)"
            disabled={!canRedo}
            onClick={() => redoWithPrune(session)}
          >
            <Redo2 size={15} />
          </button>
        </div>

        <button
          type="button"
          className="icon-button"
          title="Ajustar a pantalla (Shift+1)"
          onClick={() => fitToScreen(session)}
        >
          <Maximize2 size={15} />
        </button>

        <ZoomControlCompact session={session} />
        <SyncIndicator />

        <button
          type="button"
          className={`icon-button${panelOpen ? ' is-active' : ''}`}
          title="Panel Sin ordenar"
          aria-pressed={panelOpen}
          onClick={() => useUiStore.getState().togglePanel()}
        >
          <PanelRight size={15} />
        </button>

        <button
          type="button"
          className="icon-button"
          title="Atajos de teclado (?)"
          onClick={() => useUiStore.getState().setHelpOpen(true)}
        >
          ?
        </button>
      </div>
    </header>
  );
}

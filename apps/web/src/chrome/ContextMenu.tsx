/**
 * Menú contextual (clic derecho).
 *
 * Sobre una tarjeta: copiar/cortar/pegar, duplicar, bloquear posición, orden de
 * apilado, color y borrar. En vacío: pegar, crear nota, crear tablero,
 * seleccionar todo y ajustar a pantalla.
 */

import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Crosshair,
  FolderInput,
  LayoutGrid,
  Lock,
  LockOpen,
  Maximize2,
  MessageSquarePlus,
  Repeat,
  Scissors,
  StickyNote,
  Trash2,
} from 'lucide-react';

import { ROOT_BOARD_TITLE } from '@tablero/shared';

import { createNestedBoard } from '@/app/boardService';
import { worldFromClient } from '@/canvas/canvasRef';
import {
  copySelection,
  createBoardCardAt,
  createNoteAt,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  fitToScreen,
  pasteAt,
  selectAll,
  sendSelectionToBack,
  bringSelectionToFront,
  setSelectionColor,
  toggleSelectionLock,
} from '@/canvas/commands';
import type { BoardSession } from '@/collab/BoardSession';
import { can as canCapability, capabilityRefusal } from '@/collab/roles';
import { useSessionPermission } from '@/collab/SessionContext';
import { getInternalClipboard } from '@/lib/clipboard';
import { convertElement, convertTargets } from '@/lib/convert';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

import { ColorPicker } from './ColorPicker';
import { useOutsideClose } from './useOutsideClose';

export function ContextMenu({ session }: { session: BoardSession }): JSX.Element | null {
  const menu = useUiStore((state) => state.contextMenu);
  const close = (): void => useUiStore.getState().setContextMenu(null);
  const ref = useOutsideClose<HTMLDivElement>(menu !== null, close);
  const permission = useSessionPermission();
  const editable = canCapability(permission.role, 'edit');

  const targetId = menu?.targetId ?? null;
  const element = targetId ? session.getElement(targetId) : null;
  const currentBoardId = useAppStore((state) => state.currentBoardId);
  const hasClipboard = getInternalClipboard() !== null;

  if (!menu) return null;
  // Con rol de lectura el menú solo tendría acciones deshabilitadas: se explica
  // por qué (y se deja comentar si el rol lo permite).
  if (!editable) {
    const canComment = canCapability(permission.role, 'comment');
    return (
      <div
        ref={ref}
        className="ctxmenu ctxmenu--readonly"
        style={{ left: menu.x, top: menu.y }}
        data-context-menu="readonly"
        role="menu"
      >
        <p className="ctxmenu__note">
          {capabilityRefusal(permission.role, 'edit') ?? 'Este tablero está en solo lectura.'}
        </p>
        {canComment && targetId ? (
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            data-context-comment
            onClick={() => run(() => useUiStore.getState().openCommentThread(targetId))}
          >
            <MessageSquarePlus size={15} />
            <span>Comentar esta tarjeta</span>
          </button>
        ) : null}
      </div>
    );
  }

  const world = worldFromClient(menu.x, menu.y);
  const top = Math.min(menu.y, Math.max(8, window.innerHeight - 320));
  const left = Math.min(menu.x, Math.max(8, window.innerWidth - 240));

  const run = (action: () => void): void => {
    action();
    close();
  };

  return (
    <div
      ref={ref}
      className="menu"
      style={{ top, left }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {element ? (
        <>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            data-context-comment
            onClick={() => run(() => useUiStore.getState().openCommentThread(element.id))}
          >
            <MessageSquarePlus size={15} />
            <span>Comentar</span>
          </button>
          <span className="menu__sep" />
          <button type="button" className="menu__item" role="menuitem" onClick={() => run(() => copySelection(session))}>
            <Copy size={15} />
            <span>Copiar</span>
            <kbd>Ctrl+C</kbd>
          </button>
          <button type="button" className="menu__item" role="menuitem" onClick={() => run(() => cutSelection(session))}>
            <Scissors size={15} />
            <span>Cortar</span>
            <kbd>Ctrl+X</kbd>
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(() => void pasteAt(session, world))}
          >
            <ClipboardPaste size={15} />
            <span>Pegar aquí</span>
            <kbd>Ctrl+V</kbd>
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(() => duplicateSelection(session))}
          >
            <CopyPlus size={15} />
            <span>Duplicar</span>
            <kbd>Ctrl+D</kbd>
          </button>

          <span className="menu__sep" />

          {convertTargets(element.type).length > 0 ? (
            <>
              <div className="menu__label">Convertir en</div>
              {convertTargets(element.type).map((option) => (
                <button
                  key={option.type}
                  type="button"
                  className="menu__item"
                  role="menuitem"
                  onClick={() =>
                    run(() => {
                      const created = convertElement(session, element.id, option.type);
                      if (created) useUiStore.getState().select([created]);
                    })
                  }
                >
                  <Repeat size={15} />
                  <span>{option.label}</span>
                </button>
              ))}
              <span className="menu__sep" />
            </>
          ) : null}

          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(() => useUiStore.getState().setMoveToOpen(true))}
          >
            <FolderInput size={15} />
            <span>Mover a otro tablero…</span>
          </button>

          <span className="menu__sep" />

          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(() => toggleSelectionLock(session))}
          >
            {element.locked ? <LockOpen size={15} /> : <Lock size={15} />}
            <span>{element.locked ? 'Desbloquear posición' : 'Bloquear posición'}</span>
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(() => bringSelectionToFront(session))}
          >
            <ArrowUpToLine size={15} />
            <span>Traer al frente</span>
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(() => sendSelectionToBack(session))}
          >
            <ArrowDownToLine size={15} />
            <span>Enviar al fondo</span>
          </button>

          <span className="menu__sep" />

          <div className="menu__label">Color</div>
          <div className="menu__colors">
            <ColorPicker
              value={element.color}
              onPick={(token) => run(() => setSelectionColor(session, token))}
            />
          </div>

          <span className="menu__sep" />

          <button
            type="button"
            className="menu__item menu__item--danger"
            role="menuitem"
            onClick={() => run(() => deleteSelection(session))}
          >
            <Trash2 size={15} />
            <span>Eliminar</span>
            <kbd>Supr</kbd>
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            disabled={!hasClipboard}
            onClick={() => run(() => void pasteAt(session, world))}
          >
            <ClipboardPaste size={15} />
            <span>Pegar</span>
            <kbd>Ctrl+V</kbd>
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(() => createNoteAt(session, world))}
          >
            <StickyNote size={15} />
            <span>Nota nueva</span>
            <kbd>N</kbd>
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() =>
              run(() => {
                void createNestedBoard(currentBoardId, ROOT_BOARD_TITLE, null).then((board) => {
                  createBoardCardAt(session, world, board);
                });
              })
            }
          >
            <LayoutGrid size={15} />
            <span>Tablero nuevo</span>
            <kbd>B</kbd>
          </button>

          <span className="menu__sep" />

          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(() => selectAll(session))}
          >
            <Crosshair size={15} />
            <span>Seleccionar todo</span>
            <kbd>Ctrl+A</kbd>
          </button>
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => run(() => fitToScreen(session))}
          >
            <Maximize2 size={15} />
            <span>Ajustar a pantalla</span>
            <kbd>Shift+1</kbd>
          </button>
        </>
      )}
    </div>
  );
}

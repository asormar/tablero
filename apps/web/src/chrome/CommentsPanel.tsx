/**
 * Panel del tablero con todos los comentarios (punto 5 de la fase 5).
 *
 * Es la pestaña «Comentarios» del panel lateral: filtra por abiertos y
 * resueltos, muestra el hilo completo de cada uno (responder, resolver, borrar lo
 * propio) y lleva a la tarjeta o chincheta de la que cuelga.
 *
 * Los comentarios llegan del documento (tiempo real); el panel no consulta la
 * API para leerlos, así que funciona igual con el socket caído.
 */

import { useMemo, useState } from 'react';

import { MessageSquare, Pin } from 'lucide-react';

import type { BoardSession } from '@/collab/BoardSession';
import { type CommentThread, commentThreads } from '@/collab/comments';
import { useSessionComments, useSessionPermission } from '@/collab/SessionContext';
import { canvasRoot } from '@/canvas/canvasRef';
import { useUiStore } from '@/state/uiStore';

import { CommentThreadView } from './CommentThread';

export type CommentsPanelProps = { session: BoardSession; boardId: string };

export function CommentsPanelBody({ session, boardId }: CommentsPanelProps): JSX.Element {
  const comments = useSessionComments();
  const permission = useSessionPermission();
  const [filter, setFilter] = useState<'open' | 'resolved'>('open');
  const threads = useMemo(() => commentThreads(comments), [comments]);
  const open = threads.filter((thread) => !thread.resolved);
  const resolved = threads.filter((thread) => thread.resolved);
  const shown = filter === 'open' ? open : resolved;

  const focusThread = (thread: CommentThread): void => {
    const elementId = thread.root.elementId;
    if (elementId) {
      useUiStore.getState().requestFocus(boardId, elementId);
      useUiStore.getState().openCommentThread(elementId, thread.root.id);
      return;
    }
    // Chincheta libre: se centra el viewport en su punto de mundo.
    const node = canvasRoot();
    if (node && thread.root.x !== null && thread.root.y !== null) {
      const size = { width: node.clientWidth, height: node.clientHeight };
      useUiStore.getState().setViewport({
        x: thread.root.x - size.width / 2,
        y: thread.root.y - size.height / 2,
        scale: useUiStore.getState().viewport.scale,
      });
    }
    useUiStore.getState().setCommentPinDraft(
      thread.root.x !== null && thread.root.y !== null
        ? { x: thread.root.x, y: thread.root.y }
        : null,
    );
  };

  return (
    <div className="comments-panel" data-comments-panel>
      <div className="comments-panel__filters" role="tablist" aria-label="Filtrar comentarios">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'open'}
          className={`comments-panel__filter${filter === 'open' ? ' is-active' : ''}`}
          data-comments-filter="open"
          onClick={() => setFilter('open')}
        >
          Abiertos <span className="comments-panel__count">{open.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'resolved'}
          className={`comments-panel__filter${filter === 'resolved' ? ' is-active' : ''}`}
          data-comments-filter="resolved"
          onClick={() => setFilter('resolved')}
        >
          Resueltos <span className="comments-panel__count">{resolved.length}</span>
        </button>
      </div>

      {permission.readOnly && permission.role === 'viewer' ? (
        <p className="comments-panel__notice" data-comments-readonly>
          Estás como lector: puedes leer los comentarios, pero no escribir ni responder.
        </p>
      ) : null}

      {shown.length === 0 ? (
        <p className="comments-panel__empty">
          {filter === 'open'
            ? 'No hay comentarios abiertos en este tablero.'
            : 'Todavía no se resolvió ningún hilo.'}
        </p>
      ) : (
        <ul className="comments-panel__list">
          {shown.map((thread) => (
            <li key={thread.root.id} className="comments-panel__item" data-comment-thread-row={thread.root.id}>
              <button
                type="button"
                className="comments-panel__anchor"
                onClick={() => focusThread(thread)}
                title={thread.root.elementId ? 'Ir a la tarjeta' : 'Ir a la chincheta'}
              >
                {thread.root.elementId ? <MessageSquare size={12} /> : <Pin size={12} />}
                {thread.root.elementId ? 'En una tarjeta' : 'Chincheta en el lienzo'}
              </button>
              <CommentThreadView session={session} boardId={boardId} thread={thread} compact />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

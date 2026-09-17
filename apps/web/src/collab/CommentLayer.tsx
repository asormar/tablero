/**
 * Capa de comentarios del lienzo (punto 5 de la fase 5).
 *
 * - `CommentPinLayer`: las chinchetas libres (comentario sin tarjeta). Van en
 *   coordenadas de mundo, dentro del contenedor transformado, así que siguen al
 *   zoom y al paneo.
 * - `CardCommentBadge`: el icono con contador que se pinta sobre una tarjeta y
 *   abre su hilo.
 */

import { MessageSquare, Pin } from 'lucide-react';

import type { BoardSession } from '@/collab/BoardSession';
import { openCommentCount, pinnedThreads, threadsForElement } from '@/collab/comments';
import { useSessionComments, useSessionPermission } from '@/collab/SessionContext';
import { useUiStore } from '@/state/uiStore';

export function CommentPinLayer({ session }: { session: BoardSession }): JSX.Element | null {
  const comments = useSessionComments();
  const permission = useSessionPermission();
  const pins = pinnedThreads(comments);
  if (pins.length === 0) return null;

  return (
    <div className="comment-pins" data-comment-pins={pins.length}>
      {pins.map((thread) => {
        const { x, y } = thread.root;
        if (x === null || y === null) return null;
        const replies = thread.replies.length;
        return (
          <button
            key={thread.root.id}
            type="button"
            className={`comment-pin${thread.resolved ? ' is-resolved' : ''}`}
            style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}
            data-comment-pin={thread.root.id}
            title={`Comentario de ${thread.root.authorName}`}
            onClick={(event) => {
              event.stopPropagation();
              // La chincheta abre su globo en el punto de mundo donde está.
              useUiStore.getState().setCommentPinDraft({ x, y });
            }}
          >
            <Pin size={13} />
            <span className="comment-pin__count">{replies + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Icono con contador de comentarios abiertos de una tarjeta. */
export function CardCommentBadge({ elementId }: { elementId: string }): JSX.Element | null {
  const comments = useSessionComments();
  const threads = threadsForElement(comments, elementId);
  const open = openCommentCount(comments.filter((entry) => entry.elementId === elementId));
  const total = threads.length;
  if (total === 0) return null;

  return (
    <button
      type="button"
      className={`card-comments${open > 0 ? ' has-open' : ''}`}
      data-card-comments={elementId}
      title={open > 0 ? `${open} comentario(s) abiertos` : 'Comentarios resueltos'}
      onClick={(event) => {
        event.stopPropagation();
        useUiStore.getState().openCommentThread(elementId, threads[0]?.root.id ?? null);
      }}
    >
      <MessageSquare size={11} />
      {open > 0 ? <span className="card-comments__count">{open}</span> : null}
    </button>
  );
}

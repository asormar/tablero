/**
 * Comentarios: hilo anclado a la tarjeta, chincheta libre y panel del tablero
 * (punto 5 de la fase 5).
 *
 * - `CommentPopover`: el globo que se abre desde el icono con contador de una
 *   tarjeta o desde una chincheta del lienzo. Muestra el hilo (raíz +
 *   respuestas), permite responder, resolver y borrar el propio.
 * - `CommentComposer`: el cuadro de escritura con autocompletado de miembros al
 *   escribir `@`.
 *
 * Los comentarios viven en el documento Yjs (`collab/comments.ts`), así que el
 * tiempo real llega por el mismo canal que el resto del contenido. Lo que se
 * escribe acá se **reporta** al registro de actividad; las notificaciones de
 * menciones las crea el servidor al extraer el documento.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Check, CornerDownRight, MessageSquare, Trash2, X } from 'lucide-react';

import { reportActivity } from '@/api/activity';
import { mirrorCommentDelete, mirrorCommentResolve } from '@/api/comments';
import type { BoardSession } from '@/collab/BoardSession';
import { mentionCandidates, useBoardMembers } from '@/collab/boardMembers';
import {
  type CommentEntry,
  type CommentThread,
  commentSegments,
  insertMention,
  mentionQuery as detectMentionQuery,
  relativeTime,
  resolveMentions,
  threadsForElement,
} from '@/collab/comments';
import { capabilityRefusal } from '@/collab/roles';
import { useSessionPermission } from '@/collab/SessionContext';
import { useOutsideClose } from '@/chrome/useOutsideClose';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

export type CommentComposerProps = {
  session: BoardSession;
  boardId: string;
  /** Tarjeta anclada o `null` (chincheta libre). */
  elementId: string | null;
  x?: number | null;
  y?: number | null;
  parentId?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  onSent?: () => void;
  onCancel?: () => void;
};

export function CommentComposer({
  session,
  boardId,
  elementId,
  x = null,
  y = null,
  parentId = null,
  placeholder = 'Escribe un comentario… usa @ para mencionar',
  autoFocus = false,
  onSent,
  onCancel,
}: CommentComposerProps): JSX.Element {
  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const permission = useSessionPermission();
  const { members } = useBoardMembers(boardId, { ownerId: null, enabled: !!boardId });
  const me = useAppStore((state) => state.user);
  const refusal = capabilityRefusal(permission.role, 'comment');

  // Sin lista de miembros (endpoint todavía ausente) el autocompletado ofrece
  // al usuario actual: se puede escribir igual, solo que sin sugerencias ajenas.
  const candidates = useMemo(() => {
    const list = mentionCandidates(members);
    if (list.length > 0) return list;
    return me.id ? [{ userId: me.id, name: me.name, email: me.email }] : [];
  }, [members, me.id, me.name, me.email]);

  const query = detectMentionQuery(value, caret);
  const suggestions = useMemo(() => {
    if (!query) return [];
    const needle = query.query.trim().toLowerCase();
    const list = candidates.filter((candidate) => {
      if (needle.length === 0) return true;
      return (
        candidate.name.toLowerCase().includes(needle) ||
        candidate.email.toLowerCase().includes(needle)
      );
    });
    return list.slice(0, 6);
  }, [candidates, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query?.query]);

  useEffect(() => {
    if (autoFocus) areaRef.current?.focus();
  }, [autoFocus]);

  const applySuggestion = (name: string): void => {
    if (!query) return;
    const next = insertMention(value, query, name);
    setValue(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(next.caret, next.caret);
    });
  };

  const send = (): void => {
    const body = value.trim();
    if (body.length === 0 || refusal) return;
    const mentions = resolveMentions(body, candidates);
    const id = session.addComment({
      body,
      elementId,
      x,
      y,
      parentId,
      mentions: mentions.map((mention) => mention.userId),
    });
    if (!id) return;
    reportActivity(boardId, {
      action: 'comment.create',
      elementId,
      meta: { commentId: id, mentions: mentions.map((mention) => mention.userId) },
    });
    setValue('');
    setCaret(0);
    onSent?.();
  };

  return (
    <div className="comment-composer" data-comment-composer={elementId ?? 'pin'}>
      <textarea
        ref={areaRef}
        className="comment-composer__input"
        value={value}
        placeholder={placeholder}
        rows={2}
        aria-label="Escribir un comentario"
        disabled={!!refusal}
        onChange={(event) => {
          setValue(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? value.length)}
        onKeyDown={(event) => {
          if (suggestions.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlight((current) => (current + 1) % suggestions.length);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlight((current) => (current - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              applySuggestion(suggestions[highlight]!.name);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setCaret(-1);
              return;
            }
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
          if (event.key === 'Escape' && onCancel) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {suggestions.length > 0 ? (
        <ul className="comment-mentions" role="listbox" aria-label="Miembros del tablero">
          {suggestions.map((candidate, index) => (
            <li key={candidate.userId}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                className={`comment-mentions__item${index === highlight ? ' is-active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySuggestion(candidate.name);
                }}
              >
                <span className="comment-mentions__name">{candidate.name}</span>
                {candidate.email ? <span className="comment-mentions__email">{candidate.email}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="comment-composer__actions">
        {refusal ? (
          <span className="comment-composer__refusal" data-comment-refusal>
            {refusal}
          </span>
        ) : (
          <span className="comment-composer__hint">Ctrl+Intro envía</span>
        )}
        <button
          type="button"
          className="comment-composer__send"
          disabled={value.trim().length === 0 || !!refusal}
          onClick={send}
        >
          Comentar
        </button>
      </div>
    </div>
  );
}

export type CommentThreadViewProps = {
  session: BoardSession;
  boardId: string;
  thread: CommentThread;
  onClose?: () => void;
  compact?: boolean;
};

/** Un hilo: raíz, respuestas, responder, resolver y borrar lo propio. */
export function CommentThreadView({
  session,
  boardId,
  thread,
  onClose,
  compact = false,
}: CommentThreadViewProps): JSX.Element {
  const [replying, setReplying] = useState(false);
  const me = useAppStore((state) => state.user);
  const permission = useSessionPermission();

  const resolve = (resolved: boolean): void => {
    session.setCommentResolved(thread.root.id, resolved);
    void mirrorCommentResolve(thread.root.id, resolved);
    reportActivity(boardId, {
      action: 'comment.resolve',
      elementId: thread.root.elementId,
      meta: { commentId: thread.root.id, resolved },
    });
  };

  const remove = (entry: CommentEntry): void => {
    session.removeComment(entry.id);
    void mirrorCommentDelete(entry.id);
    reportActivity(boardId, {
      action: 'comment.delete',
      elementId: entry.elementId,
      meta: { commentId: entry.id },
    });
  };

  return (
    <div className={`comment-thread${compact ? ' comment-thread--compact' : ''}`} data-comment-thread={thread.root.id}>
      <CommentRow
        entry={thread.root}
        meId={me.id}
        onDelete={() => remove(thread.root)}
        onResolve={() => resolve(!thread.resolved)}
        resolved={thread.resolved}
      />
      {thread.replies.length > 0 ? (
        <ul className="comment-thread__replies">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              <CommentRow
                entry={reply}
                meId={me.id}
                reply
                onDelete={() => remove(reply)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {replying ? (
        <CommentComposer
          session={session}
          boardId={boardId}
          elementId={thread.root.elementId}
          parentId={thread.root.id}
          placeholder="Escribe una respuesta…"
          autoFocus
          onSent={() => setReplying(false)}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <div className="comment-thread__actions">
          <button type="button" className="comment-thread__reply" onClick={() => setReplying(true)}>
            <CornerDownRight size={12} /> Responder
          </button>
          {thread.resolved ? (
            <button type="button" className="comment-thread__resolve" onClick={() => resolve(false)}>
              Reabrir
            </button>
          ) : (
            <button
              type="button"
              className="comment-thread__resolve"
              onClick={() => resolve(true)}
              disabled={!session.can('comment')}
            >
              <Check size={12} /> Resolver
            </button>
          )}
          {permission.role === null ? null : (
            <span className="comment-thread__role" data-comment-role={permission.role}>
              {session.can('comment') ? '' : 'Tu rol no permite comentar'}
            </span>
          )}
          {onClose ? (
            <button type="button" className="comment-thread__close" title="Cerrar" onClick={onClose}>
              <X size={12} />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CommentRow({
  entry,
  meId,
  reply = false,
  onDelete,
  onResolve,
  resolved = false,
}: {
  entry: CommentEntry;
  meId: string;
  reply?: boolean;
  onDelete?: () => void;
  onResolve?: () => void;
  resolved?: boolean;
}): JSX.Element {
  const mine = entry.authorId === meId;
  return (
    <article className={`comment-row${reply ? ' comment-row--reply' : ''}`} data-comment-id={entry.id}>
      <header className="comment-row__head">
        <span className="comment-row__author">{entry.authorName}</span>
        <span className="comment-row__time">{relativeTime(entry.createdAt)}</span>
        {resolved ? <span className="comment-row__resolved">resuelto</span> : null}
      </header>
      <p className="comment-row__body">
        {commentSegments(entry.body).map((segment, index) =>
          segment.mention ? (
            <mark key={index} className="comment-row__mention">
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </p>
      <footer className="comment-row__foot">
        {mine ? (
          <button type="button" className="comment-row__delete" title="Borrar mi comentario" onClick={onDelete}>
            <Trash2 size={11} /> Borrar
          </button>
        ) : null}
        {onResolve ? (
          <button type="button" className="comment-row__toggle" onClick={onResolve}>
            {resolved ? 'Reabrir hilo' : 'Resolver hilo'}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

/**
 * Globo de comentarios: lo abre el icono con contador de una tarjeta o una
 * chincheta del lienzo. Se posiciona sobre el nodo de la tarjeta (o el punto de
 * la chincheta) y se cierra al hacer clic fuera.
 */
export function CommentPopover({ session, boardId }: { session: BoardSession; boardId: string }): JSX.Element | null {
  const targetId = useUiStore((state) => state.commentTargetId);
  const threadId = useUiStore((state) => state.commentThreadId);
  const pinDraft = useUiStore((state) => state.commentPinDraft);
  const viewport = useUiStore((state) => state.viewport);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const close = useCallback((): void => {
    useUiStore.getState().closeCommentThread();
    useUiStore.getState().setCommentPinDraft(null);
  }, []);
  const ref = useOutsideClose<HTMLDivElement>(targetId !== null || pinDraft !== null, close);

  useEffect(() => {
    if (!targetId) return undefined;
    const measure = (): void => {
      const node = document.querySelector(`[data-element-id="${CSS.escape(targetId)}"]`);
      if (!node) {
        setPosition(null);
        return;
      }
      const rect = node.getBoundingClientRect();
      setPosition({ left: rect.right - 8, top: rect.top + 12 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [targetId]);

  const pinPosition = useMemo(() => {
    if (!pinDraft) return null;
    return {
      left: (pinDraft.x - viewport.x) * viewport.scale + 24,
      top: (pinDraft.y - viewport.y) * viewport.scale + 24,
    };
  }, [pinDraft, viewport]);

  if (!targetId && !pinDraft) return null;

  const anchor = pinPosition ?? position ?? { left: 24, top: 96 };
  const threads = targetId ? threadsForElement(session.getComments(), targetId) : [];
  const openThreads = threadId ? threads.filter((thread) => thread.root.id === threadId) : threads;

  return (
    <div
      ref={ref}
      className="comment-popover"
      style={{ left: `${Math.min(anchor.left, window.innerWidth - 360)}px`, top: `${Math.min(anchor.top, window.innerHeight - 280)}px` }}
      data-comment-popover={targetId ?? 'pin'}
      role="dialog"
      aria-label="Comentarios"
    >
      <header className="comment-popover__head">
        <MessageSquare size={13} />
        <span>Comentarios</span>
        <button type="button" className="comment-popover__close" title="Cerrar" onClick={close}>
          <X size={13} />
        </button>
      </header>
      <div className="comment-popover__body">
        {openThreads.map((thread) => (
          <CommentThreadView key={thread.root.id} session={session} boardId={boardId} thread={thread} />
        ))}
        {!pinDraft && openThreads.length === 0 ? (
          <p className="comment-popover__empty">Todavía no hay comentarios en esta tarjeta.</p>
        ) : null}
        <CommentComposer
          session={session}
          boardId={boardId}
          elementId={targetId}
          x={pinDraft?.x ?? null}
          y={pinDraft?.y ?? null}
          autoFocus={!!pinDraft}
          onSent={() => {
            if (pinDraft) useUiStore.getState().setCommentPinDraft(null);
          }}
        />
      </div>
    </div>
  );
}

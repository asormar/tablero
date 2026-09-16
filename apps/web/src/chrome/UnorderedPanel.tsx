/**
 * Panel «Sin ordenar» (§4.3): bandeja lateral con los elementos del tablero de
 * entrada del usuario.
 *
 * El contenido vive en un tablero de verdad (`GET /api/boards/unsorted`), así que
 * la bandeja abre una sesión propia del documento (con colaboración) mientras
 * está visible y la destruye al cerrarse. Arrastrar un elemento y soltarlo sobre
 * el lienzo lo **trae** al tablero actual: se copia con `pullElements` (que
 * espera la confirmación del servidor del destino) y recién entonces se quita de
 * la bandeja.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { Inbox, Loader2, RefreshCw } from 'lucide-react';

import { type BoardSummary, type ElementType, type Point, elementLabel } from '@tablero/shared';

import { fetchUnsortedBoard } from '@/api/boards';
import { worldFromClient } from '@/canvas/canvasRef';
import { BoardSession } from '@/collab/BoardSession';
import { useExternalSessionLayout, useSession } from '@/collab/SessionContext';
import { pullElements, transferFailureMessage } from '@/lib/boardTransfer';
import { blocksToPlainText } from '@/lib/textBlocks';
import { useAppStore } from '@/state/appStore';

type DragState = { id: string; label: string; x: number; y: number } | null;

type UnsortedItem = { id: string; type: ElementType; title: string; meta: string };

/** Texto representativo de un elemento de la bandeja. */
function labelFor(session: BoardSession, id: string, type: ElementType): { title: string; meta: string } {
  const meta = elementLabel(type);
  const element = session.getElement(id);
  if (!element) return { title: meta, meta: '' };

  if (element.type === 'board') {
    const board = useAppStore.getState().boards.find((item) => item.id === element.boardId);
    return { title: board?.title ?? 'Tablero', meta };
  }
  if (element.type === 'link') return { title: element.url, meta };
  const line = blocksToPlainText(session.getTextBlocks(id)).split('\n').find((text) => text.trim().length > 0);
  return { title: line?.trim() ?? meta, meta: line ? meta : '' };
}

export function UnorderedPanelBody(): JSX.Element {
  const currentSession = useSession();
  const [board, setBoard] = useState<BoardSummary | null>(null);
  const [session, setSession] = useState<BoardSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [drag, setDrag] = useState<DragState>(null);
  const dragRef = useRef<{ id: string; label: string; startX: number; startY: number; moved: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: BoardSession | null = null;
    setError(null);
    setBoard(null);
    void (async () => {
      try {
        const result = await fetchUnsortedBoard();
        if (cancelled) return;
        created = new BoardSession({ boardId: result.board.id, connect: true });
        setBoard(result.board);
        setSession(created);
        await created.init();
      } catch {
        if (!cancelled) setError('No se pudo abrir la bandeja «Sin ordenar».');
      }
    })();
    return () => {
      cancelled = true;
      created?.destroy();
      setSession(null);
      setBoard(null);
    };
  }, [reloadKey]);

  const layout = useExternalSessionLayout(session);
  const items = useMemo<UnsortedItem[]>(() => {
    if (!session) return [];
    return layout.map((item) => {
      const label = labelFor(session, item.id, item.type);
      return { id: item.id, type: item.type, title: label.title, meta: label.meta };
    });
  }, [layout, session]);

  /** Trae un elemento de la bandeja al tablero actual, en el punto pedido. */
  const bringIntoBoard = (elementId: string, world: Point): void => {
    if (!session || busy) return;
    setBusy(true);
    void pullElements(session, [elementId], currentSession, { world })
      .then((result) => {
        const store = useAppStore.getState();
        if (result.failure) {
          store.setNotice(transferFailureMessage(result.failure));
          return;
        }
        store.setNotice('Se movió 1 tarjeta al tablero actual.');
      })
      .catch(() => useAppStore.getState().setNotice('No se pudo mover la tarjeta de la bandeja.'))
      .finally(() => setBusy(false));
  };

  const startDrag = (event: React.PointerEvent<HTMLLIElement>, item: UnsortedItem): void => {
    if (event.button !== 0 || busy) return;
    event.preventDefault();
    dragRef.current = {
      id: item.id,
      label: item.title,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };

    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.classList.remove('is-dragging');
    };
    const onMove = (move: PointerEvent): void => {
      const current = dragRef.current;
      if (!current) return;
      if (!current.moved) {
        const distance = Math.hypot(move.clientX - current.startX, move.clientY - current.startY);
        if (distance < 5) return;
        current.moved = true;
      }
      setDrag({ id: current.id, label: current.label, x: move.clientX, y: move.clientY });
    };
    const onUp = (up: PointerEvent): void => {
      const current = dragRef.current;
      dragRef.current = null;
      cleanup();
      setDrag(null);
      if (!current?.moved) return;
      // Solo cuenta si se soltó sobre el lienzo (el panel lateral no es destino).
      const overCanvas = document
        .elementsFromPoint(up.clientX, up.clientY)
        .some((node) => node instanceof Element && node.closest('.canvas'));
      if (!overCanvas) return;
      bringIntoBoard(current.id, worldFromClient(up.clientX, up.clientY));
    };
    const onCancel = (): void => {
      dragRef.current = null;
      cleanup();
      setDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    document.body.classList.add('is-dragging');
  };

  return (
    <div className="unsorted">
      <div className="unsorted__tools">
        <span className="unsorted__count" title="Elementos en la bandeja">
          {items.length}
        </span>
        <span className="unsorted__hint">Arrastrá una tarjeta al lienzo para traerla a este tablero.</span>
        <button
          type="button"
          className="icon-button icon-button--small"
          title="Recargar la bandeja"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {error ? <p className="panel__empty-text">{error}</p> : null}
      {!error && !board ? (
        <p className="panel__empty-text">
          <Loader2 size={13} className="spin" /> Abriendo la bandeja…
        </p>
      ) : null}
      {board && items.length === 0 ? (
        <div className="panel__empty">
          <span className="panel__empty-icon" aria-hidden="true">
            <Inbox size={26} />
          </span>
          <p className="panel__empty-title">Nada sin ordenar</p>
          <p className="panel__empty-text">
            Las tarjetas que mandes a «Sin ordenar» aparecen acá, listas para arrastrarlas a cualquier tablero.
          </p>
        </div>
      ) : null}

      <ul className="unsorted__list">
        {items.map((item) => (
          <li
            key={item.id}
            className="unsorted__item"
            data-unsorted-id={item.id}
            title={`${item.meta}: ${item.title}`}
            onPointerDown={(event) => startDrag(event, item)}
          >
            <span className="unsorted__item-type">{item.meta}</span>
            <span className="unsorted__item-title">{item.title}</span>
          </li>
        ))}
      </ul>

      {drag ? (
        <div className="unsorted__ghost" style={{ left: drag.x + 12, top: drag.y + 12 }} aria-hidden="true">
          {drag.label}
        </div>
      ) : null}
    </div>
  );
}

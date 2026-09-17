/**
 * Modo presentación (punto 9 de la fase 4): recorrer el tablero o los tableros
 * del proyecto a pantalla completa, sin barras.
 *
 * La capa ocupa todo el viewport y oculta la interfaz (hoja `phase4.css`), pide
 * pantalla completa al navegador (si está permitido) y mueve la cámara a cada
 * diapositiva. Se navega con ←/→ o PageUp/PageDown, «F» alterna pantalla
 * completa, «Z»/«B» cambia entre recorrido por zonas y por tableros, y Esc sale.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChevronLeft, ChevronRight, Expand, Shrink, X } from 'lucide-react';

import { type Rect } from '@tablero/shared';

import { fitRect } from '@tablero/shared';

import { useSession, useSessionElements } from '@/collab/SessionContext';
import { useT } from '@/i18n';
import { readingOrder } from '@/lib/readingOrder';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { useUiStore } from '@/state/uiStore';

import {
  type PresentationMode,
  type Slide,
  boardDeck,
  slideBounds,
  slideKey,
  stepIndex,
  zoneDeck,
} from './slides';

export function PresentationMode({
  onOpenBoard,
}: {
  onOpenBoard(boardId: string): void;
}): JSX.Element | null {
  const open = usePanelsStore((state) => state.presentationOpen);
  const t = useT();
  const session = useSession();
  const elements = useSessionElements();
  const boards = useAppStore((state) => state.boards);
  const currentBoardId = useAppStore((state) => state.currentBoardId);
  const [mode, setMode] = useState<PresentationMode>('zones');
  const [index, setIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [missing, setMissing] = useState(false);
  const layerRef = useRef<HTMLDivElement | null>(null);

  const deck = useMemo<Slide[]>(() => {
    if (mode === 'zones') return zoneDeck(readingOrder(elements));
    return boardDeck(currentBoardId ?? session.boardId, boards);
  }, [mode, elements, boards, currentBoardId, session.boardId]);

  const slide = deck[Math.min(index, Math.max(0, deck.length - 1))] ?? null;

  const enterFullscreen = useCallback(async (): Promise<void> => {
    const node = layerRef.current;
    if (!node || document.fullscreenElement) return;
    try {
      await node.requestFullscreen();
    } catch {
      // Sin permiso de pantalla completa: se sigue a pantalla completa de la app.
      setIsFullscreen(false);
    }
  }, []);

  const exitFullscreen = useCallback(async (): Promise<void> => {
    if (!document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch {
      // el navegador ya salió
    }
  }, []);

  const close = useCallback((): void => {
    usePanelsStore.getState().setPresentationOpen(false);
    void exitFullscreen();
  }, [exitFullscreen]);

  useEffect(() => {
    if (!open) return undefined;
    setIndex(0);
    const timer = setTimeout(() => void enterFullscreen(), 30);
    const onFullscreenChange = (): void => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      setIsFullscreen(false);
    };
  }, [open, enterFullscreen]);

  // Encuadre de la diapositiva activa. Las de tipo tablero navegan primero y el
  // encuadre lo hace el efecto siguiente, cuando la sesión ya es la del tablero.
  useEffect(() => {
    if (!open || !slide) return;
    if (slide.kind === 'zone') {
      const rect = slideBounds(slide);
      const ui = useUiStore.getState();
      ui.setViewport(fitRect(rect, ui.canvasSize, { padding: 80, maxScale: 1.4 }));
      setMissing(false);
      return;
    }
    if (slide.boardId !== session.boardId) {
      onOpenBoard(slide.boardId);
      return;
    }
    const timer = setTimeout(() => {
      const ui = useUiStore.getState();
      const bounds = session.bounds(ui.measuredHeights);
      ui.zoomToFit(fitRect(bounds as Rect, ui.canvasSize, { padding: 96, maxScale: 1.2 }));
      setMissing(false);
    }, 260);
    return () => clearTimeout(timer);
  }, [open, slide, session, onOpenBoard]);

  useEffect(() => {
    if (!open) return;
    if (deck.length === 0) setMissing(true);
  }, [open, deck.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        setIndex((current) => stepIndex(current, deck.length, 1));
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        setIndex((current) => stepIndex(current, deck.length, -1));
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        if (document.fullscreenElement) void exitFullscreen();
        else void enterFullscreen();
        return;
      }
      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        setMode('zones');
        setIndex(0);
        return;
      }
      if (event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        setMode('boards');
        setIndex(0);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, deck.length, close, enterFullscreen, exitFullscreen]);

  if (!open) return null;

  const label = slide
    ? slide.kind === 'zone'
      ? t(`type.${slide.type}`)
      : slide.title || t('app.untitledBoard')
    : t('presentation.board');

  return (
    <div
      ref={layerRef}
      className="presentation"
      role="dialog"
      aria-modal="true"
      aria-label={t('presentation.enter')}
      data-presentation
      data-presentation-mode={mode}
    >
      <div className="presentation__hud" data-presentation-hud>
        <span className="presentation__title">{label}</span>
        <span className="presentation__counter" data-presentation-counter>
          {deck.length === 0
            ? '—'
            : t('presentation.position', { current: Math.min(index + 1, deck.length), total: deck.length })}
        </span>
      </div>

      <div className="presentation__controls">
        <button
          type="button"
          className="presentation__button"
          title={t('presentation.prev')}
          data-presentation-prev
          onClick={() => setIndex((current) => stepIndex(current, deck.length, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          className="presentation__button"
          title={t('presentation.next')}
          data-presentation-next
          onClick={() => setIndex((current) => stepIndex(current, deck.length, 1))}
        >
          <ChevronRight size={18} />
        </button>
        <button
          type="button"
          className="presentation__button"
          title={t('presentation.fullscreen')}
          data-presentation-fullscreen
          onClick={() => (isFullscreen ? void exitFullscreen() : void enterFullscreen())}
        >
          {isFullscreen ? <Shrink size={17} /> : <Expand size={17} />}
        </button>
        <button
          type="button"
          className="presentation__button"
          title={t('presentation.exit')}
          data-presentation-exit
          onClick={close}
        >
          <X size={17} />
        </button>
      </div>

      {missing ? <p className="presentation__empty">{t('listView.empty')}</p> : null}
    </div>
  );
}

/** Clave estable de la diapositiva activa (para pruebas y telemetría interna). */
export const presentationSlideKey = slideKey;

/**
 * Panel lateral derecho: «Sin ordenar» (bandeja de entrada), «Papelera» y
 * «Comentarios» (fase 5).
 *
 * Cada pestaña se monta solo cuando está visible: la bandeja abre una sesión del
 * documento «Sin ordenar» que se destruye al salir de ella.
 */

import { useEffect, useState } from 'react';

import { Archive, Inbox, MessageSquare } from 'lucide-react';

import { useSession } from '@/collab/SessionContext';
import { useAppStore } from '@/state/appStore';
import { useUiStore, type PanelTab } from '@/state/uiStore';

import { CommentsPanelBody } from './CommentsPanel';
import { TrashPanelBody } from './TrashPanel';
import { UnorderedPanelBody } from './UnorderedPanel';

const TABS: { id: PanelTab; label: string; icon: JSX.Element }[] = [
  { id: 'unsorted', label: 'Sin ordenar', icon: <Inbox size={13} /> },
  { id: 'trash', label: 'Papelera', icon: <Archive size={13} /> },
  { id: 'comments', label: 'Comentarios', icon: <MessageSquare size={13} /> },
];

/** Duración de la salida en CSS (`panel-out`) más un margen por si no llega `animationend`. */
const EXIT_FALLBACK_MS = 200;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function SidePanel(): JSX.Element | null {
  const open = useUiStore((state) => state.panelOpen);
  const tab = useUiStore((state) => state.panelTab);
  const boardId = useAppStore((state) => state.currentBoardId);
  const session = useSession();
  // El panel sigue montado mientras suena la salida: se desmonta al terminar la
  // animación (o por el temporizador, si el navegador no la emite).
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    if (!mounted) return undefined;
    const timer = window.setTimeout(() => setMounted(false), EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // Con movimiento reducido no hay salida: se desmonta al instante.
  if (!open && (!mounted || prefersReducedMotion())) return null;

  const leaving = !open;
  const active = TABS.find((entry) => entry.id === tab) ?? TABS[0]!;

  return (
    <aside
      className={`panel${leaving ? ' is-leaving' : ''}`}
      aria-label={active.label}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) setMounted(false);
      }}
    >
      <header className="panel__head">
        <div className="panel__tabs" role="tablist" aria-label="Panel lateral">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === tab}
              className={`panel__tab${entry.id === tab ? ' is-active' : ''}`}
              data-panel-tab={entry.id}
              onClick={() => useUiStore.getState().setPanelTab(entry.id)}
            >
              {entry.icon}
              {entry.label}
            </button>
          ))}
        </div>
      </header>
      <div className="panel__body">
        {tab === 'trash' ? (
          <TrashPanelBody />
        ) : tab === 'comments' ? (
          <CommentsPanelBody session={session} boardId={boardId ?? session.boardId} />
        ) : (
          <UnorderedPanelBody />
        )}
      </div>
    </aside>
  );
}

/**
 * Panel lateral derecho: «Sin ordenar» (bandeja de entrada), «Papelera» y
 * «Comentarios» (fase 5).
 *
 * Cada pestaña se monta solo cuando está visible: la bandeja abre una sesión del
 * documento «Sin ordenar» que se destruye al salir de ella.
 */

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

export function SidePanel(): JSX.Element | null {
  const open = useUiStore((state) => state.panelOpen);
  const tab = useUiStore((state) => state.panelTab);
  const boardId = useAppStore((state) => state.currentBoardId);
  const session = useSession();
  if (!open) return null;

  const active = TABS.find((entry) => entry.id === tab) ?? TABS[0]!;

  return (
    <aside className="panel" aria-label={active.label}>
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

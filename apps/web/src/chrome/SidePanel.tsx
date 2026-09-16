/**
 * Panel lateral derecho: «Sin ordenar» (bandeja de entrada) y «Papelera».
 *
 * Cada pestaña se monta solo cuando está visible: la bandeja abre una sesión del
 * documento «Sin ordenar» que se destruye al salir de ella.
 */

import { Archive, Inbox } from 'lucide-react';

import { useUiStore, type PanelTab } from '@/state/uiStore';

import { TrashPanelBody } from './TrashPanel';
import { UnorderedPanelBody } from './UnorderedPanel';

const TABS: { id: PanelTab; label: string; icon: JSX.Element }[] = [
  { id: 'unsorted', label: 'Sin ordenar', icon: <Inbox size={13} /> },
  { id: 'trash', label: 'Papelera', icon: <Archive size={13} /> },
];

export function SidePanel(): JSX.Element | null {
  const open = useUiStore((state) => state.panelOpen);
  const tab = useUiStore((state) => state.panelTab);
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
              onClick={() => useUiStore.getState().setPanelTab(entry.id)}
            >
              {entry.icon}
              {entry.label}
            </button>
          ))}
        </div>
      </header>
      <div className="panel__body">
        {tab === 'trash' ? <TrashPanelBody /> : <UnorderedPanelBody />}
      </div>
    </aside>
  );
}

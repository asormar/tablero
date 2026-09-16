/**
 * Indicador de estado de sincronización: guardado / guardando / sin conexión.
 *
 * El estado viene de la sesión (Yjs + proveedor de colaboración) y se copia al
 * store de aplicación para que lo consuma cualquier superficie.
 */

import { Check, CloudOff, LoaderCircle } from 'lucide-react';

import type { SyncState } from '@/collab/BoardSession';
import { useAppStore } from '@/state/appStore';

type Descriptor = { label: string; title: string; icon: JSX.Element; tone: string };

function describe(state: SyncState, apiOnline: boolean): Descriptor {
  switch (state) {
    case 'saving':
      return {
        label: 'Guardando…',
        title: 'Hay cambios locales pendientes de confirmar',
        icon: <LoaderCircle size={14} className="spin" />,
        tone: 'is-saving',
      };
    case 'offline':
      return {
        label: 'Sin conexión',
        title: apiOnline
          ? 'Sin conexión con el servidor de colaboración: los cambios se guardan en este navegador'
          : 'El servidor no responde: seguís trabajando en local y se guarda en este navegador',
        icon: <CloudOff size={14} />,
        tone: 'is-offline',
      };
    case 'error':
      return {
        label: 'Sin conexión',
        title: 'La sesión de colaboración fue rechazada: se guarda en este navegador',
        icon: <CloudOff size={14} />,
        tone: 'is-offline',
      };
    case 'connecting':
      return {
        label: 'Conectando…',
        title: 'Estableciendo la conexión con el servidor',
        icon: <LoaderCircle size={14} className="spin" />,
        tone: 'is-saving',
      };
    default:
      return {
        label: 'Guardado',
        title: 'Todos los cambios están guardados',
        icon: <Check size={14} />,
        tone: 'is-saved',
      };
  }
}

export function SyncIndicator(): JSX.Element {
  const state = useAppStore((store) => store.syncState);
  const apiOnline = useAppStore((store) => store.apiOnline);
  const descriptor = describe(state, apiOnline);
  return (
    <span className={`sync ${descriptor.tone}`} title={descriptor.title} role="status" aria-live="polite">
      {descriptor.icon}
      <span className="sync__label">{descriptor.label}</span>
    </span>
  );
}

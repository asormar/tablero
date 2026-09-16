/**
 * Panel "Sin ordenar".
 *
 * En la fase 1 el panel existe con su estado vacío: es el destino de las
 * tarjetas que se sueltan en la zona de sin clasificar (fases siguientes) y el
 * lugar donde vivirán los borradores rápidos.
 */

import { Inbox } from 'lucide-react';

import { useUiStore } from '@/state/uiStore';

export function UnorderedPanel(): JSX.Element | null {
  const open = useUiStore((state) => state.panelOpen);
  if (!open) return null;

  return (
    <aside className="panel" aria-label="Sin ordenar">
      <header className="panel__head">
        <h2 className="panel__title">Sin ordenar</h2>
        <span className="panel__count">0</span>
      </header>
      <div className="panel__body">
        <div className="panel__empty">
          <span className="panel__empty-icon" aria-hidden="true">
            <Inbox size={26} />
          </span>
          <p className="panel__empty-title">Nada sin ordenar</p>
          <p className="panel__empty-text">
            Las tarjetas que dejes aquí quedan fuera del lienzo hasta que las coloques en su tablero.
          </p>
        </div>
      </div>
    </aside>
  );
}

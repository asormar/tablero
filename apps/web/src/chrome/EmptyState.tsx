/**
 * Estado vacío: icono, título, texto corto y, si hay una acción útil, un botón.
 *
 * Sustituye a las líneas sueltas de «no hay nada» de los paneles: dice qué falta
 * y, cuando se puede, deja resolverlo desde ahí.
 */

import type { ReactNode } from 'react';

export type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  text?: string;
  /** Botón opcional («Crear tablero»…). */
  action?: { label: string; onClick(): void };
  /** Versión sin borde ni relleno extra, para huecos dentro de una lista. */
  compact?: boolean;
  /** Atributos `data-*` que usan las pruebas de punta a punta. */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
};

export function EmptyState({ icon, title, text, action, compact = false, ...rest }: EmptyStateProps): JSX.Element {
  return (
    <div className={`empty-state${compact ? ' empty-state--compact' : ''}`} {...rest}>
      <span className="empty-state__icon" aria-hidden="true">
        {icon}
      </span>
      <p className="empty-state__title">{title}</p>
      {text ? <p className="empty-state__text">{text}</p> : null}
      {action ? (
        <button type="button" className="button button--primary empty-state__action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

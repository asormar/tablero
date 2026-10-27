/**
 * Diálogo modal único de la aplicación.
 *
 * Todos los diálogos comparten esta pieza: el mismo velo (`.modal`), la misma
 * tarjeta (`.modal__panel`), la misma cabecera y el mismo comportamiento:
 *
 *   - Clic en el velo cierra, pero solo si el puntero se pulsó **y** se soltó
 *     sobre el velo: arrastrar para seleccionar texto y soltar fuera no cierra.
 *   - `Esc` cierra el diálogo de arriba. Se atiende en captura y cede si otro
 *     manejador ya consumió la tecla (`panelsStore.closeTop` en
 *     `usePhase4Shortcuts` va antes y marca el evento como atendido), así que
 *     un mismo `Esc` nunca cierra dos cosas.
 *   - Trampa de foco (`useFocusTrap`): el foco entra, `Tab` da la vuelta y al
 *     cerrar vuelve a donde estaba.
 *   - `role="dialog"`, `aria-modal` y `aria-labelledby` apuntando al título.
 *
 * El que lo usa decide cuándo montarlo (`if (!open) return null`) y pone dentro
 * el cuerpo (`.modal__body`) y, si hace falta, el pie (`.modal__foot`).
 */

import { useEffect, useId, useRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

import { X } from 'lucide-react';

import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useT } from '@/i18n';

/** Atributos extra de la tarjeta (`data-*` que usan las pruebas, `id`…). */
export type ModalPanelProps = HTMLAttributes<HTMLDivElement> & {
  [attribute: `data-${string}`]: string | number | boolean | undefined;
};

export type ModalProps = {
  /** Título visible; también es el nombre accesible del diálogo. */
  title: string;
  /** Icono que va delante del título. */
  icon?: ReactNode;
  onClose(): void;
  /** Controles de la cabecera que van antes del botón de cerrar. */
  headActions?: ReactNode;
  /** Clases extra del velo (por ejemplo `palette`). */
  className?: string;
  /** Clases extra de la tarjeta (`home`, `export`…). */
  panelClassName?: string;
  panelProps?: ModalPanelProps;
  /** Cierra al pulsar y soltar sobre el velo. Por defecto sí. */
  dismissOnBackdrop?: boolean;
  /** Cierra con `Esc`. Por defecto sí. */
  closeOnEscape?: boolean;
  children: ReactNode;
};

/** Diálogos montados, el último es el de arriba. Solo ese atiende `Esc`. */
const mounted: object[] = [];

export function Modal({
  title,
  icon,
  onClose,
  headActions,
  className,
  panelClassName,
  panelProps,
  dismissOnBackdrop = true,
  closeOnEscape = true,
  children,
}: ModalProps): JSX.Element {
  const t = useT();
  const titleId = useId();
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const token = {};
    mounted.push(token);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!closeOnEscape || event.key !== 'Escape') return;
      // Otro manejador ya lo atendió, o hay un diálogo por encima de este.
      if (event.defaultPrevented || event.isComposing) return;
      if (mounted[mounted.length - 1] !== token) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      const index = mounted.indexOf(token);
      if (index >= 0) mounted.splice(index, 1);
    };
  }, [closeOnEscape]);

  const { className: extraPanelClass, ...restPanelProps } = panelProps ?? {};

  return (
    <div
      className={className ? `modal ${className}` : 'modal'}
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        const hit = pressedOnBackdrop.current && event.target === event.currentTarget;
        pressedOnBackdrop.current = false;
        if (hit && dismissOnBackdrop) onClose();
      }}
    >
      <div
        {...restPanelProps}
        className={['modal__panel', panelClassName, extraPanelClass].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={trapRef}
      >
        <div className="modal__head">
          <h2 className="modal__title" id={titleId}>
            {icon}
            {title}
          </h2>
          <div className="modal__head-actions">
            {headActions}
            <button type="button" className="icon-button" title={t('common.close')} aria-label={t('common.close')} onClick={onClose}>
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

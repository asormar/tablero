/**
 * Menú «Más» de la barra superior.
 *
 * Con la ventana estrecha (≤ 1024 px) la barra solo deja a la vista buscar,
 * deshacer/rehacer, compartir y el menú de usuario; el resto de acciones vive
 * aquí. Patrón de menú de la app: botón con `aria-haspopup="menu"`, cierre con
 * clic fuera o `Esc` (`useOutsideClose`), foco en el primer elemento al abrir y
 * de vuelta al botón al cerrar, y flechas / Inicio / Fin para moverse.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Ellipsis } from 'lucide-react';

import { useT } from '@/i18n';

import { focusFirstMenuItem, handleMenuKeyDown } from './menuKeyboard';
import { useOutsideClose } from './useOutsideClose';

/** Separación entre el botón y el menú. */
const MENU_GAP = 6;
/** Margen mínimo contra el borde inferior de la ventana. */
const EDGE_MARGIN = 12;

export type OverflowItem = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect(): void;
  disabled?: boolean;
  /** La superficie que abre ya está abierta. */
  active?: boolean;
  /** Contador (notificaciones sin leer). */
  badge?: number;
  /** Raya separadora antes del elemento (cambio de grupo). */
  separatorBefore?: boolean;
};

export function TopBarOverflow({ items, badge = 0 }: { items: OverflowItem[]; badge?: number }): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const ref = useOutsideClose<HTMLDivElement>(open, close);

  useEffect(() => {
    if (open) focusFirstMenuItem(menuRef.current);
  }, [open]);

  const toggle = (): void => {
    const rect = buttonRef.current?.getBoundingClientRect();
    setAnchor(
      rect
        ? {
            top: Math.round(rect.bottom + MENU_GAP),
            right: Math.max(8, Math.round(window.innerWidth - rect.right)),
            maxHeight: Math.max(160, Math.round(window.innerHeight - rect.bottom - MENU_GAP - EDGE_MARGIN)),
          }
        : null,
    );
    setOpen((value) => !value);
  };

  const select = (item: OverflowItem): void => {
    // El foco vuelve al botón *antes* de lanzar la acción: un diálogo que se
    // abra recordará el botón (no un elemento del menú que ya no existe).
    setOpen(false);
    buttonRef.current?.focus();
    item.onSelect();
  };

  return (
    <div className="topbar__more" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className={`topbar__more-button${open ? ' is-active' : ''}`}
        title={t('topbar.menu')}
        aria-label={badge > 0 ? `${t('topbar.menu')} (${badge})` : t('topbar.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-topbar-more
        onClick={toggle}
        onKeyDown={(event) => {
          // Flecha abajo abre el menú desde el botón, como en los menús nativos.
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <Ellipsis size={15} aria-hidden="true" />
        <span className="topbar__more-text">{t('topbar.more')}</span>
        {badge > 0 ? (
          <span className="topbar__more-badge" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={menuRef}
          className="menu topbar__more-menu"
          role="menu"
          aria-label={t('topbar.menu')}
          data-topbar-more-menu
          style={anchor ? { top: anchor.top, right: anchor.right, maxHeight: anchor.maxHeight } : undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Tab') {
              event.preventDefault();
              close();
              return;
            }
            handleMenuKeyDown(event, menuRef.current);
          }}
        >
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separatorBefore ? <span className="menu__sep" role="separator" /> : null}
              <button
                type="button"
                role="menuitem"
                className={`menu__item${item.active ? ' is-active' : ''}`}
                tabIndex={-1}
                disabled={item.disabled}
                data-topbar-menu-item={item.id}
                onClick={() => select(item)}
              >
                {/* El icono va suelto: `.menu__item` da el espacio sobrante al primer `span`. */}
                {item.icon}
                <span>{item.label}</span>
                {item.badge && item.badge > 0 ? <span className="topbar__more-badge">{item.badge}</span> : null}
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Menú de usuario de la barra superior (fase 7).
 *
 * Antes no había forma de ver ni cambiar de usuario desde la interfaz. El botón
 * muestra la inicial de la sesión y abre un menú con el nombre, el email,
 * «Cerrar sesión» y «Cambiar de cuenta». Sigue el patrón de menú de la app:
 * `useOutsideClose` (clic fuera y `Esc`), el foco entra en el primer ítem al
 * abrir y vuelve al botón al cerrar.
 */

import { useEffect, useRef, useState } from 'react';

import { LogIn, LogOut, UserRound } from 'lucide-react';

import { signOut } from '@/app/sessionActions';
import { isSignedIn, userInitial, userLabel } from '@/lib/userMenu';
import { useAppStore } from '@/state/appStore';

import { useOutsideClose } from './useOutsideClose';

/** Separación entre el botón y el menú. */
const MENU_GAP = 6;

export function UserMenu(): JSX.Element {
  const user = useAppStore((state) => state.user);
  const signedIn = isSignedIn(user);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const ref = useOutsideClose<HTMLDivElement>(open, close);

  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  const toggle = (): void => {
    const rect = buttonRef.current?.getBoundingClientRect();
    setAnchor(
      rect
        ? { top: Math.round(rect.bottom + MENU_GAP), right: Math.max(8, Math.round(window.innerWidth - rect.right)) }
        : null,
    );
    setOpen((value) => !value);
  };

  const label = userLabel(user);
  const initial = userInitial(user);

  const run = (action: () => void): void => {
    close();
    action();
  };

  return (
    <div className="topbar__user" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className={`topbar__user-button${open ? ' is-active' : ''}`}
        title={signedIn ? `${label} · ${user.email}` : 'Sesión'}
        aria-label={signedIn ? `Cuenta: ${label} (${user.email})` : 'Sesión'}
        aria-haspopup="menu"
        aria-expanded={open}
        data-topbar-user
        onClick={toggle}
      >
        <span aria-hidden="true">{initial}</span>
      </button>

      {open ? (
        <div
          className="menu user-menu"
          role="menu"
          aria-label="Cuenta"
          data-user-menu
          style={anchor ? { top: anchor.top, right: anchor.right } : undefined}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="user-menu__head">
            <span className="user-menu__avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="user-menu__identity">
              <span className="user-menu__name">{label}</span>
              <span className="user-menu__email">{user.email.length > 0 ? user.email : 'Sin cuenta en el servidor'}</span>
            </span>
          </div>

          {signedIn ? (
            <>
              <button
                ref={firstItemRef}
                type="button"
                className="menu__item"
                role="menuitem"
                data-user-signout
                onClick={() => run(() => void signOut())}
              >
                <LogOut size={15} />
                <span>Cerrar sesión</span>
              </button>
              {/* Mismo camino que «Cerrar sesión»: al salir se vuelve a la
                  pantalla de acceso, que es donde se entra con otra cuenta. */}
              <button
                type="button"
                className="menu__item"
                role="menuitem"
                data-user-switch
                onClick={() => run(() => void signOut())}
              >
                <UserRound size={15} />
                <span>Cambiar de cuenta</span>
              </button>
            </>
          ) : (
            <button
              ref={firstItemRef}
              type="button"
              className="menu__item"
              role="menuitem"
              data-user-signin
              onClick={() => run(() => useAppStore.getState().setAuthRequired(true))}
            >
              <LogIn size={15} />
              <span>Iniciar sesión</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

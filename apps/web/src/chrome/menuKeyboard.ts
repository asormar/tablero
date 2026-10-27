/**
 * Teclado de un menú: mueve el foco entre los `role="menuitem"` del contenedor.
 * La aritmética (vuelta, saltos de deshabilitados) está en `lib/menuNav.ts`.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { nextMenuIndex } from '@/lib/menuNav';

const ITEM_SELECTOR = '[role="menuitem"]';

/** Elementos del menú, en orden del DOM. */
export function menuItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
}

/** Enfoca el primer elemento habilitado (al abrir el menú). */
export function focusFirstMenuItem(container: HTMLElement | null): void {
  if (!container) return;
  const items = menuItems(container);
  const index = nextMenuIndex(
    items.map((item) => !(item as HTMLButtonElement).disabled),
    -1,
    'ArrowDown',
  );
  if (index >= 0) items[index]?.focus();
}

/**
 * Atiende flechas, Inicio y Fin dentro del menú. Devuelve `true` si la tecla era
 * de navegación (y ya se marcó como atendida).
 */
export function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLElement>, container: HTMLElement | null): boolean {
  if (!container) return false;
  const items = menuItems(container);
  const current = items.findIndex((item) => item === document.activeElement);
  const index = nextMenuIndex(
    items.map((item) => !(item as HTMLButtonElement).disabled),
    current,
    event.key,
  );
  if (index < 0) return false;
  event.preventDefault();
  event.stopPropagation();
  items[index]?.focus();
  return true;
}

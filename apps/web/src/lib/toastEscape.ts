/**
 * `Esc` con el foco dentro de un aviso: cierra solo ese aviso.
 *
 * Los diálogos, los atajos de paneles y el lienzo escuchan `Esc` en `window` en
 * fase de captura, antes de que el evento llegue al aviso, así que el
 * `stopPropagation` del propio aviso (React lo atiende en la raíz) llega tarde.
 * Este oyente se instala antes de montar React: va el primero en `window`,
 * corta la propagación y cierra el aviso con su botón de cerrar (así conserva la
 * animación de salida).
 */

import { TOAST_REGION_SELECTOR } from './focusTrap';

/** Lo mínimo de un nodo que hace falta (permite probarlo sin DOM). */
export type ToastTargetLike = { closest?: (selector: string) => unknown } | null;

type ToastCardLike = { querySelector(selector: string): unknown };

/** Tarjeta de aviso que contiene el destino del evento, si está en la pila. */
export function toastCardOf(target: unknown): ToastCardLike | null {
  const node = target as ToastTargetLike;
  if (typeof node?.closest !== 'function') return null;
  if (node.closest(TOAST_REGION_SELECTOR) == null) return null;
  return (node.closest('.toast') as ToastCardLike | null) ?? null;
}

/**
 * Instala el oyente en `root` (por defecto `window`). Devuelve la función que
 * lo quita.
 */
export function installToastEscape(root: EventTarget = window): () => void {
  const onKeyDown = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (key.key !== 'Escape' || key.isComposing) return;
    const card = toastCardOf(event.target);
    if (!card) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    (card.querySelector('.toast__close') as { click?: () => void } | null)?.click?.();
  };
  root.addEventListener('keydown', onKeyDown, { capture: true });
  return () => root.removeEventListener('keydown', onKeyDown, { capture: true });
}

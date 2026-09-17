/**
 * Trampa de foco para diálogos (fase 6, accesibilidad).
 *
 * Los diálogos modales tienen que cumplir tres cosas: que el foco entre al
 * abrirse, que `Tab` no se escape nunca a la página de atrás y que al cerrarse
 * el foco vuelva a donde estaba. La aritmética de la vuelta (el último elemento
 * pasa al primero y al revés) vive acá, sin DOM, para poder probarla.
 */

/** Selector de lo enfocables con teclado dentro de un contenedor. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/** Elementos que nunca deben recibir el foco con `Tab`. */
export function isHiddenCandidate(element: Element): boolean {
  const node = element as HTMLElement;
  if (node.hasAttribute('hidden')) return true;
  if (node.getAttribute('aria-hidden') === 'true') return true;
  return node.getAttribute('type') === 'hidden';
}

/**
 * Siguiente índice con vuelta: `Tab` avanza y, después del último, vuelve al
 * primero; `Shift+Tab` retrocede y, antes del primero, salta al último. Devuelve
 * `-1` cuando no hay elementos.
 */
export function nextTrapIndex(count: number, current: number, shift = false): number {
  if (count <= 0) return -1;
  if (current < 0) return shift ? count - 1 : 0;
  const delta = shift ? -1 : 1;
  return (current + delta + count) % count;
}

/**
 * Lista de enfocables visibles dentro de un contenedor. Acepta cualquier cosa
 * con `querySelectorAll` (también un doble de prueba sin DOM real).
 */
export function focusablesWithin(root: ParentNode, isVisible?: (element: Element) => boolean): HTMLElement[] {
  const nodes = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
  return nodes.filter((node) => !isHiddenCandidate(node) && (isVisible ? isVisible(node) : true));
}

/** Elemento que recibe el foco al abrir: el marcado como `data-autofocus` o el primero. */
export function initialFocusTarget(root: ParentNode, isVisible?: (element: Element) => boolean): HTMLElement | null {
  const preferred = root.querySelector<HTMLElement>('[data-autofocus]');
  if (preferred && !isHiddenCandidate(preferred)) return preferred;
  const list = focusablesWithin(root, isVisible);
  return list[0] ?? null;
}

/** `true` cuando el elemento se puede ver (para no enfocar cosas ocultas). */
export function isVisibleElement(element: Element): boolean {
  const node = element as HTMLElement;
  return node.getClientRects().length > 0;
}

/**
 * Índice del elemento que tiene el foco dentro de la lista, o `-1`. Si el foco
 * está en el contenedor (no en un hijo) también devuelve `-1`.
 */
export function activeTrapIndex(list: readonly HTMLElement[], active: Element | null): number {
  if (!active) return -1;
  return list.indexOf(active as HTMLElement);
}

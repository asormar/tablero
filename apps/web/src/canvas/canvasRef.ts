/**
 * Referencia al nodo raíz del lienzo.
 *
 * Varias superficies (menú contextual, barra de herramientas, atajos) necesitan
 * convertir coordenadas de pantalla a mundo sin tener el nodo a mano: aquí se
 * guarda la referencia y se centraliza la conversión.
 */

import { type Point, screenToWorld } from '@tablero/shared';

import { useUiStore } from '@/state/uiStore';

let root: HTMLElement | null = null;
let cachedRect: DOMRect | null = null;
let rectObserver: ResizeObserver | null = null;

/** Descarta el rectángulo guardado: el siguiente `canvasRect()` vuelve a medir. */
export function invalidateCanvasRect(): void {
  cachedRect = null;
}

/**
 * El rectángulo se mide una vez y se reutiliza (cada `getBoundingClientRect` en
 * un evento de puntero fuerza layout). Se invalida cuando el lienzo cambia de
 * tamaño (ResizeObserver) y cuando la ventana cambia de tamaño o algo se
 * desplaza; el lienzo además lo invalida al empezar cada gesto.
 */
function bindRectInvalidation(node: HTMLElement): void {
  if (typeof ResizeObserver !== 'undefined') {
    rectObserver = new ResizeObserver(invalidateCanvasRect);
    rectObserver.observe(node);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', invalidateCanvasRect);
    window.addEventListener('scroll', invalidateCanvasRect, { capture: true, passive: true });
  }
}

function unbindRectInvalidation(): void {
  rectObserver?.disconnect();
  rectObserver = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', invalidateCanvasRect);
    window.removeEventListener('scroll', invalidateCanvasRect, { capture: true });
  }
}

export function setCanvasRoot(node: HTMLElement | null): void {
  if (root === node) return;
  unbindRectInvalidation();
  root = node;
  cachedRect = null;
  if (node) bindRectInvalidation(node);
}

export function canvasRoot(): HTMLElement | null {
  return root;
}

/** Rectángulo del lienzo en la pantalla (o uno vacío si aún no está montado). */
export function canvasRect(): DOMRect {
  if (!root) return new DOMRect(0, 0, 0, 0);
  cachedRect ??= root.getBoundingClientRect();
  return cachedRect;
}

/** Coordenadas relativas al lienzo a partir de clientX/clientY de un evento. */
export function canvasPoint(clientX: number, clientY: number): Point {
  const rect = canvasRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/** Punto de mundo a partir de coordenadas de pantalla absolutas. */
export function worldFromClient(clientX: number, clientY: number): Point {
  const { viewport } = useUiStore.getState();
  return screenToWorld(viewport, canvasPoint(clientX, clientY));
}

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

export function setCanvasRoot(node: HTMLElement | null): void {
  root = node;
}

export function canvasRoot(): HTMLElement | null {
  return root;
}

/** Rectángulo del lienzo en la pantalla (o uno vacío si aún no está montado). */
export function canvasRect(): DOMRect {
  if (!root) return new DOMRect(0, 0, 0, 0);
  return root.getBoundingClientRect();
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

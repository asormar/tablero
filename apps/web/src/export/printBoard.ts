/**
 * Impresión / PDF del tablero (punto 3 de la fase 4).
 *
 * El plan dice: «diálogo de impresión con hoja de estilo de impresión para PDF».
 * Antes de imprimir se encaja la vista (si no, solo se imprimiría la parte
 * visible, porque la capa de tarjetas está virtualizada) y se marca el `<html>`
 * con `data-print="board"`: la hoja `print.css` esconde toda la interfaz y deja
 * el lienzo a página completa.
 */

import { fitToScreen } from '@/canvas/commands';
import type { BoardSession } from '@/collab/BoardSession';

const PRINT_ATTRIBUTE = 'data-print';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Encaja la vista, imprime y limpia. Devuelve `false` si el navegador lo bloqueó. */
export async function printBoard(session: BoardSession): Promise<boolean> {
  const root = document.documentElement;
  fitToScreen(session);
  // Un frame para que la capa virtualizada monte todo el tablero.
  await delay(180);
  root.setAttribute(PRINT_ATTRIBUTE, 'board');
  const cleanup = (): void => root.removeAttribute(PRINT_ATTRIBUTE);
  window.addEventListener('afterprint', cleanup, { once: true });
  try {
    window.print();
    return true;
  } catch {
    return false;
  } finally {
    // `afterprint` no siempre llega (algunos navegadores); se limpia igual con
    // margen suficiente para que el diálogo haya tomado la instantánea.
    setTimeout(cleanup, 1500);
  }
}

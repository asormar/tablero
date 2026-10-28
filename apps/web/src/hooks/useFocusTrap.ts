/**
 * Trampa de foco para diálogos modales (fase 6, accesibilidad).
 *
 * Al activarse: mete el foco en `[data-autofocus]` o en el primer enfocable,
 * mantiene `Tab`/`Shift+Tab` dentro del contenedor con vuelta y, al cerrarse,
 * devuelve el foco al elemento que lo tenía antes de abrir.
 */

import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import {
  TOAST_REGION_SELECTOR,
  activeTrapIndex,
  initialFocusTarget,
  isInsideRegion,
  isVisibleElement,
  nextTrapIndex,
  trapCycle,
} from '@/lib/focusTrap';

/** Trampas activas: la última es la del diálogo de arriba. */
const activeTraps: object[] = [];

function toastRegion(): HTMLElement | null {
  return document.querySelector<HTMLElement>(TOAST_REGION_SELECTOR);
}

export function useFocusTrap<T extends HTMLElement>(active: boolean): MutableRefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return undefined;
    const node = ref.current;
    if (!node) return undefined;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const token = {};
    activeTraps.push(token);
    // El ciclo incluye la pila de avisos: su botón de acción no queda fuera.
    const list = (): HTMLElement[] => {
      const region = toastRegion();
      return trapCycle(node, region ? [region] : [], isVisibleElement);
    };
    const first = initialFocusTarget(node, isVisibleElement);
    if (first) {
      first.focus();
    } else {
      // Diálogo sin controles enfocables: el foco va al contenedor para que el
      // lector de pantalla anuncie el contenido y `Tab` no se escape enseguida.
      node.tabIndex = -1;
      node.focus();
    }

    const onTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const items = list();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const index = nextTrapIndex(items.length, activeTrapIndex(items, document.activeElement), event.shiftKey);
      if (index < 0) return;
      event.preventDefault();
      items[index]?.focus();
    };

    // Con el foco dentro de un aviso el evento no pasa por el diálogo: solo la
    // trampa de arriba lo atiende, para que `Tab` vuelva al diálogo.
    const onToastTab = (event: KeyboardEvent): void => {
      if (activeTraps[activeTraps.length - 1] !== token) return;
      if (!isInsideRegion(toastRegion(), event.target)) return;
      onTab(event);
    };

    node.addEventListener('keydown', onTab);
    document.addEventListener('keydown', onToastTab);
    return () => {
      node.removeEventListener('keydown', onTab);
      document.removeEventListener('keydown', onToastTab);
      const index = activeTraps.indexOf(token);
      if (index >= 0) activeTraps.splice(index, 1);
      // Al cerrar, el foco vuelve a donde estaba (si el nodo sigue en el DOM).
      if (previous && previous.isConnected) previous.focus();
    };
  }, [active]);

  return ref;
}

/**
 * Trampa de foco para diálogos modales (fase 6, accesibilidad).
 *
 * Al activarse: mete el foco en `[data-autofocus]` o en el primer enfocable,
 * mantiene `Tab`/`Shift+Tab` dentro del contenedor con vuelta y, al cerrarse,
 * devuelve el foco al elemento que lo tenía antes de abrir.
 */

import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import { activeTrapIndex, focusablesWithin, initialFocusTarget, isVisibleElement, nextTrapIndex } from '@/lib/focusTrap';

export function useFocusTrap<T extends HTMLElement>(active: boolean): MutableRefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return undefined;
    const node = ref.current;
    if (!node) return undefined;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const list = (): HTMLElement[] => focusablesWithin(node, isVisibleElement);
    const first = initialFocusTarget(node, isVisibleElement);
    if (first) {
      first.focus();
    } else {
      // Diálogo sin controles enfocables: el foco va al contenedor para que el
      // lector de pantalla anuncie el contenido y `Tab` no se escape enseguida.
      node.tabIndex = -1;
      node.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
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

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      // Al cerrar, el foco vuelve a donde estaba (si el nodo sigue en el DOM).
      if (previous && previous.isConnected) previous.focus();
    };
  }, [active]);

  return ref;
}

/**
 * Destello de la tarjeta señalada (fase 4): cuando la búsqueda —o cualquier
 * otra superficie— marca un elemento con `panelsStore.flashElement`, esta capa
 * le pone la clase `is-flash` al nodo ya montado y la saca al terminar.
 *
 * Se hace sobre el DOM (y no con una prop) a propósito: la tarjeta está
 * memoizada por elemento y no conviene que todas se re-rendericen cuando cambia
 * el destello. Si la tarjeta todavía no está montada (se acaba de abrir otro
 * tablero) se reintenta unas cuantas veces.
 */

import { useEffect } from 'react';

import { usePanelsStore } from '@/state/panelsStore';

const RETRY_DELAYS = [0, 90, 220, 420, 700];
const FLASH_MS = 1400;

export function FlashEffect(): null {
  const elementId = usePanelsStore((state) => state.flashElementId);
  const token = usePanelsStore((state) => state.flashToken);

  useEffect(() => {
    if (!elementId) return undefined;
    let cancelled = false;
    const timers: number[] = [];
    const cleanups: number[] = [];

    for (const delay of RETRY_DELAYS) {
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          const selector = `[data-element-id="${CSS.escape(elementId)}"]`;
          const node = document.querySelector<HTMLElement>(selector);
          if (!node) return;
          node.classList.remove('is-flash');
          // Reinicia la animación si el mismo elemento se destaca dos veces.
          void node.offsetWidth;
          node.classList.add('is-flash');
          cleanups.push(
            window.setTimeout(() => node.classList.remove('is-flash'), FLASH_MS),
          );
        }, delay),
      );
    }

    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
      for (const timer of cleanups) window.clearTimeout(timer);
    };
  }, [elementId, token]);

  return null;
}

/** Cierra un panel flotante cuando el puntero cae fuera de él (o con Esc). */

import { useEffect, useRef } from 'react';

import type { MutableRefObject } from 'react';

export function useOutsideClose<T extends HTMLElement>(
  active: boolean,
  onClose: () => void,
): MutableRefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent): void => {
      const node = ref.current;
      if (node && !node.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [active, onClose]);

  return ref;
}

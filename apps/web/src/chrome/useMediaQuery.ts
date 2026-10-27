/**
 * `matchMedia` como estado de React.
 *
 * Se lee de forma síncrona en el primer render (`useSyncExternalStore`), así que
 * el componente nace ya con el valor correcto y no hay salto de diseño al cargar.
 * Sin `matchMedia` (pruebas, entornos sin DOM) devuelve `false`.
 */

import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    (): boolean =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

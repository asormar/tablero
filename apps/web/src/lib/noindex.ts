/**
 * `noindex` para las rutas públicas (fase 5).
 *
 * Las publicaciones (`/p/:slug`) y las invitaciones (`/invite/:token`) no pueden
 * indexarse: el slug es inadvertible a propósito y el token es una credencial.
 * El hook añade la meta y la quita al desmontar.
 */

import { useEffect } from 'react';

const META_NAME = 'robots';

export function useNoindex(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const existing = document.querySelector<HTMLMetaElement>(`meta[name="${META_NAME}"]`);
    const previous = existing?.content ?? null;
    const meta = existing ?? document.createElement('meta');
    if (!existing) {
      meta.setAttribute('name', META_NAME);
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'noindex, nofollow, noarchive');
    return () => {
      if (previous === null) meta.remove();
      else meta.setAttribute('content', previous);
    };
  }, []);
}

/** ¿La página actual está marcada como noindex? (comprobación de humo) */
export function isNoindex(): boolean {
  if (typeof document === 'undefined') return false;
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${META_NAME}"]`);
  return (meta?.content ?? '').includes('noindex');
}

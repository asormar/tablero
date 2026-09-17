/**
 * Rutas de la aplicación (fase 5).
 *
 * La app es una SPA sin router: el tablero vive en `?board=…`. La fase 5 suma
 * dos rutas por *pathname* que tienen que resolverse **antes** de montar el
 * espacio de trabajo, porque no comparten estado con él:
 *
 *   /p/:slug        → vista pública en solo lectura (sin sesión)
 *   /invite/:token  → aceptación de una invitación
 *
 * Este módulo es puro: recibe el `pathname` y devuelve la ruta. El caso por
 * defecto es la aplicación normal, así que una URL desconocida nunca deja la
 * pantalla en blanco.
 */

export type AppRoute =
  | { kind: 'app' }
  | { kind: 'public'; slug: string }
  | { kind: 'invite'; token: string };

const PUBLIC_PREFIX = '/p/';
const INVITE_PREFIX = '/invite/';

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Primera ruta útil: `/p/slug/` y `/p/slug` son la misma cosa. */
export function parseRoute(pathname: string): AppRoute {
  const clean = pathname.split('?')[0] ?? '';
  if (clean.startsWith(PUBLIC_PREFIX)) {
    const rest = clean.slice(PUBLIC_PREFIX.length).replace(/\/+$/, '');
    const slug = rest.split('/')[0] ?? '';
    if (slug.length > 0) return { kind: 'public', slug: decodeSegment(slug) };
    return { kind: 'app' };
  }
  if (clean.startsWith(INVITE_PREFIX)) {
    const rest = clean.slice(INVITE_PREFIX.length).replace(/\/+$/, '');
    const token = rest.split('/')[0] ?? '';
    if (token.length > 0) return { kind: 'invite', token: decodeSegment(token) };
    return { kind: 'app' };
  }
  return { kind: 'app' };
}

/** URL del enlace público de un tablero (`location.origin` + `/p/:slug`). */
export function publicBoardUrl(slug: string, origin?: string): string {
  const base = (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  return `${base}${PUBLIC_PREFIX}${encodeURIComponent(slug)}`;
}

/** URL absoluta de un enlace de invitación. */
export function inviteUrl(token: string, origin?: string): string {
  const base = (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  return `${base}${INVITE_PREFIX}${encodeURIComponent(token)}`;
}

/** Vuelve a la aplicación (quitando la ruta especial del pathname). */
export function appUrl(boardId?: string | null, origin?: string): string {
  const base = (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  if (!boardId) return `${base}/`;
  return `${base}/?board=${encodeURIComponent(boardId)}`;
}

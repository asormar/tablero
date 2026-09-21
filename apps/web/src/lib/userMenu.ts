/**
 * Menú de usuario (fase 7): identidad visible y qué se limpia al cerrar sesión.
 *
 * Lógica pura, sin DOM, para poder probarla directamente; el componente está en
 * `chrome/UserMenu.tsx` y la acción de cerrar sesión en `app/sessionActions.ts`.
 */

import type { BoardSummary } from '@tablero/shared';

import { type AppUser, LOCAL_USER } from '@/state/appStore';

/** Clave de `localStorage` con la identidad de la sesión. */
export const USER_STORAGE_KEY = 'tablero:user:v1';

/**
 * ¿Hay sesión de servidor? En modo local (o sin conexión) el usuario es el
 * marcador `Local`, que no tiene cuenta detrás.
 */
export function isSignedIn(user: AppUser): boolean {
  return user.id !== LOCAL_USER.id;
}

/** Nombre visible: el del perfil, si no el email y, sin cuenta, «Local». */
export function userLabel(user: AppUser): string {
  if (!isSignedIn(user)) return 'Local';
  const name = user.name.trim();
  if (name.length > 0) return name;
  const email = user.email.trim();
  return email.length > 0 ? email : 'Cuenta';
}

/**
 * Inicial del botón redondo. Se toma del nombre (o del email) y se ignoran los
 * signos de puntuación de los emails raros; sin nada legible devuelve «?».
 */
export function userInitial(user: AppUser): string {
  const letter = userLabel(user).replace(/[^\p{L}\p{N}]/gu, '').charAt(0);
  return letter.length > 0 ? letter.toUpperCase() : '?';
}

/**
 * Catálogo tras cerrar sesión: se queda lo que es de este navegador (`ownerId`
 * del usuario local). Los tableros del servidor vuelven a pedirse en
 * `/auth/me` al entrar de nuevo; si se dejaran, la próxima cuenta del navegador
 * vería el catálogo de la anterior.
 */
export function boardsAfterSignOut(boards: BoardSummary[]): BoardSummary[] {
  return boards.filter((board) => board.ownerId === LOCAL_USER.id);
}

/**
 * Menú de usuario: cierra sesión desde la interfaz (fase 7).
 *
 * Cerrar sesión tiene tres partes: avisarle al servidor (borra la sesión y la
 * cookie), limpiar la identidad local —`localStorage` incluido— y volver a la
 * pantalla de acceso (`authRequired`, que desmonta el espacio de trabajo y su
 * sesión de tablero). Los documentos locales (`tablero:doc:v1:*`) **no** se
 * tocan: el trabajo de este navegador sigue ahí.
 */

import { logout } from '@/api/boards';
import { ApiError } from '@/api/client';
import { USER_STORAGE_KEY, boardsAfterSignOut } from '@/lib/userMenu';
import { LOCAL_USER, useAppStore } from '@/state/appStore';

/** Cierra la sesión: servidor, estado local y pantalla de acceso. */
export async function signOut(): Promise<void> {
  try {
    await logout();
  } catch (error) {
    // Sin red o sin sesión en el servidor (401): igual se limpia lo local. La
    // cookie vencida o ausente no debe dejar a nadie atrapado con una sesión.
    if (!(error instanceof ApiError)) throw error;
  }
  clearLocalSession();
}

/**
 * Limpia la identidad local y deja la app en la pantalla de acceso. Exportada
 * aparte para poder usarla sin servidor (y para probarla sin red).
 */
export function clearLocalSession(): void {
  try {
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // sin almacenamiento: no hay nada que limpiar
  }
  const store = useAppStore.getState();
  store.setBoards(boardsAfterSignOut(store.boards));
  // `setUser` vuelve a escribir la clave con el marcador local (sin id, email ni
  // nombre de la cuenta): la identidad de la sesión ya no está en disco.
  store.setUser(LOCAL_USER);
  store.setAuthRequired(true);
}

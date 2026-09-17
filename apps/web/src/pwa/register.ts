/**
 * Registro del service worker (punto 7 de la fase 4).
 *
 * `vite-plugin-pwa` genera `sw.js` con Workbox (precache del build). El registro
 * es propio y no pasa por `virtual:pwa-register` a propósito: ese atajo exige la
 * dependencia `workbox-window` —que no está en el proyecto— y acá no hace falta
 * nada más que registrar y dejar que el service worker se actualice solo
 * (`registerType: 'autoUpdate'` genera el worker con `skipWaiting`).
 *
 * En desarrollo no se registra nada: el build no existe y el HMR quedaría
 * sirviendo módulos cacheados.
 */

export type PwaStatus = 'unsupported' | 'registered' | 'failed';

let status: PwaStatus = 'unsupported';

export function pwaStatus(): PwaStatus {
  return status;
}

const SW_URL = '/sw.js';

/**
 * Registra el service worker. Devuelve una función para buscar actualizaciones.
 */
export function registerPwa(): () => void {
  if (import.meta.env.DEV) {
    status = 'unsupported';
    return () => undefined;
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    status = 'unsupported';
    return () => undefined;
  }
  try {
    void navigator.serviceWorker
      .register(SW_URL, { scope: '/' })
      .then((registration) => {
        status = 'registered';
        return registration;
      })
      .catch(() => {
        status = 'failed';
      });
    return () => {
      void navigator.serviceWorker.getRegistration('/').then((registration) => {
        void registration?.update();
      });
    };
  } catch {
    status = 'failed';
    return () => undefined;
  }
}

/** ¿La app corre instalada (ventana propia) y no en una pestaña? */
export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

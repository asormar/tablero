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
 *
 * Aviso de actualización: con `skipWaiting` + `clientsClaim` el worker nuevo toma
 * el control solo, pero quien tiene la app abierta sigue con el código viejo. Al
 * detectar ese cambio de control (no la primera instalación) se muestra un aviso
 * fijo con «Recargar»; no se recarga solo para no perder una edición en curso.
 */

import { t } from '@/i18n';
import { toast } from '@/lib/toast';

export type PwaStatus = 'unsupported' | 'registered' | 'failed';

let status: PwaStatus = 'unsupported';

export function pwaStatus(): PwaStatus {
  return status;
}

const SW_URL = '/sw.js';

/** Cada cuánto se busca una versión nueva con la app abierta (1 h). */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Id del aviso: una segunda actualización no apila otro igual. */
export const UPDATE_TOAST_ID = 'pwa-update';

/** Lo mínimo de `navigator.serviceWorker` que hace falta (se puede simular). */
export type ServiceWorkerContainerLike = {
  controller: unknown;
  addEventListener(type: 'controllerchange', listener: () => void): void;
  removeEventListener(type: 'controllerchange', listener: () => void): void;
};

/**
 * Llama a `onUpdate` cuando un worker nuevo toma el control **después** de que la
 * página ya tuviera uno. Si no había controlador, el primer `controllerchange` es
 * la instalación inicial (`clientsClaim`) y no cuenta como actualización.
 * Devuelve la función que deja de escuchar.
 */
export function watchForUpdate(container: ServiceWorkerContainerLike, onUpdate: () => void): () => void {
  let hadController = container.controller != null;
  const onChange = (): void => {
    if (!hadController) {
      hadController = true;
      return;
    }
    onUpdate();
  };
  container.addEventListener('controllerchange', onChange);
  return () => container.removeEventListener('controllerchange', onChange);
}

/** Aviso fijo de «nueva versión» con el botón de recargar. */
export function showUpdateToast(): void {
  toast.info(t('pwa.updateAvailable'), {
    id: UPDATE_TOAST_ID,
    duration: null,
    action: { label: t('pwa.reload'), onClick: () => window.location.reload() },
  });
}

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
    watchForUpdate(navigator.serviceWorker, showUpdateToast);
    void navigator.serviceWorker
      .register(SW_URL, { scope: '/' })
      .then((registration) => {
        status = 'registered';
        // Una pestaña abierta días enteros no navega, así que el navegador no
        // vuelve a mirar el worker: se pregunta cada hora y al volver a la pestaña.
        const check = (): void => {
          void registration.update().catch(() => undefined);
        };
        setInterval(check, UPDATE_CHECK_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
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

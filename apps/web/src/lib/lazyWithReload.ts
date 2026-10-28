/**
 * Carga perezosa que sobrevive a una actualización de la app.
 *
 * Con `skipWaiting` el service worker nuevo toma el control enseguida, pero una
 * pestaña abierta sigue con el código viejo. Si pide un chunk que el despliegue
 * nuevo ya no tiene, el `import()` falla (404) y, sin más, `React.lazy` rompe el
 * árbol. Aquí ese fallo se convierte en el aviso fijo «Hay una nueva versión
 * disponible» con «Recargar» (el mismo que el de la actualización del service
 * worker, con su id, para que no se dupliquen) y la pieza se queda vacía.
 */

import { type ComponentType, type LazyExoticComponent, lazy } from 'react';

import { showUpdateToast } from '@/pwa/register';

/** Cualquier componente (lo exige `React.lazy`: sus props las conserva `T`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;

/** Mensajes de un `import()` dinámico que no pudo descargar el módulo. */
const CHUNK_ERROR_PATTERN =
  /(failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|loading chunk .* failed|loading css chunk)/i;

/** ¿El error es la descarga fallida de un chunk (y no un fallo del propio módulo)? */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ChunkLoadError') return true;
  return CHUNK_ERROR_PATTERN.test(error.message);
}

/** Módulo de reserva: el componente no pinta nada. */
function emptyModule<T extends AnyComponent>(): { default: T } {
  return { default: (() => null) as unknown as T };
}

/**
 * Ejecuta el cargador: si falla por un chunk que ya no existe, avisa con
 * `onStale` y devuelve un módulo cuyo componente no pinta nada; cualquier otro
 * error se propaga igual que sin esta función.
 */
export async function loadWithReload<T extends AnyComponent>(
  loader: () => Promise<{ default: T }>,
  onStale: () => void = showUpdateToast,
): Promise<{ default: T }> {
  try {
    return await loader();
  } catch (error) {
    if (!isChunkLoadError(error)) throw error;
    onStale();
    return emptyModule<T>();
  }
}

/** `React.lazy` que avisa de la nueva versión si el chunk ya no existe. */
export function lazyWithReload<T extends AnyComponent>(
  loader: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => loadWithReload(loader));
}

/**
 * Escucha `vite:preloadError` (Vite lo lanza cuando falla la precarga de un
 * chunk): evita que el error suba, y avisa de la nueva versión. Devuelve la
 * función que deja de escuchar.
 */
export function installPreloadErrorHandler(
  target: EventTarget = window,
  onStale: () => void = showUpdateToast,
): () => void {
  const onError = (event: Event): void => {
    event.preventDefault();
    onStale();
  };
  target.addEventListener('vite:preloadError', onError);
  return () => target.removeEventListener('vite:preloadError', onError);
}

/**
 * Carga perezosa tras una actualización: un chunk que ya no existe avisa de la
 * nueva versión en vez de romper el árbol.
 */

import { describe, expect, it, vi } from 'vitest';

import { installPreloadErrorHandler, isChunkLoadError, loadWithReload } from './lazyWithReload';

describe('isChunkLoadError', () => {
  it('reconoce los mensajes de Chrome, Safari y Firefox', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
  });

  it('reconoce un ChunkLoadError por su nombre', () => {
    const error = new Error('algo');
    error.name = 'ChunkLoadError';
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('no confunde un fallo del propio módulo con uno de descarga', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(isChunkLoadError(new ReferenceError('foo is not defined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('loadWithReload', () => {
  it('devuelve el módulo cuando la carga funciona y no avisa', async () => {
    const Component = () => null;
    const onStale = vi.fn();
    const module = await loadWithReload(async () => ({ default: Component }), onStale);
    expect(module.default).toBe(Component);
    expect(onStale).not.toHaveBeenCalled();
  });

  it('con un chunk que ya no existe avisa y devuelve un componente que no pinta nada', async () => {
    const onStale = vi.fn();
    const module = await loadWithReload(
      async () => {
        throw new TypeError('Failed to fetch dynamically imported module: /assets/Panel-abc.js');
      },
      onStale,
    );
    expect(onStale).toHaveBeenCalledTimes(1);
    expect((module.default as () => unknown)()).toBeNull();
  });

  it('propaga los errores que no son de descarga', async () => {
    const onStale = vi.fn();
    await expect(
      loadWithReload(async () => {
        throw new Error('el módulo falló al evaluarse');
      }, onStale),
    ).rejects.toThrow('el módulo falló');
    expect(onStale).not.toHaveBeenCalled();
  });
});

describe('installPreloadErrorHandler', () => {
  it('evita el error de Vite y muestra el aviso', () => {
    const target = new EventTarget();
    const onStale = vi.fn();
    const stop = installPreloadErrorHandler(target, onStale);
    const event = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onStale).toHaveBeenCalledTimes(1);
    stop();
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(onStale).toHaveBeenCalledTimes(1);
  });
});

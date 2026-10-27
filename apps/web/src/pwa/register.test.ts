import { describe, expect, it, vi } from 'vitest';

import { type ServiceWorkerContainerLike, watchForUpdate } from './register';

/** Contenedor simulado: permite disparar `controllerchange` a mano. */
function fakeContainer(controller: unknown): ServiceWorkerContainerLike & { fire(): void; listeners: number } {
  const listeners = new Set<() => void>();
  return {
    controller,
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    fire: () => listeners.forEach((listener) => listener()),
    get listeners() {
      return listeners.size;
    },
  };
}

describe('watchForUpdate', () => {
  it('con un worker ya activo, el cambio de control es una actualización', () => {
    const container = fakeContainer({});
    const onUpdate = vi.fn();
    watchForUpdate(container, onUpdate);
    container.fire();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    container.fire();
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('en la primera instalación (sin controlador) el primer cambio no avisa', () => {
    const container = fakeContainer(null);
    const onUpdate = vi.fn();
    watchForUpdate(container, onUpdate);
    container.fire(); // clientsClaim de la instalación inicial
    expect(onUpdate).not.toHaveBeenCalled();
    container.fire(); // una actualización posterior sí
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('devuelve la función que deja de escuchar', () => {
    const container = fakeContainer({});
    const onUpdate = vi.fn();
    const stop = watchForUpdate(container, onUpdate);
    expect(container.listeners).toBe(1);
    stop();
    expect(container.listeners).toBe(0);
    container.fire();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

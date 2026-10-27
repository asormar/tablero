/**
 * Avisos (toasts): store pequeño y API imperativa.
 *
 *   toast.success('Guardado');
 *   toast.error('No se pudo guardar', { duration: null });
 *   toast.info('Hay una nueva versión', { id: 'pwa-update', duration: null, action: { label: 'Recargar', onClick } });
 *
 * La cola, las duraciones y el tope viven en `toastQueue.ts` (lógica pura). El
 * componente `chrome/ToastHost` pinta la cola y reparte los avisos heredados de
 * `useAppStore.setNotice` (que entran como `info`, o `error` si el texto es un
 * fallo claro).
 */

import { create } from 'zustand';

import {
  type ToastItem,
  type ToastKind,
  type ToastOptions,
  existingToastId,
  pushToast,
  removeToast,
  toastDuration,
} from './toastQueue';

export type ToastState = {
  /** Cola visible, el aviso más nuevo primero. */
  toasts: ToastItem[];
  push(kind: ToastKind, message: string, options?: ToastOptions): string;
  dismiss(id: string): void;
  clear(): void;
};

let sequence = 0;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push(kind, message, options = {}) {
    sequence += 1;
    const id = options.id ?? existingToastId(get().toasts, kind, message) ?? `toast-${sequence}`;
    const item: ToastItem = {
      id,
      kind,
      message,
      duration: toastDuration(kind, options.duration),
      action: options.action,
      token: sequence,
    };
    set({ toasts: pushToast(get().toasts, item) });
    return id;
  },
  dismiss(id) {
    const next = removeToast(get().toasts, id);
    if (next !== get().toasts) set({ toasts: next });
  },
  clear() {
    if (get().toasts.length > 0) set({ toasts: [] });
  },
}));

export const toast = {
  success: (message: string, options?: ToastOptions): string => useToastStore.getState().push('success', message, options),
  error: (message: string, options?: ToastOptions): string => useToastStore.getState().push('error', message, options),
  info: (message: string, options?: ToastOptions): string => useToastStore.getState().push('info', message, options),
  dismiss: (id: string): void => useToastStore.getState().dismiss(id),
  clear: (): void => useToastStore.getState().clear(),
};

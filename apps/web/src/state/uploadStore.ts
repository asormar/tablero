/**
 * Subidas en curso.
 *
 * El progreso es estado de interfaz, no del documento: la tarjeta provisional
 * existe desde el primer momento en Yjs (con su posición y su nombre de archivo
 * pendiente) y aquí se guarda cuánto lleva subido. Al terminar, la tarjeta se
 * completa con `assetId` y estas entradas se descartan.
 */

import { create } from 'zustand';

import type { AssetKind, AssetSummary } from '@tablero/shared';

import { useAssetStore } from './assetStore';

export type UploadStatus = 'uploading' | 'ready' | 'error';

export type UploadEntry = {
  elementId: string;
  /** Nombre original (lo que se muestra mientras sube). */
  name: string;
  size: number;
  kind: AssetKind;
  /** 0..1 */
  progress: number;
  status: UploadStatus;
  error: string | null;
  startedAt: number;
};

export type UploadInit = Pick<UploadEntry, 'elementId' | 'name' | 'size' | 'kind'>;

type UploadState = {
  entries: Record<string, UploadEntry>;
  begin(init: UploadInit): void;
  setProgress(elementId: string, ratio: number): void;
  complete(elementId: string, asset: AssetSummary): void;
  fail(elementId: string, message: string): void;
  dismiss(elementId: string): void;
  reset(): void;
};

/** Cuánto se deja la entrada "lista" antes de borrarla (la tarjeta ya pinta sola). */
const READY_LINGER_MS = 1500;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useUploadStore = create<UploadState>()((set, get) => ({
  entries: {},

  begin(init) {
    set({
      entries: {
        ...get().entries,
        [init.elementId]: {
          ...init,
          progress: 0,
          status: 'uploading',
          error: null,
          startedAt: Date.now(),
        },
      },
    });
  },
  setProgress(elementId, ratio) {
    const current = get().entries[elementId];
    if (!current || current.status !== 'uploading') return;
    const progress = Math.max(current.progress, Math.max(0, Math.min(1, ratio)));
    if (progress === current.progress) return;
    set({ entries: { ...get().entries, [elementId]: { ...current, progress } } });
  },
  complete(elementId, asset) {
    const current = get().entries[elementId];
    if (!current) return;
    useAssetStore.getState().prime(asset);
    set({
      entries: {
        ...get().entries,
        [elementId]: { ...current, progress: 1, status: 'ready', error: null },
      },
    });
    const timer = timers.get(elementId);
    if (timer) clearTimeout(timer);
    timers.set(
      elementId,
      setTimeout(() => {
        timers.delete(elementId);
        get().dismiss(elementId);
      }, READY_LINGER_MS),
    );
  },
  fail(elementId, message) {
    const current = get().entries[elementId];
    if (!current) return;
    set({
      entries: { ...get().entries, [elementId]: { ...current, status: 'error', error: message } },
    });
  },
  dismiss(elementId) {
    const entries = { ...get().entries };
    delete entries[elementId];
    set({ entries });
  },
  reset() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    set({ entries: {} });
  },
}));

export function useUploadEntry(elementId: string | null | undefined): UploadEntry | null {
  return useUploadStore((state) => (elementId ? state.entries[elementId] ?? null : null));
}

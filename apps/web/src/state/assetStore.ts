/**
 * Metadatos de archivos (assets) en memoria.
 *
 * Las tarjetas necesitan nombre, tamaño, tipo y medidas de un `assetId`; la
 * subida devuelve esos datos y aquí se guardan para no volver a pedirlos. Si el
 * tablero se abre en otro equipo, la tarjeta los pide a `GET /api/assets/:id`.
 */

import { useEffect } from 'react';
import { create } from 'zustand';

import type { AssetSummary } from '@tablero/shared';

import { fetchAssetSummary } from '@/api/assets';

export type AssetStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export type AssetEntry = {
  status: AssetStatus;
  asset: AssetSummary | null;
  error?: string;
};

const EMPTY: AssetEntry = { status: 'idle', asset: null };

type AssetState = {
  entries: Record<string, AssetEntry>;
  /** Guarda los metadatos que ya vinieron en una respuesta (subida o detalle). */
  prime(asset: AssetSummary): void;
  /** Pide los metadatos si no se conocen todavía (una vez por id). */
  ensure(id: string): void;
  forget(id: string): void;
  reset(): void;
};

const inFlight = new Set<string>();

export const useAssetStore = create<AssetState>()((set, get) => ({
  entries: {},

  prime(asset) {
    set({ entries: { ...get().entries, [asset.id]: { status: 'ready', asset } } });
  },
  ensure(id) {
    if (!id || id.length === 0) return;
    const current = get().entries[id];
    if (current && current.status !== 'error') return;
    if (inFlight.has(id)) return;
    inFlight.add(id);
    set({ entries: { ...get().entries, [id]: { status: 'loading', asset: null } } });
    void fetchAssetSummary(id)
      .then((asset) => {
        set({
          entries: {
            ...get().entries,
            [id]: asset ? { status: 'ready', asset } : { status: 'missing', asset: null },
          },
        });
      })
      .catch((error: unknown) => {
        set({
          entries: {
            ...get().entries,
            [id]: {
              status: 'error',
              asset: null,
              error: error instanceof Error ? error.message : 'No se pudo leer el archivo',
            },
          },
        });
      })
      .finally(() => {
        inFlight.delete(id);
      });
  },
  forget(id) {
    const entries = { ...get().entries };
    delete entries[id];
    set({ entries });
  },
  reset() {
    inFlight.clear();
    set({ entries: {} });
  },
}));

/** Entrada de un archivo, pidiendo los metadatos la primera vez que se usa. */
export function useAsset(id: string | null | undefined): AssetEntry {
  const entry = useAssetStore((state) => (id ? state.entries[id] : undefined));
  const ensure = useAssetStore((state) => state.ensure);
  useEffect(() => {
    if (id) ensure(id);
  }, [id, ensure]);
  return entry ?? EMPTY;
}

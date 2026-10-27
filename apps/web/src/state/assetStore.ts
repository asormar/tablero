/**
 * Metadatos de archivos (assets) en memoria.
 *
 * Las tarjetas necesitan nombre, tamaño, tipo y medidas de un `assetId`; la
 * subida devuelve esos datos y aquí se guardan para no volver a pedirlos. Si el
 * tablero se abre en otro equipo, las tarjetas los piden juntos a
 * `GET /api/assets?ids=` (una petición por cada 100 archivos).
 */

import { useEffect } from 'react';
import { create } from 'zustand';

import type { AssetSummary } from '@tablero/shared';

import { ASSET_BATCH_SIZE, fetchAssetSummaries } from '@/api/assets';

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

/** Ids que ya se pidieron (en cola o en vuelo): `ensure` no los repite. */
const inFlight = new Set<string>();
/** Ids encolados en este instante; se piden juntos al vaciar la cola. */
const queue = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** Sube con cada `reset`: una respuesta de antes del reinicio no pisa el estado nuevo. */
let generation = 0;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushQueue();
  }, 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo leer el archivo';
}

/**
 * Pide los metadatos de todo lo encolado en el mismo tick, en lotes de
 * `ASSET_BATCH_SIZE`. Un tablero con cientos de imágenes pasa de una petición
 * por archivo a unas pocas, y el store se actualiza una vez por lote (no una vez
 * por archivo, que copiaba el registro entero en cada paso).
 */
function flushQueue(): void {
  const ids = [...queue];
  queue.clear();
  if (ids.length === 0) return;
  const startedIn = generation;

  useAssetStore.setState((state) => {
    const entries = { ...state.entries };
    for (const id of ids) entries[id] = { status: 'loading', asset: null };
    return { entries };
  });

  for (let index = 0; index < ids.length; index += ASSET_BATCH_SIZE) {
    const chunk = ids.slice(index, index + ASSET_BATCH_SIZE);
    void fetchAssetSummaries(chunk)
      .then((results) => {
        if (startedIn !== generation) return;
        useAssetStore.setState((state) => {
          const entries = { ...state.entries };
          for (const id of chunk) {
            const result = results.get(id);
            if (result && 'error' in result) {
              entries[id] = { status: 'error', asset: null, error: errorMessage(result.error) };
            } else if (result?.asset) {
              entries[id] = { status: 'ready', asset: result.asset };
            } else {
              entries[id] = { status: 'missing', asset: null };
            }
          }
          return { entries };
        });
      })
      .catch((error: unknown) => {
        // `fetchAssetSummaries` no lanza; esto solo cubre un fallo imprevisto.
        if (startedIn !== generation) return;
        useAssetStore.setState((state) => {
          const entries = { ...state.entries };
          for (const id of chunk) entries[id] = { status: 'error', asset: null, error: errorMessage(error) };
          return { entries };
        });
      })
      .finally(() => {
        if (startedIn !== generation) return;
        for (const id of chunk) inFlight.delete(id);
      });
  }
}

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
    queue.add(id);
    scheduleFlush();
  },
  forget(id) {
    const entries = { ...get().entries };
    delete entries[id];
    set({ entries });
  },
  reset() {
    generation += 1;
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    queue.clear();
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

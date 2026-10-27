/**
 * Store de metadatos de archivos: los `ensure` del mismo tick se piden juntos
 * (lotes de 100) y el store se actualiza una vez por lote, no una vez por
 * archivo. La capa HTTP se dobla: aquí solo importa cómo se agrupa y se aplica.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetSummary } from '@tablero/shared';

const api = vi.hoisted(() => ({
  fetchAssetSummaries: vi.fn<(ids: string[]) => Promise<Map<string, { asset: unknown } | { error: unknown }>>>(),
}));

vi.mock('@/api/assets', () => ({
  ASSET_BATCH_SIZE: 100,
  fetchAssetSummaries: api.fetchAssetSummaries,
}));

const { useAssetStore } = await import('./assetStore');

const summary = (id: string): AssetSummary => ({
  id,
  type: 'image',
  mime: 'image/png',
  size: 10,
  width: 1,
  height: 1,
  duration: null,
  originalName: `${id}.png`,
  createdAt: 1,
  url: `/api/assets/${id}/raw`,
  thumbnailUrl: `/api/assets/${id}/thumb`,
});

/** Respuesta del lote: todos existen salvo los ids de `missing`, y los de `failing` fallan. */
function answer(missing: string[] = [], failing: string[] = []) {
  return async (ids: string[]) =>
    new Map(
      ids.map((id) => [
        id,
        failing.includes(id)
          ? { error: new Error('sin red') }
          : { asset: missing.includes(id) ? null : summary(id) },
      ]),
    );
}

const ids = (count: number, prefix = 'a'): string[] => Array.from({ length: count }, (_, index) => `${prefix}${index}`);

/** Deja correr el temporizador de vaciado y las promesas del lote. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  api.fetchAssetSummaries.mockReset();
  useAssetStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('assetStore.ensure: peticiones por lotes', () => {
  it('agrupa los ids del mismo tick en una sola petición', async () => {
    api.fetchAssetSummaries.mockImplementation(answer());
    const { ensure } = useAssetStore.getState();

    ensure('a0');
    ensure('a1');
    ensure('a2');
    expect(api.fetchAssetSummaries).not.toHaveBeenCalled();
    await settle();

    expect(api.fetchAssetSummaries).toHaveBeenCalledTimes(1);
    expect(api.fetchAssetSummaries).toHaveBeenCalledWith(['a0', 'a1', 'a2']);
    const { entries } = useAssetStore.getState();
    expect(entries['a1']).toMatchObject({ status: 'ready', asset: { id: 'a1' } });
  });

  it('parte en lotes de 100', async () => {
    api.fetchAssetSummaries.mockImplementation(answer());
    for (const id of ids(250)) useAssetStore.getState().ensure(id);
    await settle();

    expect(api.fetchAssetSummaries.mock.calls.map(([chunk]) => chunk.length)).toEqual([100, 100, 50]);
    const { entries } = useAssetStore.getState();
    expect(Object.keys(entries)).toHaveLength(250);
    expect(Object.values(entries).every((entry) => entry.status === 'ready')).toBe(true);
  });

  it('actualiza el store una vez por lote (no una vez por archivo)', async () => {
    api.fetchAssetSummaries.mockImplementation(answer());
    let updates = 0;
    const unsubscribe = useAssetStore.subscribe(() => {
      updates += 1;
    });

    for (const id of ids(250)) useAssetStore.getState().ensure(id);
    await settle();
    unsubscribe();

    // 1 actualización marcando «cargando» + 1 por cada uno de los 3 lotes.
    expect(updates).toBe(4);
  });

  it('marca «cargando» al vaciar la cola y «missing» lo que el servidor no devuelve', async () => {
    let release: (() => void) | undefined;
    api.fetchAssetSummaries.mockImplementation(async (chunk) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return answer(['b'])(chunk);
    });

    useAssetStore.getState().ensure('a');
    useAssetStore.getState().ensure('b');
    await settle();
    expect(useAssetStore.getState().entries['a']).toMatchObject({ status: 'loading', asset: null });

    release?.();
    await settle();
    expect(useAssetStore.getState().entries['a']?.status).toBe('ready');
    expect(useAssetStore.getState().entries['b']).toEqual({ status: 'missing', asset: null });
  });

  it('un fallo de un id queda como `error` sin afectar a los demás del lote', async () => {
    api.fetchAssetSummaries.mockImplementation(answer([], ['b']));
    useAssetStore.getState().ensure('a');
    useAssetStore.getState().ensure('b');
    await settle();

    const { entries } = useAssetStore.getState();
    expect(entries['a']?.status).toBe('ready');
    expect(entries['b']).toMatchObject({ status: 'error', asset: null, error: 'sin red' });
  });

  it('no repite un id ya pedido (en cola, en vuelo o resuelto) y salta los ya conocidos', async () => {
    api.fetchAssetSummaries.mockImplementation(answer());
    const store = useAssetStore.getState();
    store.prime(summary('conocido'));

    store.ensure('a');
    store.ensure('a');
    store.ensure('conocido');
    store.ensure('');
    await settle();
    store.ensure('a'); // ya resuelto
    await settle();

    expect(api.fetchAssetSummaries).toHaveBeenCalledTimes(1);
    expect(api.fetchAssetSummaries).toHaveBeenCalledWith(['a']);
  });

  it('reintenta un id que falló la próxima vez que se pide', async () => {
    api.fetchAssetSummaries.mockImplementationOnce(answer([], ['a']));
    useAssetStore.getState().ensure('a');
    await settle();
    expect(useAssetStore.getState().entries['a']?.status).toBe('error');

    api.fetchAssetSummaries.mockImplementationOnce(answer());
    useAssetStore.getState().ensure('a');
    await settle();
    expect(useAssetStore.getState().entries['a']?.status).toBe('ready');
    expect(api.fetchAssetSummaries).toHaveBeenCalledTimes(2);
  });

  it('los ids que llegan en otro tick van en otra petición', async () => {
    api.fetchAssetSummaries.mockImplementation(answer());
    useAssetStore.getState().ensure('a');
    await settle();
    useAssetStore.getState().ensure('b');
    await settle();

    expect(api.fetchAssetSummaries.mock.calls.map(([chunk]) => chunk)).toEqual([['a'], ['b']]);
  });

  it('una respuesta anterior al `reset` no pisa el estado nuevo', async () => {
    let release: (() => void) | undefined;
    api.fetchAssetSummaries.mockImplementation(async (chunk) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return answer()(chunk);
    });

    useAssetStore.getState().ensure('a');
    await settle();
    useAssetStore.getState().reset();
    release?.();
    await settle();

    expect(useAssetStore.getState().entries).toEqual({});
  });
});

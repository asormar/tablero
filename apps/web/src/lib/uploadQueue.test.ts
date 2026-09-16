/**
 * Cola de subidas: cuatro en paralelo, todas informando del progreso y una
 * subida rota no cancela el resto.
 */

import { describe, expect, it } from 'vitest';

import { normalizeProgress, runUploadQueue, type QueueTask } from './uploadQueue';

type Probe = {
  id: string;
  /** Se resuelve cuando la prueba quiere dar por terminada la subida. */
  release: () => void;
  progress: number[];
  started: () => boolean;
};

function makeTasks(count: number): { tasks: QueueTask<string>[]; probes: Probe[] } {
  const probes: Probe[] = [];
  const tasks: QueueTask<string>[] = Array.from({ length: count }, (_, index) => {
    const id = `t${index}`;
    let release: () => void = () => undefined;
    let started = false;
    const progress: number[] = [];
    probes.push({ id, release: () => release(), progress, started: () => started });
    return {
      id,
      run: (report) => {
        started = true;
        report(0);
        return new Promise<string>((resolve) => {
          release = () => {
            report(1);
            resolve(id);
          };
        });
      },
    };
  });
  return { tasks, probes };
}

describe('runUploadQueue', () => {
  it('no abre más de cuatro subidas a la vez', async () => {
    const { tasks, probes } = makeTasks(20);
    const started: string[] = [];
    const report = runUploadQueue(tasks, {
      concurrency: 4,
      onDone: (id) => started.push(id),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    // Solo cuatro arrancaron: la quinta espera a que se libere una ranura.
    expect(probes.filter((probe) => probe.started())).toHaveLength(4);

    let released = 0;
    for (const probe of probes) {
      probe.release();
      released += 1;
      // Se libera de a uno: el pico de peticiones simultáneas nunca pasa de 4.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const result = await report;
    expect(released).toBe(20);
    expect(result.completed).toHaveLength(20);
    expect(result.failed).toHaveLength(0);
    expect(result.peakConcurrency).toBeLessThanOrEqual(4);
    expect(started).toHaveLength(20);
  });

  it('informa el progreso de cada archivo (0..1, sin retroceder)', async () => {
    const { tasks, probes } = makeTasks(2);
    const progressByTask = new Map<string, number[]>();
    const report = runUploadQueue(tasks, {
      concurrency: 2,
      onProgress: (id, ratio) => {
        const list = progressByTask.get(id) ?? [];
        list.push(ratio);
        progressByTask.set(id, list);
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const probe of probes) probe.release();
    await report;

    for (const probe of probes) {
      const values = progressByTask.get(probe.id) ?? [];
      expect(values[0]).toBe(0);
      expect(values[values.length - 1]).toBe(1);
      for (let index = 1; index < values.length; index += 1) {
        expect(values[index] ?? 0).toBeGreaterThanOrEqual(values[index - 1] ?? 0);
      }
    }
  });

  it('aísla los fallos: una subida rota no cancela las demás', async () => {
    const tasks: QueueTask<string>[] = [
      { id: 'ok1', run: async () => 'ok1' },
      {
        id: 'rota',
        run: async () => {
          throw new Error('sin red');
        },
      },
      { id: 'ok2', run: async () => 'ok2' },
    ];
    const errors: { id: string; message: string }[] = [];
    const result = await runUploadQueue(tasks, {
      concurrency: 2,
      onError: (id, error) => errors.push({ id, message: (error as Error).message }),
    });
    expect(result.completed.sort()).toEqual(['ok1', 'ok2']);
    expect(result.failed).toEqual(['rota']);
    expect(errors).toEqual([{ id: 'rota', message: 'sin red' }]);
  });

  it('una cola vacía no abre trabajadores', async () => {
    const result = await runUploadQueue([], { concurrency: 4 });
    expect(result).toEqual({ peakConcurrency: 0, completed: [], failed: [] });
  });

  it('normaliza el progreso fuera de rango', () => {
    expect(normalizeProgress(1.4)).toBe(1);
    expect(normalizeProgress(-0.2)).toBe(0);
    expect(normalizeProgress(Number.NaN)).toBe(0);
    expect(normalizeProgress(0.42)).toBeCloseTo(0.42);
  });
});

/**
 * Cola de subidas con concurrencia limitada (4 en paralelo por defecto).
 *
 * Soltar veinte imágenes a la vez no puede abrir veinte peticiones ni subirlas
 * de una en una: la cola mantiene ocupadas `concurrency` ranuras y arranca la
 * siguiente en cuanto una termina. Es lógica pura (recibe las tareas ya
 * construidas) para poder probar el paralelismo con dobles de prueba.
 */

export type QueueTask<T> = {
  id: string;
  /** Trabajo real: informa del progreso (0..1) y resuelve con el resultado. */
  run: (report: (ratio: number) => void) => Promise<T>;
};

export type QueueOptions<T> = {
  concurrency?: number;
  onProgress?: (id: string, ratio: number) => void;
  onDone?: (id: string, result: T) => void;
  onError?: (id: string, error: unknown) => void;
};

export type QueueReport = {
  /** Peticiones simultáneas máximas observadas (para la evidencia de pruebas). */
  peakConcurrency: number;
  completed: string[];
  failed: string[];
};

/** Limita un valor de progreso a 0..1 y lo redondea a porcentaje entero. */
export function normalizeProgress(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio));
}

/**
 * Ejecuta las tareas con concurrencia limitada. Nunca lanza: cada fallo se
 * aísla (una subida rota no cancela el resto del lote) y se informa por
 * `onError`.
 */
export async function runUploadQueue<T>(
  tasks: readonly QueueTask<T>[],
  options: QueueOptions<T> = {},
): Promise<QueueReport> {
  const limit = Math.max(1, Math.floor(options.concurrency ?? 4));
  const completed: string[] = [];
  const failed: string[] = [];
  let peakConcurrency = 0;
  let active = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const task = tasks[index];
      if (!task) return;

      active += 1;
      peakConcurrency = Math.max(peakConcurrency, active);
      try {
        const result = await task.run((ratio) => {
          options.onProgress?.(task.id, normalizeProgress(ratio));
        });
        completed.push(task.id);
        options.onDone?.(task.id, result);
      } catch (error) {
        failed.push(task.id);
        options.onError?.(task.id, error);
      } finally {
        active -= 1;
      }
    }
  };

  const workers = Math.min(limit, tasks.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return { peakConcurrency, completed, failed };
}

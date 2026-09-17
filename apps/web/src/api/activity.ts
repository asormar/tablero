/**
 * Actividad del tablero (punto 7 de la fase 5).
 *
 *   POST /boards/:id/activity ← { entries: [...] }  (lote, tope del servidor)
 *   GET  /boards/:id/activity?cursor=&limit= → { entries, nextCursor }
 *
 * El cliente **reporta sus acciones por lotes**: `reportActivity()` encola y un
 * temporizador vacía la cola (o al llegar al tope). La decisión es explícita: no
 * es una frontera de seguridad, es un registro para leer, así que si el envío
 * falla la acción se pierde sin romper nada (como mucho, un aviso la primera vez).
 */

import { type ActivityEntry, type ActivityAction, ACTIVITY_BATCH_LIMIT, parseActivityEntry } from '@/lib/activityView';

import { apiRequest } from './client';
import { degradationMessage } from './degraded';

export type ReportActivityInput = {
  action: ActivityAction;
  elementId?: string | null;
  elementType?: string | null;
  meta?: Record<string, unknown> | null;
};

type Queued = ReportActivityInput & { at: number };

const FLUSH_DELAY_MS = 2500;

/**
 * Enviador por lotes de un tablero. Vive fuera de React: cualquier superficie
 * (comandos del lienzo, comentarios, publicar) reporta y el envío se agrupa.
 */
export class ActivityReporter {
  private queue: Queued[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  private warned = false;
  private stopped = false;

  constructor(
    private readonly boardId: string,
    private readonly onNotice?: (message: string) => void,
    private readonly flushDelayMs = FLUSH_DELAY_MS,
  ) {}

  report(entry: ReportActivityInput): void {
    if (this.stopped) return;
    this.queue.push({ ...entry, at: Date.now() });
    if (this.queue.length >= ACTIVITY_BATCH_LIMIT) {
      void this.flush();
      return;
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushDelayMs);
  }

  async flush(): Promise<void> {
    if (this.stopped || this.sending || this.queue.length === 0) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.sending = true;
    const batch = this.queue.slice(0, ACTIVITY_BATCH_LIMIT);
    this.queue = this.queue.slice(batch.length);
    try {
      await apiRequest<unknown>(`/boards/${encodeURIComponent(this.boardId)}/activity`, {
        method: 'POST',
        body: { entries: batch.map(({ action, elementId, elementType, meta, at }) => ({
          action,
          elementId: elementId ?? null,
          elementType: elementType ?? null,
          meta: meta ?? null,
          at,
        })) },
      });
      this.warned = false;
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        this.onNotice?.(degradationMessage(error, 'Registro de actividad'));
      }
    } finally {
      this.sending = false;
      if (this.queue.length > 0) this.schedule();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
  }

  get pending(): number {
    return this.queue.length;
  }
}

const reporters = new Map<string, ActivityReporter>();

/** Reportador del tablero activo (se crea la primera vez que hace falta). */
export function activityReporterFor(
  boardId: string,
  onNotice?: (message: string) => void,
): ActivityReporter {
  let reporter = reporters.get(boardId);
  if (!reporter) {
    reporter = new ActivityReporter(boardId, onNotice);
    reporters.set(boardId, reporter);
  }
  return reporter;
}

/** Reporta una acción del tablero activo (nunca lanza). */
export function reportActivity(
  boardId: string | null,
  entry: ReportActivityInput,
  onNotice?: (message: string) => void,
): void {
  if (!boardId || boardId.startsWith('bd_')) return; // tablero local: no hay registro
  activityReporterFor(boardId, onNotice).report(entry);
}

/** Vacía lo pendiente (al cambiar de tablero o cerrar). */
export function flushActivity(boardId: string): void {
  void reporters.get(boardId)?.flush();
}

/** Historial del tablero, con paginación por cursor. */
export async function fetchBoardActivity(
  boardId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<{ entries: ActivityEntry[]; nextCursor: string | null }> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(boardId)}/activity`, {
    query: { cursor: options.cursor ?? undefined, limit: options.limit ?? 100 },
  });
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(record['entries'])
      ? (record['entries'] as unknown[])
      : [];
  return {
    entries: list.map(parseActivityEntry).filter((entry): entry is ActivityEntry => entry !== null),
    nextCursor: typeof record['nextCursor'] === 'string' ? record['nextCursor'] : null,
  };
}

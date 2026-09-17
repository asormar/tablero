/**
 * Registro de actividad: modelo de lectura y agrupación por día (punto 7).
 *
 * El cliente **reporta sus acciones por lotes** (`POST /api/boards/:id/activity`)
 * y esta vista las lee (`GET /api/boards/:id/activity`). Todo lo que hay acá es
 * proyección: agrupar por día, ordenar y describir cada entrada.
 */

export const ACTIVITY_ACTIONS = [
  'board.create',
  'board.rename',
  'board.publish',
  'board.unpublish',
  'element.create',
  'element.edit',
  'element.move',
  'element.delete',
  'element.restore',
  'comment.create',
  'comment.resolve',
  'comment.delete',
  'member.invite',
  'member.add',
  'member.role',
  'member.remove',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export type ActivityEntry = {
  id: string;
  boardId: string;
  userId: string;
  userName: string;
  action: ActivityAction | string;
  elementId: string | null;
  elementType: string | null;
  /** Texto corto del elemento (título o primera línea), si el servidor lo tiene. */
  label: string | null;
  createdAt: number;
};

/** Máximo de entradas por lote (coherente con el límite del API). */
export const ACTIVITY_BATCH_LIMIT = 50;

export type ActivityDayGroup = {
  /** `YYYY-MM-DD` en hora local (clave estable para React). */
  key: string;
  /** «Hoy», «Ayer» o la fecha larga. */
  label: string;
  entries: ActivityEntry[];
};

function dayKey(at: number): string {
  const date = new Date(at);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function activityDayLabel(key: string, now = Date.now()): string {
  const today = dayKey(now);
  const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
  if (key === today) return 'Hoy';
  if (key === yesterday) return 'Ayer';
  const [year, month, day] = key.split('-').map((part) => Number(part));
  if (!year || !month || !day) return key;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Agrupa por día (de hoy hacia atrás) y ordena cada grupo del más nuevo al más viejo. */
export function groupActivityByDay(entries: ActivityEntry[], now = Date.now()): ActivityDayGroup[] {
  const groups = new Map<string, ActivityEntry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.createdAt);
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([key, list]) => ({
      key,
      label: activityDayLabel(key, now),
      entries: [...list].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
    }));
}

const ACTION_LABELS: Record<string, string> = {
  'board.create': 'creó el tablero',
  'board.rename': 'cambió el título del tablero',
  'board.publish': 'publicó el tablero',
  'board.unpublish': 'dejó de publicar el tablero',
  'element.create': 'añadió',
  'element.edit': 'editó',
  'element.move': 'movió',
  'element.delete': 'borró',
  'element.restore': 'restauró',
  'comment.create': 'comentó',
  'comment.resolve': 'resolvió un hilo',
  'comment.delete': 'borró un comentario',
  'member.invite': 'invitó a alguien',
  'member.add': 'añadió un miembro',
  'member.role': 'cambió un rol',
  'member.remove': 'quitó un miembro',
};

const TYPE_LABELS: Record<string, string> = {
  note: 'una nota',
  heading: 'un encabezado',
  board: 'un tablero',
  image: 'una imagen',
  file: 'un archivo',
  link: 'un enlace',
  todo: 'una tarea',
  column: 'una columna',
  table: 'una tabla',
  sketch: 'un dibujo',
  map: 'un mapa',
  document: 'un documento',
  audio: 'un audio',
  video: 'un vídeo',
  swatch: 'un color',
};

/** «Ana añadió una nota "Compras"». */
export function describeActivity(entry: ActivityEntry): string {
  const verb = ACTION_LABELS[entry.action] ?? 'cambió algo';
  const type = entry.elementType ? (TYPE_LABELS[entry.elementType] ?? null) : null;
  const label = entry.label && entry.label.trim().length > 0 ? `«${entry.label.trim()}»` : null;
  const object = [type, label].filter(Boolean).join(' ');
  return object.length > 0 ? `${verb} ${object}` : verb;
}

export function activityActor(entry: ActivityEntry): string {
  return entry.userName.trim().length > 0 ? entry.userName : 'Alguien';
}

/** Hora corta del día (HH:MM) para la derecha de cada fila. */
export function activityTime(entry: ActivityEntry): string {
  return new Date(entry.createdAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Normaliza una entrada cruda del API. Devuelve `null` si no tiene lo mínimo
 * (un registro para leer: lo que no se entiende se descarta en vez de romper).
 */
export function parseActivityEntry(raw: unknown): ActivityEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'] : null;
  const createdAt = typeof record['createdAt'] === 'number' ? record['createdAt'] : null;
  if (!id || createdAt === null) return null;
  const user = (record['user'] ?? {}) as Record<string, unknown>;
  return {
    id,
    boardId: typeof record['boardId'] === 'string' ? record['boardId'] : '',
    userId:
      typeof record['userId'] === 'string'
        ? record['userId']
        : typeof user['id'] === 'string'
          ? user['id']
          : '',
    userName:
      typeof record['userName'] === 'string'
        ? record['userName']
        : typeof user['name'] === 'string'
          ? user['name']
          : '',
    action: typeof record['action'] === 'string' ? record['action'] : 'unknown',
    elementId: typeof record['elementId'] === 'string' ? record['elementId'] : null,
    elementType: typeof record['elementType'] === 'string' ? record['elementType'] : null,
    label: typeof record['label'] === 'string' ? record['label'] : null,
    createdAt,
  };
}

/**
 * Cola de reporte por lotes: agrupa acciones y las vacía contra la API.
 * Pura respecto al reloj y a la red (el envío lo inyecta el llamador) para
 * poder probarla: `plan.flush(now)` devuelve los lotes listos para enviar.
 */
export type QueuedActivity = {
  action: ActivityAction;
  elementId?: string | null;
  elementType?: string | null;
  meta?: Record<string, unknown> | null;
  at?: number;
};

export type ActivityBatchPlan = {
  /** Lotes (cada uno de hasta `limit` entradas) listos para enviar. */
  batches: QueuedActivity[][];
  /** Entradas que quedan en la cola tras el vaciado. */
  remaining: QueuedActivity[];
};

/** Parte la cola en lotes del tamaño máximo del API. */
export function planBatches(queue: QueuedActivity[], limit = ACTIVITY_BATCH_LIMIT): ActivityBatchPlan {
  const batches: QueuedActivity[][] = [];
  for (let index = 0; index < queue.length; index += limit) {
    batches.push(queue.slice(index, index + limit));
  }
  return { batches, remaining: [] };
}

/** Saca de la cola las entradas enviadas (por identidad, no por valor). */
export function dropSent(queue: QueuedActivity[], sent: QueuedActivity[]): QueuedActivity[] {
  const sentSet = new Set(sent);
  return queue.filter((entry) => !sentSet.has(entry));
}

/** Identidad estable de una acción: evita reactivar el reporte al repetirla. */
export function activityKey(entry: QueuedActivity): string {
  return `${entry.action}|${entry.elementId ?? ''}|${entry.at ?? 0}`;
}

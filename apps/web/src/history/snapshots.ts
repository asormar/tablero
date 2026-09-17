/**
 * Historial de versiones — partes puras (punto 4 de la fase 4).
 *
 * La API devuelve las instantáneas del tablero; acá se normaliza la forma
 * (tolerante a variantes) y se formatea la fecha para la lista. Todo lo que se
 * puede probar sin DOM ni red vive en este módulo.
 */

export type VersionSnapshot = {
  id: string;
  /** Marca de tiempo de la instantánea (ms). */
  createdAt: number;
  /** Título del tablero en ese momento (si el servidor lo guarda). */
  title: string;
  /** Cantidad de elementos de la instantánea. */
  elementCount: number;
  /** Tamaño del documento guardado, si viene. */
  sizeBytes: number | null;
};

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Acepta ISO-8601 o epoch (ms o s) y devuelve ms. */
export function toTimestamp(value: unknown): number | null {
  const numeric = asNumber(value);
  if (numeric !== null) {
    // Los segundos de Unix son < 10^11; los milisegundos, mucho mayores.
    return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toSnapshot(raw: unknown, fallbackTitle = ''): VersionSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id =
    typeof record['id'] === 'string'
      ? record['id']
      : typeof record['versionId'] === 'string'
        ? record['versionId']
        : null;
  if (!id) return null;
  const preview = (record['preview'] as Record<string, unknown> | undefined) ?? {};
  const createdAt =
    toTimestamp(record['createdAt'] ?? record['created_at'] ?? record['timestamp'] ?? record['snapshotAt']) ??
    Date.now();
  const title =
    typeof record['title'] === 'string'
      ? record['title']
      : typeof preview['title'] === 'string'
        ? preview['title']
        : fallbackTitle;
  const count =
    asNumber(record['elementCount'] ?? record['elements'] ?? preview['elementCount'] ?? preview['elements']) ?? 0;
  const size = asNumber(record['sizeBytes'] ?? record['size'] ?? record['bytes']);
  return { id, createdAt, title, elementCount: Math.max(0, Math.round(count)), sizeBytes: size };
}

/** Normaliza `{ versions }`, `{ snapshots }` o un array pelado, más nuevo primero. */
export function normalizeVersions(payload: unknown, fallbackTitle = ''): VersionSnapshot[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>)['versions'] ??
        (payload as Record<string, unknown>)['snapshots'] ??
        (payload as Record<string, unknown>)['items'])
      : null;
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => toSnapshot(raw, fallbackTitle))
    .filter((item): item is VersionSnapshot => item !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

const rtfCache = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(language: string): Intl.RelativeTimeFormat {
  let formatter = rtfCache.get(language);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    rtfCache.set(language, formatter);
  }
  return formatter;
}

/**
 * Fecha legible para la lista: hoy y ayer en relativo («hoy, 14:32»), el resto
 * como fecha corta. `now` se pasa en las pruebas; en producción es `Date.now()`.
 */
export function describeSnapshot(createdAt: number, language = 'es', now = Date.now()): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '—';
  const time = date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  const startOfDay = (value: Date): number =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return language === 'en' ? `today, ${time}` : `hoy, ${time}`;
  if (days === 1) return language === 'en' ? `yesterday, ${time}` : `ayer, ${time}`;
  if (days < 7) return relativeFormatter(language).format(-days, 'day');
  return date.toLocaleDateString(language, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Cambios que introduce una versión respecto de la siguiente más vieja. */
export function versionDelta(versions: VersionSnapshot[], index: number): number | null {
  const current = versions[index];
  const previous = versions[index + 1];
  if (!current || !previous) return null;
  return current.elementCount - previous.elementCount;
}

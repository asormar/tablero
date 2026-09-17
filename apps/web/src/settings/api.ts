/**
 * Ajustes y almacenamiento en la API (contrato de la fase 4):
 *
 *   GET    /settings          → { settings: {...} }
 *   PATCH  /settings          → { settings: {...} }
 *   GET    /storage           → { usedBytes, files, orphans: [...] }
 *   DELETE /storage/orphans   → { deleted }
 *
 * Todo degrada: si el endpoint todavía no existe, los llamantes reciben `null`
 * (o lanzan `ApiError`) y la interfaz lo informa sin romperse.
 */

import { apiRequest } from '@/api/client';

import { type AppSettings, normalizeSettings } from './settingsStore';

type RawSettings = Partial<AppSettings> & Record<string, unknown>;

/** Acepta `{ settings }`, `{ user: { settings } }` o el objeto pelado. */
export function extractSettings(payload: unknown): Partial<AppSettings> | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const nested = record['settings'] ?? (record['user'] as Record<string, unknown> | undefined)?.['settings'] ?? payload;
  if (!nested || typeof nested !== 'object') return null;
  return normalizeSettings(nested);
}

export async function fetchRemoteSettings(): Promise<Partial<AppSettings> | null> {
  const payload = await apiRequest<unknown>('/settings');
  return extractSettings(payload);
}

export async function patchRemoteSettings(patch: Partial<AppSettings>): Promise<Partial<AppSettings> | null> {
  const payload = await apiRequest<unknown>('/settings', { method: 'PATCH', body: patch });
  return extractSettings(payload);
}

export type StorageOrphan = {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: number | null;
};

export type StorageReport = {
  usedBytes: number;
  files: number;
  orphans: StorageOrphan[];
  /** La API no expone el reporte todavía. */
  unavailable: boolean;
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function toOrphan(raw: unknown): StorageOrphan | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'] : null;
  if (!id) return null;
  return {
    id,
    name: typeof record['name'] === 'string' ? record['name'] : id,
    sizeBytes: typeof record['sizeBytes'] === 'number' ? record['sizeBytes'] : 0,
    createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : null,
  };
}

export async function fetchStorage(): Promise<StorageReport> {
  const payload = await apiRequest<unknown>('/storage');
  const record = (payload ?? {}) as Record<string, unknown>;
  const orphans = Array.isArray(record['orphans']) ? record['orphans'] : [];
  return {
    usedBytes: typeof record['usedBytes'] === 'number' ? record['usedBytes'] : 0,
    files: typeof record['files'] === 'number' ? record['files'] : orphans.length,
    orphans: orphans.map(toOrphan).filter((item): item is StorageOrphan => item !== null),
    unavailable: false,
  };
}

export async function deleteOrphans(): Promise<number> {
  const payload = await apiRequest<unknown>('/storage/orphans', { method: 'DELETE' });
  const record = (payload ?? {}) as Record<string, unknown>;
  if (typeof record['deleted'] === 'number') return record['deleted'];
  if (typeof record['deletedOrphans'] === 'number') return record['deletedOrphans'];
  return 0;
}

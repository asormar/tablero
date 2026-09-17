/**
 * Historial de versiones en la API (contrato de la fase 4):
 *
 *   GET  /boards/:id/versions                → { versions: [{ id, createdAt, title, elementCount }] }
 *   POST /boards/:id/versions/:vid/restore   → { restored: true } | { board }
 *
 * El servidor guarda instantáneas en Postgres (una cada 10 minutos de actividad)
 * y al restaurar sustituye el estado persistido y cierra las conexiones del
 * tablero: los clientes reconectan y traen la versión restaurada.
 */

import { apiRequest } from '@/api/client';

import { type VersionSnapshot, normalizeVersions } from './snapshots';

export async function listBoardVersions(boardId: string, signal?: AbortSignal): Promise<VersionSnapshot[]> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(boardId)}/versions`, { signal });
  return normalizeVersions(payload);
}

/** Restaura una instantánea. Devuelve `true` si el servidor la aceptó. */
export async function restoreBoardVersion(boardId: string, versionId: string): Promise<boolean> {
  const payload = await apiRequest<unknown>(
    `/boards/${encodeURIComponent(boardId)}/versions/${encodeURIComponent(versionId)}/restore`,
    { method: 'POST', timeoutMs: 30_000 },
  );
  if (!payload || typeof payload !== 'object') return true;
  const record = payload as Record<string, unknown>;
  if (record['restored'] === false || record['ok'] === false) return false;
  return true;
}

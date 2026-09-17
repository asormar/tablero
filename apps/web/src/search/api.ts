/**
 * Cliente de la búsqueda global (contrato de la fase 4):
 *
 *   GET  /search?q=&type=&boardId=   → resultados agrupados por tablero
 *   POST /search/reindex             → reconstruye el índice del servidor
 *
 * La respuesta se normaliza a grupos para que la paleta no dependa de la forma
 * exacta (el índice pasó de ILIKE a `tsvector` en esta fase y el contrato admite
 * `results` plano o `groups`).
 */

import type { ElementType } from '@tablero/shared';

import { apiRequest } from '@/api/client';

export type RemoteHit = {
  boardId: string;
  boardTitle: string;
  elementId: string;
  elementType: string;
  snippet: string;
  /** Posición del elemento, si el servidor la manda (para centrar sin abrir). */
  x?: number;
  y?: number;
};

export type SearchGroup = {
  boardId: string;
  boardTitle: string;
  hits: RemoteHit[];
};

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toHit(raw: unknown): RemoteHit | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const boardId = typeof record['boardId'] === 'string' ? record['boardId'] : null;
  const elementId =
    typeof record['elementId'] === 'string'
      ? record['elementId']
      : typeof record['id'] === 'string'
        ? record['id']
        : boardId;
  if (!boardId || !elementId) return null;
  return {
    boardId,
    boardTitle: typeof record['boardTitle'] === 'string' ? record['boardTitle'] : '',
    elementId,
    elementType: typeof record['elementType'] === 'string' ? record['elementType'] : 'note',
    snippet: typeof record['snippet'] === 'string' ? record['snippet'] : '',
    x: asNumber(record['x']),
    y: asNumber(record['y']),
  };
}

/** Agrupa por tablero conservando el orden de llegada. */
export function groupHits(hits: RemoteHit[]): SearchGroup[] {
  const groups = new Map<string, SearchGroup>();
  for (const hit of hits) {
    let group = groups.get(hit.boardId);
    if (!group) {
      group = { boardId: hit.boardId, boardTitle: hit.boardTitle, hits: [] };
      groups.set(hit.boardId, group);
    }
    if (!group.boardTitle && hit.boardTitle) group.boardTitle = hit.boardTitle;
    group.hits.push(hit);
  }
  return [...groups.values()];
}

export type SearchRequest = {
  q: string;
  /** `'all'` se acepta por comodidad: se traduce a «sin filtro» al enviar. */
  type?: ElementType | 'board' | 'all' | null;
  boardId?: string | null;
  limit?: number;
  signal?: AbortSignal;
};

export async function searchRemote(input: SearchRequest): Promise<SearchGroup[]> {
  const payload = await apiRequest<unknown>('/search', {
    query: {
      q: input.q,
      type: input.type && input.type !== 'all' ? input.type : undefined,
      boardId: input.boardId ?? undefined,
      limit: input.limit ?? 30,
    },
    signal: input.signal,
  });
  return normalizeSearchPayload(payload);
}

/** Acepta `{ results }`, `{ groups }` o un array pelado. */
export function normalizeSearchPayload(payload: unknown): SearchGroup[] {
  if (Array.isArray(payload)) {
    return groupHits(payload.map(toHit).filter((hit): hit is RemoteHit => hit !== null));
  }
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record['groups'])) {
    const groups: SearchGroup[] = [];
    for (const raw of record['groups']) {
      if (!raw || typeof raw !== 'object') continue;
      const group = raw as Record<string, unknown>;
      const boardId = typeof group['boardId'] === 'string' ? group['boardId'] : null;
      if (!boardId) continue;
      const inner = Array.isArray(group['hits'])
        ? group['hits']
        : Array.isArray(group['results'])
          ? group['results']
          : [];
      const hits = inner
        // Las filas que no son objetos se descartan antes de normalizar: si no,
        // el relleno de `boardId` las convertiría en coincidencias del tablero.
        .filter((item): item is object => !!item && typeof item === 'object')
        .map((item) => toHit({ boardId, boardTitle: group['boardTitle'], ...item }))
        .filter((hit): hit is RemoteHit => hit !== null);
      groups.push({
        boardId,
        boardTitle: typeof group['boardTitle'] === 'string' ? group['boardTitle'] : '',
        hits,
      });
    }
    return groups.filter((group) => group.hits.length > 0);
  }
  if (Array.isArray(record['results'])) {
    return groupHits(record['results'].map(toHit).filter((hit): hit is RemoteHit => hit !== null));
  }
  return [];
}

/** Reconstruye el índice del servidor; devuelve cuántos documentos indexó. */
export async function reindexSearch(): Promise<number> {
  const payload = await apiRequest<unknown>('/search/reindex', { method: 'POST', timeoutMs: 120_000 });
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['indexed', 'count', 'documents', 'boards']) {
      const value = record[key];
      if (typeof value === 'number') return value;
    }
  }
  return 0;
}

/**
 * Capa tipada sobre las rutas de tableros de la API REST.
 *
 * Contrato asumido (fase 1):
 *   GET    /auth/me                → { user, boards }
 *   GET    /boards?filter=…        → BoardSummary[]
 *   POST   /boards                 → { board }
 *   GET    /boards/:id             → { board, breadcrumbs }
 *   PATCH  /boards/:id             → { board }
 *   DELETE /boards/:id             → 204
 *   POST   /boards/:id/move        → { board }
 *   POST   /boards/:id/duplicate   → { board }
 *   GET    /boards/:id/breadcrumbs → BoardSummary[]
 *   GET    /boards/:id/children    → BoardSummary[]
 *   GET    /boards/:id/document    → { state, updatedAt }
 */

import type { BoardSummary } from '@tablero/shared';

import { apiRequest } from './client';

export type BoardFilter = 'recent' | 'favorites' | 'shared' | 'trash';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export type MeResponse = { user: SessionUser; boards: BoardSummary[] };

export type BoardResponse = { board: BoardSummary; breadcrumbs?: BoardSummary[] };

export type BoardDocumentResponse = {
  /** Estado Yjs serializado en base64. */
  state: string;
  updatedAt: number | null;
};

export type CreateBoardInput = {
  title: string;
  parentBoardId?: string | null;
  icon?: string | null;
  color?: string | null;
};

export type UpdateBoardInput = {
  title?: string;
  icon?: string | null;
  color?: string | null;
  parentBoardId?: string | null;
};

/** Normaliza lo que devuelve la API a un `BoardSummary` completo. */
function toBoard(raw: Partial<BoardSummary> & { id: string }): BoardSummary {
  return {
    ownerId: '',
    parentBoardId: null,
    title: 'Sin título',
    icon: null,
    color: null,
    coverImageId: null,
    isTemplate: false,
    publishedSlug: null,
    trashedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...raw,
  };
}

function extractBoards(payload: unknown): BoardSummary[] {
  if (Array.isArray(payload)) {
    return payload
      .filter((item): item is { id: string } => !!item && typeof item === 'object' && 'id' in item)
      .map((item) => toBoard(item as Partial<BoardSummary> & { id: string }));
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record['boards'])) return extractBoards(record['boards']);
  }
  return [];
}

function extractBoard(payload: unknown): BoardSummary {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const nested = record['board'] ?? payload;
    if (nested && typeof nested === 'object' && 'id' in (nested as Record<string, unknown>)) {
      return toBoard(nested as Partial<BoardSummary> & { id: string });
    }
  }
  throw new Error('Respuesta de tablero inesperada');
}

export async function fetchMe(): Promise<MeResponse> {
  const payload = await apiRequest<unknown>('/auth/me');
  const record = (payload ?? {}) as Record<string, unknown>;
  const user = record['user'] as SessionUser | undefined;
  return {
    user: user ?? { id: 'local', email: '', name: 'Local' },
    boards: extractBoards(record['boards']),
  };
}

export async function login(input: { email: string; password: string }): Promise<MeResponse> {
  const payload = await apiRequest<unknown>('/auth/login', { method: 'POST', body: input });
  const record = (payload ?? {}) as Record<string, unknown>;
  return {
    user: (record['user'] as SessionUser | undefined) ?? { id: 'local', email: input.email, name: 'Local' },
    boards: extractBoards(record['boards']),
  };
}

export async function register(input: {
  email: string;
  name: string;
  password: string;
}): Promise<MeResponse> {
  const payload = await apiRequest<unknown>('/auth/register', { method: 'POST', body: input });
  const record = (payload ?? {}) as Record<string, unknown>;
  return {
    user: (record['user'] as SessionUser | undefined) ?? { id: 'local', email: input.email, name: input.name },
    boards: extractBoards(record['boards']),
  };
}

export async function logout(): Promise<void> {
  await apiRequest<void>('/auth/logout', { method: 'POST' });
}

export async function listBoards(filter: BoardFilter = 'recent'): Promise<BoardSummary[]> {
  return extractBoards(await apiRequest<unknown>('/boards', { query: { filter } }));
}

export async function getBoard(id: string): Promise<BoardResponse> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(id)}`);
  const record = (payload ?? {}) as Record<string, unknown>;
  return {
    board: extractBoard(payload),
    breadcrumbs: record['breadcrumbs'] ? extractBoards(record['breadcrumbs']) : undefined,
  };
}

export async function createBoard(input: CreateBoardInput): Promise<BoardSummary> {
  const payload = await apiRequest<unknown>('/boards', { method: 'POST', body: input });
  return extractBoard(payload);
}

export async function updateBoard(id: string, patch: UpdateBoardInput): Promise<BoardSummary> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  });
  return extractBoard(payload);
}

export async function deleteBoard(id: string): Promise<void> {
  await apiRequest<void>(`/boards/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function moveBoard(id: string, parentBoardId: string | null): Promise<BoardSummary> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(id)}/move`, {
    method: 'POST',
    body: { parentBoardId },
  });
  return extractBoard(payload);
}

export async function duplicateBoard(id: string): Promise<BoardSummary> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
  });
  return extractBoard(payload);
}

export async function fetchBreadcrumbs(id: string): Promise<BoardSummary[]> {
  return extractBoards(await apiRequest<unknown>(`/boards/${encodeURIComponent(id)}/breadcrumbs`));
}

export async function fetchChildren(id: string): Promise<BoardSummary[]> {
  return extractBoards(await apiRequest<unknown>(`/boards/${encodeURIComponent(id)}/children`));
}

export async function fetchBoardDocument(id: string): Promise<BoardDocumentResponse | null> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(id)}/document`);
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const state = record['state'];
  if (typeof state !== 'string' || state.length === 0) return null;
  const updatedAt = typeof record['updatedAt'] === 'number' ? record['updatedAt'] : null;
  return { state, updatedAt };
}

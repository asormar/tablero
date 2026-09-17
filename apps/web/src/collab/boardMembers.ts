/**
 * Miembros del tablero vistos desde la web (fase 5).
 *
 * La API es la autoridad (`GET /boards/:id/members`, solo el dueño ve emails y
 * roles de otros). Este módulo cachea la última respuesta buena por tablero
 * —el autocompletado de menciones y el panel de comentarios la piden a cada
 * rato— y **degrada con aviso** cuando el endpoint todavía no existe: sin lista
 * de miembros, el autocompletado de menciones solo ofrece a uno mismo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { type BoardMember, listMembers } from '@/api/sharing';
import { degradationMessage, isMissingEndpoint } from '@/api/degraded';

export type MembersSnapshot = {
  members: BoardMember[];
  /** La API todavía no expone el endpoint (o no hay sesión). */
  missing: boolean;
  error: string | null;
  loadedAt: number;
};

const CACHE_TTL_MS = 30_000;

const cache = new Map<string, MembersSnapshot>();
const inflight = new Map<string, Promise<MembersSnapshot>>();

export async function loadMembers(boardId: string, ownerId?: string | null): Promise<MembersSnapshot> {
  const cached = cache.get(boardId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;
  const pending = inflight.get(boardId);
  if (pending) return pending;

  const request = (async (): Promise<MembersSnapshot> => {
    try {
      const members = await listMembers(boardId, ownerId);
      const snapshot: MembersSnapshot = { members, missing: false, error: null, loadedAt: Date.now() };
      cache.set(boardId, snapshot);
      return snapshot;
    } catch (error) {
      const snapshot: MembersSnapshot = {
        members: cached?.members ?? [],
        missing: isMissingEndpoint(error),
        error: degradationMessage(error, 'Miembros del tablero'),
        loadedAt: cached?.loadedAt ?? 0,
      };
      cache.set(boardId, snapshot);
      return snapshot;
    } finally {
      inflight.delete(boardId);
    }
  })();

  inflight.set(boardId, request);
  return request;
}

/** Invalida la caché (tras invitar, cambiar un rol o expulsar a alguien). */
export function invalidateMembers(boardId: string): void {
  cache.delete(boardId);
}

export type UseBoardMembersResult = {
  members: BoardMember[];
  loading: boolean;
  missing: boolean;
  error: string | null;
  reload: () => void;
};

export function useBoardMembers(
  boardId: string | null,
  options: { ownerId?: string | null; enabled?: boolean } = {},
): UseBoardMembersResult {
  const { ownerId = null, enabled = true } = options;
  const [snapshot, setSnapshot] = useState<MembersSnapshot | null>(boardId ? cache.get(boardId) ?? null : null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!boardId || !enabled) {
      setSnapshot(boardId ? cache.get(boardId) ?? null : null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadMembers(boardId, ownerId)
      .then((next) => {
        if (cancelled || !mounted.current) return;
        setSnapshot(next);
      })
      .finally(() => {
        if (!cancelled && mounted.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, ownerId, enabled, reloadToken]);

  const reload = useCallback(() => {
    if (boardId) invalidateMembers(boardId);
    setReloadToken((token) => token + 1);
  }, [boardId]);

  return {
    members: snapshot?.members ?? [],
    loading,
    missing: snapshot?.missing ?? false,
    error: snapshot?.error ?? null,
    reload,
  };
}

/** Candidatos para el autocompletado de `@` (nombre + email). */
export function mentionCandidates(members: BoardMember[]): { userId: string; name: string; email: string }[] {
  return members.map((member) => ({ userId: member.userId, name: member.name, email: member.email }));
}

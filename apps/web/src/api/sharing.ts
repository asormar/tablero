/**
 * Compartir y publicar (puntos 1 y 2 de la fase 5).
 *
 * Contrato que consume este módulo (lo implementa el API):
 *
 *   GET    /boards/:id/members              → { members: Member[] }
 *   POST   /boards/:id/members              ← { email, role }  → { member }
 *   PATCH  /boards/:id/members/:userId      ← { role }          → { member }
 *   DELETE /boards/:id/members/:userId      → 204
 *   GET    /boards/:id/invitations          → { invitations: Invitation[] }
 *   POST   /boards/:id/invitations          ← { email, role, expiresInDays } → { invitation }
 *   DELETE /invitations/:id                 → 204
 *   GET    /invitations/:token              → { invitation, board }
 *   POST   /invitations/:token/accept       → { board, role }
 *   POST   /boards/:id/publish              ← { password?, includeSubBoards? } → { publication }
 *   DELETE /boards/:id/publish              → { board }
 *   GET    /public/boards/:slug[?password=] → { board, boards, requiresPassword }
 *   GET    /public/boards/:slug/document[?password=] → { state, updatedAt }
 *   GET    /boards/:id/presence             → { users: PresenceUser[] }
 *
 * Todo el parseo es defensivo: si un campo no viene, se usa un valor neutro en
 * vez de romper el render, y las rutas que falten se degradan con aviso.
 */

import { type BoardRole, type BoardSummary, type EffectiveRole } from '@tablero/shared';

import { apiRequest } from './client';

export type BoardMember = {
  userId: string;
  email: string;
  name: string;
  role: EffectiveRole;
  /** `userId` del dueño del tablero: no se puede cambiar ni expulsar. */
  isOwner: boolean;
  invitedBy: string | null;
  createdAt: number | null;
};

export type Invitation = {
  id: string;
  email: string;
  role: BoardRole;
  token: string;
  expiresAt: number | null;
  acceptedAt: number | null;
  createdAt: number | null;
};

export type Publication = {
  slug: string;
  url: string | null;
  includeSubBoards: boolean;
  hasPassword: boolean;
  publishedAt: number | null;
};

export type PublicBoard = {
  slug: string;
  title: string;
  icon: string | null;
  color: string | null;
  includeSubBoards: boolean;
  requiresPassword: boolean;
  /** Subtableros publicados (vacíos si el ajuste no los incluye). */
  children: { slug: string; title: string; icon: string | null }[];
  updatedAt: number | null;
};

export type PresenceUser = { userId: string; name: string; color: string | null; lastSeenAt: number | null };

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function nested(payload: unknown, key: string): unknown {
  const record = asRecord(payload);
  return record[key] ?? payload;
}

function parseRoleValue(value: unknown): EffectiveRole {
  const role = asString(value);
  if (role === 'owner' || role === 'editor' || role === 'commenter' || role === 'viewer') return role;
  return 'viewer';
}

export function parseMember(raw: unknown, ownerId?: string | null): BoardMember | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = asRecord(raw);
  const userId = asString(record['userId']) ?? asString(record['id']);
  if (!userId) return null;
  const user = asRecord(record['user']);
  const role = parseRoleValue(record['role']);
  return {
    userId,
    email: asString(record['email']) ?? asString(user['email']) ?? '',
    name: asString(record['name']) ?? asString(user['name']) ?? asString(record['email']) ?? 'Miembro',
    role,
    isOwner: record['isOwner'] === true || (!!ownerId && userId === ownerId) || role === 'owner',
    invitedBy: asString(record['invitedBy']),
    createdAt: asNumber(record['createdAt']),
  };
}

function parseMembers(payload: unknown, ownerId?: string | null): BoardMember[] {
  const list = Array.isArray(payload) ? payload : (nested(payload, 'members') as unknown[] | undefined);
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => parseMember(item, ownerId))
    .filter((member): member is BoardMember => member !== null);
}

function parseInvitation(raw: unknown): Invitation | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = asRecord(raw);
  const id = asString(record['id']);
  const token = asString(record['token']);
  if (!id || !token) return null;
  return {
    id,
    email: asString(record['email']) ?? '',
    role: (parseRoleValue(record['role']) === 'owner' ? 'editor' : parseRoleValue(record['role'])) as BoardRole,
    token,
    expiresAt: asNumber(record['expiresAt']),
    acceptedAt: asNumber(record['acceptedAt']),
    createdAt: asNumber(record['createdAt']),
  };
}

function parseInvitations(payload: unknown): Invitation[] {
  const list = Array.isArray(payload) ? payload : (nested(payload, 'invitations') as unknown[] | undefined);
  if (!Array.isArray(list)) return [];
  return list.map(parseInvitation).filter((item): item is Invitation => item !== null);
}

export async function listMembers(boardId: string, ownerId?: string | null): Promise<BoardMember[]> {
  return parseMembers(await apiRequest<unknown>(`/boards/${encodeURIComponent(boardId)}/members`), ownerId);
}

export async function addMember(boardId: string, email: string, role: BoardRole): Promise<BoardMember> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(boardId)}/members`, {
    method: 'POST',
    body: { email, role },
  });
  const member = parseMember(nested(payload, 'member'));
  if (!member) throw new Error('La API no devolvió el miembro creado');
  return member;
}

export async function updateMemberRole(
  boardId: string,
  userId: string,
  role: BoardRole,
): Promise<BoardMember> {
  const payload = await apiRequest<unknown>(
    `/boards/${encodeURIComponent(boardId)}/members/${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: { role } },
  );
  const member = parseMember(nested(payload, 'member'));
  if (!member) throw new Error('La API no devolvió el miembro actualizado');
  return member;
}

export async function removeMember(boardId: string, userId: string): Promise<void> {
  await apiRequest<void>(`/boards/${encodeURIComponent(boardId)}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export async function listInvitations(boardId: string): Promise<Invitation[]> {
  return parseInvitations(await apiRequest<unknown>(`/boards/${encodeURIComponent(boardId)}/invitations`));
}

export async function createInvitation(
  boardId: string,
  input: { email: string; role: BoardRole; expiresInDays?: number },
): Promise<Invitation> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(boardId)}/invitations`, {
    method: 'POST',
    body: {
      email: input.email,
      role: input.role,
      expiresInDays: input.expiresInDays ?? 7,
    },
  });
  const invitation = parseInvitation(nested(payload, 'invitation'));
  if (!invitation) throw new Error('La API no devolvió la invitación creada');
  return invitation;
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  await apiRequest<void>(`/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' });
}

export type InvitationPreview = {
  invitation: { email: string; role: BoardRole; expiresAt: number | null; acceptedAt: number | null };
  board: { id: string; title: string; icon: string | null } | null;
};

export async function fetchInvitation(token: string): Promise<InvitationPreview> {
  const payload = await apiRequest<unknown>(`/invitations/${encodeURIComponent(token)}`);
  const record = asRecord(nested(payload, 'invitation'));
  const boardRecord = asRecord(asRecord(payload)['board']);
  return {
    invitation: {
      email: asString(record['email']) ?? '',
      role: (parseRoleValue(record['role']) === 'owner' ? 'editor' : parseRoleValue(record['role'])) as BoardRole,
      expiresAt: asNumber(record['expiresAt']),
      acceptedAt: asNumber(record['acceptedAt']),
    },
    board: asString(boardRecord['id'])
      ? {
          id: boardRecord['id'] as string,
          title: asString(boardRecord['title']) ?? 'Tablero',
          icon: asString(boardRecord['icon']),
        }
      : null,
  };
}

export async function acceptInvitation(token: string): Promise<{ board: BoardSummary | null; role: EffectiveRole }> {
  const payload = await apiRequest<unknown>(`/invitations/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
  });
  const record = asRecord(payload);
  const boardRecord = asRecord(record['board']);
  return {
    board: asString(boardRecord['id']) ? (boardRecord as unknown as BoardSummary) : null,
    role: parseRoleValue(record['role']),
  };
}

// --- Publicar ---------------------------------------------------------------

function parsePublication(payload: unknown): Publication {
  const record = asRecord(nested(payload, 'publication'));
  const board = asRecord(asRecord(payload)['board']);
  const slug =
    asString(record['slug']) ?? asString(board['publishedSlug']) ?? asString(asRecord(payload)['slug']) ?? '';
  return {
    slug,
    url: asString(record['url']) ?? asString(record['publicUrl']),
    includeSubBoards:
      record['includeSubBoards'] === true ||
      record['includeSubBoards'] === undefined ||
      board['publicIncludeSubBoards'] === true,
    hasPassword: record['hasPassword'] === true || Boolean(asString(record['password'])),
    publishedAt: asNumber(record['publishedAt']) ?? asNumber(board['publishedAt']),
  };
}

export async function publishBoard(
  boardId: string,
  input: { password?: string | null; includeSubBoards: boolean },
): Promise<Publication> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(boardId)}/publish`, {
    method: 'POST',
    body: {
      ...(input.password && input.password.length > 0 ? { password: input.password } : {}),
      includeSubBoards: input.includeSubBoards,
    },
  });
  return parsePublication(payload);
}

export async function unpublishBoard(boardId: string): Promise<void> {
  await apiRequest<void>(`/boards/${encodeURIComponent(boardId)}/publish`, { method: 'DELETE' });
}

export function parsePublicBoard(payload: unknown): PublicBoard | null {
  const record = asRecord(nested(payload, 'board'));
  const slug = asString(record['slug']) ?? asString(record['publicSlug']);
  if (!slug) return null;
  const childrenRaw = asRecord(payload)['boards'] ?? asRecord(payload)['children'];
  const children = Array.isArray(childrenRaw)
    ? childrenRaw
        .map((item) => {
          const child = asRecord(item);
          const childSlug = asString(child['slug']) ?? asString(child['publicSlug']);
          if (!childSlug) return null;
          return {
            slug: childSlug,
            title: asString(child['title']) ?? 'Tablero',
            icon: asString(child['icon']),
          };
        })
        .filter((item): item is { slug: string; title: string; icon: string | null } => item !== null)
    : [];
  return {
    slug,
    title: asString(record['title']) ?? 'Tablero',
    icon: asString(record['icon']),
    color: asString(record['color']),
    includeSubBoards: record['includeSubBoards'] !== false,
    requiresPassword: record['requiresPassword'] === true,
    children,
    updatedAt: asNumber(record['updatedAt'] ?? record['publishedAt']),
  };
}

export async function fetchPublicBoard(slug: string, password?: string): Promise<PublicBoard> {
  const payload = await apiRequest<unknown>(`/public/boards/${encodeURIComponent(slug)}`, {
    query: password ? { password } : undefined,
  });
  const parsed = parsePublicBoard(payload);
  if (!parsed) throw new Error('La API no devolvió el tablero público');
  return parsed;
}

export async function fetchPublicDocument(
  slug: string,
  password?: string,
): Promise<{ state: string; updatedAt: number | null } | null> {
  const payload = await apiRequest<unknown>(`/public/boards/${encodeURIComponent(slug)}/document`, {
    query: password ? { password } : undefined,
  });
  const record = asRecord(payload);
  const state = asString(record['state']);
  if (!state) return null;
  return { state, updatedAt: asNumber(record['updatedAt']) };
}

// --- Presencia sin socket ---------------------------------------------------

export async function fetchPresence(boardId: string): Promise<PresenceUser[]> {
  const payload = await apiRequest<unknown>(`/boards/${encodeURIComponent(boardId)}/presence`);
  const list = Array.isArray(payload) ? payload : (asRecord(payload)['users'] as unknown[] | undefined);
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const record = asRecord(item);
      const user = asRecord(record['user']);
      const userId = asString(record['userId']) ?? asString(user['id']);
      if (!userId) return null;
      return {
        userId,
        name: asString(record['name']) ?? asString(user['name']) ?? 'Alguien',
        color: asString(record['color']) ?? asString(user['color']),
        lastSeenAt: asNumber(record['lastSeenAt']),
      };
    })
    .filter((item): item is PresenceUser => item !== null);
}

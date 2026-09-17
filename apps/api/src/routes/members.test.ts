/**
 * Miembros e invitaciones (fase 5).
 *
 * Prisma en memoria y sesión configurable: se prueba la gestión por roles
 * (solo el dueño), el alta directa, la invitación con caducidad, la vista de la
 * invitación (email enmascarado salvo para su dueño) y la aceptación
 * (caducada, ya aceptada, de otro email).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { formatZodError } from '@tablero/shared';

import { HttpError } from '../lib/errors.js';

type BoardRole = 'viewer' | 'commenter' | 'editor';
type BoardRow = {
  id: string;
  ownerId: string;
  parentBoardId: string | null;
  title: string;
  icon: string | null;
  color: string | null;
  coverImageId: string | null;
  isTemplate: boolean;
  publishedSlug: string | null;
  publishedPasswordHash: string | null;
  publishedAt: Date | null;
  publicIncludeSubBoards: boolean;
  trashedAt: Date | null;
  favoriteAt: Date | null;
  isUnsorted: boolean;
  createdAt: Date;
  updatedAt: Date;
};
type MemberRow = { id: string; boardId: string; userId: string; role: BoardRole; invitedById: string | null; createdAt: Date; updatedAt: Date };
type UserRow = { id: string; email: string; name: string; avatarUrl: string | null };
type InvitationRow = {
  id: string;
  boardId: string;
  email: string;
  role: BoardRole;
  token: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedById: string | null;
  invitedById: string;
  createdAt: Date;
};

const db = vi.hoisted(() => {
  const boards = new Map<string, BoardRow>();
  const users = new Map<string, UserRow>();
  const members = new Map<string, MemberRow>();
  const invitations = new Map<string, InvitationRow>();
  const notifications: { id: string; userId: string; kind: string; dedupeKey: string | null; [key: string]: unknown }[] = [];
  const emails: { to: string; subject: string; text: string; url?: string }[] = [];
  let counter = 0;

  const board = (id: string, overrides: Partial<BoardRow> = {}): BoardRow => {
    const now = new Date();
    const row: BoardRow = {
      id,
      ownerId: 'user_ana',
      parentBoardId: null,
      title: overrides.title ?? id,
      icon: null,
      color: null,
      coverImageId: null,
      isTemplate: false,
      publishedSlug: null,
      publishedPasswordHash: null,
      publishedAt: null,
      publicIncludeSubBoards: false,
      trashedAt: null,
      favoriteAt: null,
      isUnsorted: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    boards.set(id, row);
    return row;
  };

  const member = (boardId: string, userId: string, role: BoardRole, invitedById: string | null = null): MemberRow => {
    const row: MemberRow = {
      id: `mem_${++counter}`,
      boardId,
      userId,
      role,
      invitedById,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    members.set(`${boardId}:${userId}`, row);
    return row;
  };

  const withUser = (row: MemberRow) => ({ ...row, user: users.get(row.userId) ?? { id: row.userId, email: `${row.userId}@test`, name: row.userId, avatarUrl: null } });

  const prisma = {
    board: {
      findMany: async () => [...boards.values()].map((row) => ({ ...row })),
      findUnique: async ({ where }: { where: { id?: string } }) => {
        const row = where.id ? boards.get(where.id) : [...boards.values()].find((candidate) => candidate.id === where.id);
        if (!row) return null;
        return { ...row, owner: users.get(row.ownerId) ?? null };
      },
    },
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
        const rows = [...users.values()];
        if (where.email) return rows.find((user) => user.email === where.email) ?? null;
        return rows.find((user) => user.id === where.id) ?? null;
      },
    },
    boardMember: {
      findMany: async ({ where }: { where: { boardId?: string; userId?: string } }) => {
        let rows = [...members.values()];
        if (where.boardId) rows = rows.filter((row) => row.boardId === where.boardId);
        if (where.userId) rows = rows.filter((row) => row.userId === where.userId);
        return rows.map(withUser);
      },
      findUnique: async ({ where }: { where: { boardId_userId: { boardId: string; userId: string } } }) => {
        const row = members.get(`${where.boardId_userId.boardId}:${where.boardId_userId.userId}`);
        return row ? withUser(row) : null;
      },
      create: async ({ data }: { data: { boardId: string; userId: string; role: BoardRole; invitedById?: string | null } }) =>
        member(data.boardId, data.userId, data.role, data.invitedById ?? null),
      update: async ({ where, data }: { where: { id: string }; data: { role: BoardRole } }) => {
        const row = [...members.values()].find((candidate) => candidate.id === where.id)!;
        row.role = data.role;
        return row;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { boardId_userId: { boardId: string; userId: string } };
        create: { boardId: string; userId: string; role: BoardRole; invitedById?: string | null };
        update: { role: BoardRole };
      }) => {
        const existing = members.get(`${where.boardId_userId.boardId}:${where.boardId_userId.userId}`);
        if (existing) {
          existing.role = update.role;
          return existing;
        }
        return member(create.boardId, create.userId, create.role, create.invitedById ?? null);
      },
      deleteMany: async ({ where }: { where: { boardId: string; userId: string } }) => {
        const existed = members.delete(`${where.boardId}:${where.userId}`);
        return { count: existed ? 1 : 0 };
      },
    },
    invitation: {
      findMany: async ({ where }: { where: { boardId?: string; email?: string } }) => {
        let rows = [...invitations.values()];
        if (where.boardId) rows = rows.filter((row) => row.boardId === where.boardId);
        if (where.email) rows = rows.filter((row) => row.email === where.email);
        return rows;
      },
      findFirst: async ({ where }: { where: { boardId?: string; email?: string; acceptedAt?: null } }) => {
        const rows = [...invitations.values()]
          .filter((row) => (where.boardId ? row.boardId === where.boardId : true))
          .filter((row) => (where.email ? row.email === where.email : true))
          .filter((row) => (where.acceptedAt === null ? row.acceptedAt === null : true));
        return rows[0] ?? null;
      },
      findUnique: async ({ where }: { where: { token?: string; id?: string } }) => {
        const rows = [...invitations.values()];
        const row = where.token ? rows.find((candidate) => candidate.token === where.token) : rows.find((candidate) => candidate.id === where.id);
        if (!row) return null;
        const boardRow = boards.get(row.boardId)!;
        return { ...row, board: boardRow, invitedBy: users.get(row.invitedById) ?? null };
      },
      create: async ({ data }: { data: Omit<InvitationRow, 'id' | 'createdAt' | 'acceptedAt' | 'acceptedById'> }) => {
        const row: InvitationRow = {
          ...data,
          id: `inv_${++counter}`,
          acceptedAt: null,
          acceptedById: null,
          createdAt: new Date(),
        };
        invitations.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<InvitationRow> }) => {
        const row = invitations.get(where.id)!;
        Object.assign(row, data);
        return row;
      },
      deleteMany: async ({ where }: { where: { id: string; boardId: string } }) => {
        const row = invitations.get(where.id);
        if (!row || row.boardId !== where.boardId) return { count: 0 };
        invitations.delete(where.id);
        return { count: 1 };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const row = invitations.get(where.id);
        if (!row) throw new Error(`invitación ${where.id} inexistente`);
        invitations.delete(where.id);
        return row;
      },
    },
    notification: {
      findUnique: async ({ where }: { where: { dedupeKey: string } }) =>
        notifications.find((row) => row.dedupeKey === where.dedupeKey) ?? null,
      create: async ({ data }: { data: { userId: string; kind: string; dedupeKey?: string | null } }) => {
        const row = { id: `notif_${++counter}`, ...data, dedupeKey: data.dedupeKey ?? null };
        notifications.push(row);
        return row;
      },
      updateMany: async () => ({ count: 0 }),
      count: async () => 0,
      findMany: async () => [],
    },
    comment: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    boardDocument: { findUnique: async () => null, upsert: async () => ({}) },
    $transaction: async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: typeof prisma) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
  };

  return {
    boards,
    users,
    members,
    invitations,
    notifications,
    emails,
    prisma,
    board,
    member,
    session: { id: 'user_ana', email: 'ana@tablero.test', name: 'Ana' },
    reset: () => {
      boards.clear();
      members.clear();
      invitations.clear();
      notifications.length = 0;
      counter = 0;
      users.clear();
      emails.length = 0;
      users.set('user_ana', { id: 'user_ana', email: 'ana@tablero.test', name: 'Ana', avatarUrl: null });
      users.set('user_beto', { id: 'user_beto', email: 'beto@tablero.test', name: 'Beto', avatarUrl: null });
      users.set('user_caro', { id: 'user_caro', email: 'caro@tablero.test', name: 'Caro', avatarUrl: null });
    },
  };
});

vi.mock('../db.js', () => ({ prisma: db.prisma }));

/**
 * El cierre de conexiones es del servidor de colaboración (Hocuspocus): acá se
 * dobla para registrar en qué tableros se pidió el cierre y contar el total.
 */
const collab = vi.hoisted(() => ({
  closed: [] as { boardId: string; userIds?: string[] }[],
  perBoard: 1,
}));

vi.mock('../collab/server.js', () => ({
  closeBoardConnectionsWithCode: (boardId: string, options: { userIds?: string[] } = {}) => {
    collab.closed.push({ boardId, ...(options.userIds ? { userIds: options.userIds } : {}) });
    return collab.perBoard;
  },
}));

vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>();
  return {
    ...actual,
    currentUser: () => {
      const user = db.users.get(db.session.id)!;
      return { ...user, settings: {}, createdAt: new Date() };
    },
    resolveSession: async () => null,
  };
});

vi.mock('../lib/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/email.js')>();
  return {
    ...actual,
    sendEmail: async (message: { to: string; subject: string; text: string; url?: string }) => {
      db.emails.push(message);
    },
  };
});

const { invitationViewRoutes, membersRoutes } = await import('./members.js');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.statusCode).send(error.toApiError());
      return;
    }
    if (error instanceof ZodError || (error as { name?: string }).name === 'ZodError') {
      reply.code(400).send(formatZodError(error as unknown as ZodError));
      return;
    }
    reply.code(500).send({ error: (error as Error).message, code: 'internal_error' });
  });
  await app.register(membersRoutes, { prefix: '/api' });
  // La vista de la invitación es pública y va en su propio plugin (el registro
  // real la monta fuera del scope con sesión).
  await app.register(invitationViewRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

beforeEach(() => {
  db.reset();
  db.board('inicio', { title: 'Inicio' });
  db.board('proyecto', { title: 'Proyecto', parentBoardId: 'inicio' });
  db.board('ajeno', { title: 'Ajeno', ownerId: 'user_caro' });
  db.member('proyecto', 'user_beto', 'editor', 'user_ana');
  db.session.id = 'user_ana';
  collab.closed.length = 0;
  collab.perBoard = 1;
});

describe('GET /api/boards/:id/members', () => {
  it('el dueño ve miembros e invitaciones; el miembro solo los miembros', async () => {
    const app = await buildApp();
    const owner = await app.inject({ method: 'GET', url: '/api/boards/proyecto/members' });
    expect(owner.statusCode).toBe(200);
    const ownerBody = owner.json() as { role: string; members: { userId: string; isOwner: boolean }[]; invitations: unknown[] };
    expect(ownerBody.role).toBe('owner');
    expect(ownerBody.members.map((row) => row.userId)).toEqual(['user_ana', 'user_beto']);
    expect(ownerBody.members[0]!.isOwner).toBe(true);
    expect(Array.isArray(ownerBody.invitations)).toBe(true);

    db.session.id = 'user_beto';
    const member = await app.inject({ method: 'GET', url: '/api/boards/proyecto/members' });
    expect(member.statusCode).toBe(200);
    const memberBody = member.json() as { role: string; invitations: unknown[] };
    expect(memberBody.role).toBe('editor');
    expect(memberBody.invitations).toHaveLength(0);

    db.session.id = 'user_caro';
    const stranger = await app.inject({ method: 'GET', url: '/api/boards/proyecto/members' });
    expect(stranger.statusCode).toBe(404);
    await app.close();
  });
});

describe('POST /api/boards/:id/members (alta directa)', () => {
  it('solo el dueño agrega, y avisa al nuevo miembro', async () => {
    const app = await buildApp();
    db.session.id = 'user_beto';
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/members',
      payload: { email: 'caro@tablero.test', role: 'viewer' },
    });
    expect(forbidden.statusCode).toBe(403);

    db.session.id = 'user_ana';
    const created = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/members',
      payload: { email: 'caro@tablero.test', role: 'commenter' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().members).toHaveLength(3);
    // `member` es el miembro creado, con la forma que lee la web (`addMember`).
    expect(created.json().member).toMatchObject({
      userId: 'user_caro',
      email: 'caro@tablero.test',
      name: 'Caro',
      role: 'commenter',
      isOwner: false,
    });
    expect(db.members.get('proyecto:user_caro')?.role).toBe('commenter');
    expect(db.notifications.some((row) => row.kind === 'board-shared' && row.userId === 'user_caro')).toBe(true);
    await app.close();
  });

  it('rechaza un email sin cuenta y a quien ya es miembro', async () => {
    const app = await buildApp();
    const missing = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/members',
      payload: { email: 'nadie@tablero.test', role: 'viewer' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('user_not_found');

    const already = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/members',
      payload: { email: 'beto@tablero.test', role: 'viewer' },
    });
    expect(already.statusCode).toBe(409);
    expect(already.json().code).toBe('already_member');
    await app.close();
  });
});

describe('PATCH y DELETE de miembros', () => {
  it('cambia el rol y expulsa, siempre con el dueño', async () => {
    const app = await buildApp();
    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/boards/proyecto/members/user_beto',
      payload: { role: 'viewer' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().member).toMatchObject({ userId: 'user_beto', role: 'viewer' });

    const removed = await app.inject({ method: 'DELETE', url: '/api/boards/proyecto/members/user_beto' });
    expect(removed.statusCode).toBe(200);
    expect(db.members.has('proyecto:user_beto')).toBe(false);
    await app.close();
  });

  it('cierra las conexiones del afectado en el tablero y en todo su subárbol', async () => {
    const app = await buildApp();
    db.board('subtema', { title: 'Subtema', parentBoardId: 'proyecto' });
    db.board('nieto', { title: 'Nieto', parentBoardId: 'subtema' });
    db.board('otro', { title: 'Otro', parentBoardId: 'inicio' });

    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/boards/proyecto/members/user_beto',
      payload: { role: 'viewer' },
    });
    expect(changed.statusCode).toBe(200);
    // Un cierre por cada tablero del subárbol (la raíz incluida), y siempre
    // acotado al usuario afectado.
    expect(collab.closed.map((row) => row.boardId).sort()).toEqual(['nieto', 'proyecto', 'subtema']);
    expect(collab.closed.every((row) => row.userIds?.join(',') === 'user_beto')).toBe(true);
    expect(changed.json().connectionsClosed).toBe(3);

    collab.closed.length = 0;
    const removed = await app.inject({ method: 'DELETE', url: '/api/boards/proyecto/members/user_beto' });
    expect(removed.statusCode).toBe(200);
    expect(collab.closed.map((row) => row.boardId).sort()).toEqual(['nieto', 'proyecto', 'subtema']);
    expect(removed.json().connectionsClosed).toBe(3);
    await app.close();
  });

  it('no deja tocar al dueño ni a un no-miembro', async () => {
    const app = await buildApp();
    const owner = await app.inject({
      method: 'PATCH',
      url: '/api/boards/proyecto/members/user_ana',
      payload: { role: 'viewer' },
    });
    expect(owner.statusCode).toBe(409);
    expect(owner.json().code).toBe('cannot_change_owner');

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/boards/proyecto/members/user_caro',
      payload: { role: 'viewer' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('member_not_found');
    await app.close();
  });
});

describe('invitaciones', () => {
  it('GET /boards/:id/invitations lista las pendientes solo para el dueño', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/invitations',
      payload: { email: 'nueva@tablero.test', role: 'viewer' },
    });

    const owner = await app.inject({ method: 'GET', url: '/api/boards/proyecto/invitations' });
    expect(owner.statusCode).toBe(200);
    const invitations = owner.json().invitations as { email: string; role: string; token: string }[];
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({ email: 'nueva@tablero.test', role: 'viewer' });

    db.session.id = 'user_beto';
    const member = await app.inject({ method: 'GET', url: '/api/boards/proyecto/invitations' });
    expect(member.statusCode).toBe(403);

    db.session.id = 'user_caro';
    const stranger = await app.inject({ method: 'GET', url: '/api/boards/proyecto/invitations' });
    expect(stranger.statusCode).toBe(404);
    await app.close();
  });

  it('el dueño invita por email con rol y caducidad, y el email sale por el transporte', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/invitations',
      payload: { email: 'nueva@tablero.test', role: 'viewer', expiresInDays: 3 },
    });

    expect(response.statusCode).toBe(201);
    const invitation = response.json().invitation as { email: string; role: string; token: string; link: string; expiresAt: number };
    expect(invitation).toMatchObject({ email: 'nueva@tablero.test', role: 'viewer' });
    expect(invitation.link).toContain(`/invite/${invitation.token}`);
    expect(db.emails).toHaveLength(1);
    expect(db.emails[0]!.to).toBe('nueva@tablero.test');
    expect(db.emails[0]!.url).toBe(invitation.link);
    // La caducidad pedida es la que queda guardada.
    const days = Math.round((invitation.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
    expect(days).toBe(3);
    await app.close();
  });

  it('rechaza invitar a quien ya es miembro y a un rol inexistente', async () => {
    const app = await buildApp();
    const already = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/invitations',
      payload: { email: 'beto@tablero.test', role: 'editor' },
    });
    expect(already.statusCode).toBe(409);
    expect(already.json().code).toBe('already_member');

    const badRole = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/invitations',
      payload: { email: 'nueva@tablero.test', role: 'dueño' },
    });
    expect(badRole.statusCode).toBe(400);
    await app.close();
  });

  it('el dueño no puede invitarse a sí mismo (409 `already_owner`, como el alta directa)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/invitations',
      payload: { email: 'ana@tablero.test', role: 'viewer' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('already_owner');
    // No queda una invitación basura ni sale un email.
    expect(db.invitations.size).toBe(0);
    expect(db.emails).toHaveLength(0);
    await app.close();
  });

  it('GET /invitations/:token enmascara el email y lo muestra para su dueño', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/invitations',
      payload: { email: 'nueva@tablero.test', role: 'viewer' },
    });
    const token = db.emails[0]!.url!.split('/').pop()!;

    const anonymous = await app.inject({ method: 'GET', url: `/api/invitations/${token}` });
    expect(anonymous.statusCode).toBe(200);
    const view = anonymous.json().invitation as { email: string; emailMatches: boolean; boardTitle: string; expired: boolean };
    expect(view.email).toBe('n****@tablero.test');
    expect(view.emailMatches).toBe(false);
    expect(view.boardTitle).toBe('Proyecto');
    expect(view.expired).toBe(false);
    // El tablero de la invitación viaja en el nivel superior (`board`).
    expect(anonymous.json().board).toMatchObject({ id: 'proyecto', title: 'Proyecto' });

    db.session.id = 'user_caro';
    const owner = await app.inject({ method: 'GET', url: `/api/invitations/${token}` });
    expect((owner.json().invitation as { emailMatches: boolean }).emailMatches).toBe(false);
    await app.close();
  });

  it('acepta la invitación creando la membresía, y rechaza caducada, ya aceptada o de otro email', async () => {
    const app = await buildApp();
    const invited = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/invitations',
      payload: { email: 'caro@tablero.test', role: 'editor', expiresInDays: 1 },
    });
    const token = (invited.json().invitation as { token: string }).token;

    // Otro email no puede aceptarla.
    db.session.id = 'user_beto';
    const mismatch = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept` });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().code).toBe('invitation_email_mismatch');

    db.session.id = 'user_caro';
    const accepted = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept` });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ boardId: 'proyecto', role: 'editor', alreadyMember: false });
    // El resumen del tablero viaja en `board` (nivel superior): la web navega con su id.
    expect(accepted.json().board).toMatchObject({ id: 'proyecto', title: 'Proyecto', role: 'editor' });
    expect(db.members.get('proyecto:user_caro')?.role).toBe('editor');

    // Repetir la aceptación es idempotente para la misma cuenta.
    const again = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept` });
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyMember).toBe(true);

    // Otra cuenta ya no puede: la invitación está aceptada.
    const row = [...db.invitations.values()][0]!;
    row.acceptedById = 'user_caro';
    db.session.id = 'user_beto';
    const taken = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept` });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().code).toBe('invitation_already_accepted');
    await app.close();
  });

  it('no acepta una invitación caducada', async () => {
    const app = await buildApp();
    db.session.id = 'user_caro';
    const row = await db.prisma.invitation.create({
      data: {
        boardId: 'proyecto',
        email: 'caro@tablero.test',
        role: 'viewer',
        token: 'token-caducado-1234567890',
        expiresAt: new Date(Date.now() - 1000),
        invitedById: 'user_ana',
      } as never,
    });

    const response = await app.inject({ method: 'POST', url: `/api/invitations/${row.token}/accept` });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('invitation_expired');
    expect(db.members.has('proyecto:user_caro')).toBe(false);
    await app.close();
  });

  it('revoca una invitación pendiente por su id (`DELETE /invitations/:id`, como la web)', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/invitations',
      payload: { email: 'nueva@tablero.test', role: 'viewer' },
    });
    const id = (created.json().invitation as { id: string }).id;

    // Un miembro que no es dueño no la puede revocar; un ajeno ni la ve.
    db.session.id = 'user_beto';
    const forbidden = await app.inject({ method: 'DELETE', url: `/api/invitations/${id}` });
    expect(forbidden.statusCode).toBe(403);
    db.session.id = 'user_caro';
    const stranger = await app.inject({ method: 'DELETE', url: `/api/invitations/${id}` });
    expect(stranger.statusCode).toBe(404);

    db.session.id = 'user_ana';
    const revoked = await app.inject({ method: 'DELETE', url: `/api/invitations/${id}` });
    expect(revoked.statusCode).toBe(200);
    expect(db.invitations.size).toBe(0);

    const missing = await app.inject({ method: 'DELETE', url: `/api/invitations/${id}` });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('revoca una invitación pendiente por su ruta por tablero', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/boards/proyecto/invitations',
      payload: { email: 'nueva@tablero.test', role: 'viewer' },
    });
    const id = (created.json().invitation as { id: string }).id;
    const revoked = await app.inject({ method: 'DELETE', url: `/api/boards/proyecto/invitations/${id}` });
    expect(revoked.statusCode).toBe(200);
    expect(db.invitations.size).toBe(0);
    await app.close();
  });
});

/**
 * Miembros e invitaciones de un tablero (fase 5).
 *
 * Reglas:
 * - El **dueño** no tiene fila en `BoardMember`: su rol sale de `Board.ownerId`.
 * - Solo el dueño gestiona (invitar, cambiar rol, expulsar); la herencia hacia
 *   subtableros la resuelve `lib/access.ts`, así que una fila en el padre abre
 *   el hijo (y una fila en el hijo sobrescribe lo heredado).
 * - La invitación viaja por email con un token de un solo uso y caducidad; en
 *   desarrollo el email se escribe en el log y el enlace se devuelve en la
 *   respuesta para poder copiarlo.
 */

import { randomBytes } from 'node:crypto';

import type { BoardMemberSummary, BoardRole, InvitationSummary } from '@tablero/shared';
import { defaultInviteExpiryDays } from '@tablero/shared';

import { prisma } from '../db.js';
import { invitationLink, sendEmail } from './email.js';
import { badRequest, conflict, notFound } from './errors.js';
import { notifyBoardShared } from './notifications.js';

export const INVITATION_TTL_MAX_DAYS = 90;

const MEMBER_INCLUDE = {
  user: { select: { id: true, name: true, email: true, avatarUrl: true } },
} as const;

function toMemberSummary(
  row: { userId: string; role: BoardRole; invitedById: string | null; createdAt: Date },
  user: { name: string; email: string; avatarUrl: string | null },
): BoardMemberSummary {
  return {
    userId: row.userId,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: row.role,
    invitedById: row.invitedById,
    createdAt: row.createdAt.getTime(),
    isOwner: false,
  };
}

/** Miembros del tablero, el dueño primero (con `isOwner: true`). */
export async function boardMemberSummaries(boardId: string): Promise<BoardMemberSummary[]> {
  const [board, rows] = await Promise.all([
    prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true, owner: { select: { name: true, email: true, avatarUrl: true } } } }),
    prisma.boardMember.findMany({
      where: { boardId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: MEMBER_INCLUDE,
    }),
  ]);
  if (!board) return [];
  const members: BoardMemberSummary[] = [];
  if (board.owner) {
    members.push({
      userId: board.ownerId,
      name: board.owner.name,
      email: board.owner.email,
      avatarUrl: board.owner.avatarUrl,
      role: 'editor',
      invitedById: null,
      createdAt: 0,
      isOwner: true,
    });
  }
  for (const row of rows) {
    if (row.userId === board.ownerId) continue;
    members.push(toMemberSummary(row, row.user));
  }
  return members;
}

/** Ids de los usuarios con acceso (dueño + miembros), para menciones y avisos. */
export async function boardAudienceIds(boardId: string): Promise<string[]> {
  const [board, members] = await Promise.all([
    prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true } }),
    prisma.boardMember.findMany({ where: { boardId }, select: { userId: true } }),
  ]);
  if (!board) return [];
  return [board.ownerId, ...members.map((member) => member.userId)];
}

/** Miembros con nombre y email, para resolver menciones `@nombre` / `@email`. */
export async function boardMentionTargets(
  boardId: string,
): Promise<{ userId: string; name: string; email: string }[]> {
  const [board, members] = await Promise.all([
    prisma.board.findUnique({
      where: { id: boardId },
      select: { ownerId: true, owner: { select: { id: true, name: true, email: true } } },
    }),
    prisma.boardMember.findMany({
      where: { boardId },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  if (!board) return [];
  const targets = board.owner ? [{ userId: board.owner.id, name: board.owner.name, email: board.owner.email }] : [];
  for (const row of members) {
    if (row.userId === board.ownerId) continue;
    targets.push({ userId: row.userId, name: row.user.name, email: row.user.email });
  }
  return targets;
}

export function toInvitationSummary(row: {
  id: string;
  boardId: string;
  email: string;
  role: BoardRole;
  token: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}): InvitationSummary {
  return {
    id: row.id,
    boardId: row.boardId,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.getTime(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    expired: row.acceptedAt === null && row.expiresAt.getTime() <= Date.now(),
    token: row.token,
    link: invitationLink(row.token),
  };
}

/** Invitaciones vivas de un tablero (sin las aceptadas y sin las caducadas). */
export async function boardInvitations(boardId: string, options: { includeAccepted?: boolean } = {}): Promise<InvitationSummary[]> {
  const rows = await prisma.invitation.findMany({
    where: {
      boardId,
      ...(options.includeAccepted ? {} : { acceptedAt: null, expiresAt: { gt: new Date() } }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(toInvitationSummary);
}

export type CreateInvitationInput = {
  boardId: string;
  boardTitle: string;
  email: string;
  role: BoardRole;
  invitedById: string;
  invitedByName: string;
  expiresInDays?: number | undefined;
};

/**
 * Crea (o renueva) la invitación y manda el email. Si el email ya es miembro se
 * rechaza: el rol se cambia con `PATCH /members/:userId`.
 */
export async function createInvitation(input: CreateInvitationInput): Promise<InvitationSummary> {
  const existingMember = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existingMember) {
    const membership = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: input.boardId, userId: existingMember.id } },
      select: { id: true },
    });
    if (membership) throw conflict('Esa persona ya es miembro del tablero', 'already_member');
  }

  const days = input.expiresInDays ?? defaultInviteExpiryDays;
  if (days < 1 || days > INVITATION_TTL_MAX_DAYS) {
    throw badRequest(`La caducidad debe estar entre 1 y ${INVITATION_TTL_MAX_DAYS} días`, 'invalid_expiry');
  }

  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // Una invitación viva por email y tablero: repetir el envío renueva token y
  // caducidad en vez de acumular enlaces sueltos.
  const previous = await prisma.invitation.findFirst({
    where: { boardId: input.boardId, email: input.email, acceptedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  const row = previous
    ? await prisma.invitation.update({
        where: { id: previous.id },
        data: { token, role: input.role, expiresAt, invitedById: input.invitedById },
      })
    : await prisma.invitation.create({
        data: {
          boardId: input.boardId,
          email: input.email,
          role: input.role,
          token,
          expiresAt,
          invitedById: input.invitedById,
        },
      });

  const link = invitationLink(token);
  await sendEmail({
    to: input.email,
    subject: `${input.invitedByName} te invitó a «${input.boardTitle}» en Tablero`,
    text: [
      `${input.invitedByName} te invitó a colaborar en el tablero «${input.boardTitle}» con rol ${input.role}.`,
      `La invitación caduca el ${expiresAt.toISOString().slice(0, 10)}.`,
      'Abrí el enlace para aceptarla.',
    ].join('\n'),
    url: link,
  });

  return toInvitationSummary(row);
}

export type InvitationView = InvitationSummary & {
  boardTitle: string;
  /** Tablero de la invitación: la web lo lee en el nivel superior (`board`). */
  board: { id: string; title: string; icon: string | null };
  invitedByName: string | null;
  /** El email de la invitación, para que la web avise si no coincide. */
  emailMatches: boolean;
};

export async function invitationByToken(token: string): Promise<InvitationView | null> {
  const row = await prisma.invitation.findUnique({
    where: { token },
    include: { board: { select: { id: true, title: true, icon: true } }, invitedBy: { select: { name: true } } },
  });
  if (!row) return null;
  return {
    ...toInvitationSummary(row),
    boardTitle: row.board.title,
    board: { id: row.board.id, title: row.board.title, icon: row.board.icon },
    invitedByName: row.invitedBy?.name ?? null,
    emailMatches: false,
  };
}

export type AcceptInvitationResult = {
  boardId: string;
  boardTitle: string;
  role: BoardRole;
  alreadyMember: boolean;
};

/**
 * Acepta la invitación: crea (o actualiza) la membresía y marca la invitación.
 * Exige que el email de la sesión coincida con el de la invitación — el token
 * viaja por email y no debe servir para que otra cuenta se cuele.
 */
export async function acceptInvitation(
  token: string,
  user: { id: string; email: string; name: string },
): Promise<AcceptInvitationResult> {
  const row = await prisma.invitation.findUnique({
    where: { token },
    include: {
      board: { select: { id: true, title: true, ownerId: true } },
      invitedBy: { select: { name: true } },
    },
  });
  if (!row) throw notFound('La invitación no existe', 'invitation_not_found');
  if (row.acceptedAt) {
    // Idempotente: si ya la aceptó la misma cuenta, devolver el acceso sin
    // volver a crear la membresía ni repetir el aviso.
    if (row.acceptedById === user.id) {
      return { boardId: row.boardId, boardTitle: row.board.title, role: row.role, alreadyMember: true };
    }
    throw conflict('La invitación ya fue aceptada', 'invitation_already_accepted');
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw conflict('La invitación caducó', 'invitation_expired');
  }
  if (row.email.toLowerCase() !== user.email.toLowerCase()) {
    throw conflict('La invitación es para otro email', 'invitation_email_mismatch');
  }
  if (row.board.ownerId === user.id) {
    return { boardId: row.boardId, boardTitle: row.board.title, role: row.role, alreadyMember: true };
  }

  const previous = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: row.boardId, userId: user.id } },
    select: { id: true, role: true },
  });

  await prisma.$transaction([
    prisma.boardMember.upsert({
      where: { boardId_userId: { boardId: row.boardId, userId: user.id } },
      create: { boardId: row.boardId, userId: user.id, role: row.role, invitedById: row.invitedById },
      update: { role: row.role },
    }),
    prisma.invitation.update({
      where: { id: row.id },
      data: { acceptedAt: new Date(), acceptedById: user.id },
    }),
  ]);

  if (!previous) {
    // «Compartido conmigo»: el aviso llega al aceptar, con quien invitó como actor.
    await notifyBoardShared({
      boardId: row.boardId,
      boardTitle: row.board.title,
      actorId: row.invitedById,
      actorName: row.invitedBy?.name ?? 'Alguien',
      recipients: [user.id],
      role: row.role,
    });
  }

  return { boardId: row.boardId, boardTitle: row.board.title, role: row.role, alreadyMember: previous !== null };
}

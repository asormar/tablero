/**
 * Miembros e invitaciones de un tablero (fase 5).
 *
 *   GET    /api/boards/:id/members            listar (cualquier miembro)
 *   POST   /api/boards/:id/members            alta directa por email (dueño)
 *   PATCH  /api/boards/:id/members/:userId    cambiar rol (dueño)
 *   DELETE /api/boards/:id/members/:userId    expulsar (dueño)
 *   POST   /api/boards/:id/invitations        invitar por email (dueño)
 *   DELETE /api/boards/:id/invitations/:iid   revocar invitación (dueño)
 *   GET    /api/invitations/:token            ver la invitación (público, token)
 *   POST   /api/invitations/:token/accept     aceptar (sesión con el mismo email)
 *
 * Al expulsar a alguien o bajarle el rol se cierran sus conexiones de ese
 * tablero con el código propio (reabrible): el socket cae en el acto y, al
 * reconectar, el handshake decide con el permiso nuevo.
 */

import type { FastifyInstance } from 'fastify';
import { addMemberSchema, idSchema, inviteMemberSchema, updateMemberSchema } from '@tablero/shared';
import { z } from 'zod';

import { closeBoardConnectionsWithCode } from '../collab/server.js';
import { prisma } from '../db.js';
import { requireBoardAccess, resolveBoardAccess, resolveBoardAccessFrom } from '../lib/access.js';
import { boardSubtreeIds, loadBoardAccess } from '../lib/boards.js';
import { conflict, notFound } from '../lib/errors.js';
import {
  acceptInvitation,
  boardInvitations,
  boardMemberSummaries,
  createInvitation,
  invitationByToken,
} from '../lib/members.js';
import { notifyBoardShared } from '../lib/notifications.js';
import { currentUser, readSessionToken, resolveSession } from '../lib/session.js';

const idParamsSchema = z.object({ id: idSchema });
const memberParamsSchema = z.object({ id: idSchema, userId: idSchema });
const invitationParamsSchema = z.object({ id: idSchema, invitationId: idSchema });
const tokenParamsSchema = z.object({ token: z.string().min(10).max(200) });
const membersQuerySchema = z.object({
  includeInvitations: z.enum(['0', '1', 'true', 'false']).default('true'),
});

/** Email enmascarado para quien todavía no demostró ser su dueño. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(1, Math.min(local.length - 1, 8)))}@${domain}`;
}

/**
 * Cierra las conexiones del usuario en el tablero **y en sus subtableros**.
 *
 * Un cambio de rol (o una expulsión) alcanza a los descendientes por herencia,
 * así que el socket del afectado tiene que caer también donde estaba mirando un
 * hijo con rol heredado. El total que se devuelve es el que se cerró de verdad:
 * antes, con el interesado en un subtablero, la respuesta decía 0 y su socket
 * seguía escribiendo con el permiso viejo.
 */
async function closeUserConnections(boardId: string, userId: string): Promise<number> {
  const ids = await boardSubtreeIds(boardId);
  let closed = 0;
  for (const id of ids) closed += closeBoardConnectionsWithCode(id, { userIds: [userId] });
  return closed;
}

export async function membersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/boards/:id/members', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const query = membersQuerySchema.parse(request.query ?? {});
    const resolution = await resolveBoardAccess(user.id, id);
    const { role } = requireBoardAccess(resolution, 'viewer');

    const members = await boardMemberSummaries(id);
    const isOwner = role === 'owner';
    const invitations = isOwner && query.includeInvitations !== '0' ? await boardInvitations(id) : [];
    return {
      role,
      board: { id, title: resolution.board?.title ?? '', ownerId: resolution.board?.ownerId ?? '' },
      members,
      invitations,
    };
  });

  /** Alta directa: la cuenta ya existe y el dueño le da un rol sin invitación. */
  app.post('/boards/:id/members', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const input = addMemberSchema.parse(request.body ?? {});
    const resolution = await resolveBoardAccess(user.id, id);
    const { board } = requireBoardAccess(resolution, 'owner');

    const target = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true, name: true } });
    if (!target) throw notFound('No hay ninguna cuenta con ese email: mandale una invitación', 'user_not_found');
    if (target.id === board.ownerId) throw conflict('Ese usuario ya es el dueño del tablero', 'already_owner');

    const existing = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: id, userId: target.id } },
      select: { id: true },
    });
    if (existing) throw conflict('Esa persona ya es miembro del tablero', 'already_member');

    await prisma.boardMember.create({
      data: { boardId: id, userId: target.id, role: input.role, invitedById: user.id },
    });
    await notifyBoardShared({
      boardId: id,
      boardTitle: board.title,
      actorId: user.id,
      actorName: user.name,
      recipients: [target.id],
      role: input.role,
    });

    const members = await boardMemberSummaries(id);
    reply.code(201);
    // `member` es lo que lee la web (`addMember`); `members` mantiene el listado.
    return { member: members.find((row) => row.userId === target.id) ?? null, members };
  });

  /** Cambio de rol. Baja de permisos = se cierran sus conexiones del tablero. */
  app.patch('/boards/:id/members/:userId', async (request) => {
    const user = currentUser(request);
    const { id, userId } = memberParamsSchema.parse(request.params);
    const input = updateMemberSchema.parse(request.body ?? {});
    const resolution = await resolveBoardAccess(user.id, id);
    const { board } = requireBoardAccess(resolution, 'owner');
    if (userId === board.ownerId) throw conflict('El rol del dueño no se cambia', 'cannot_change_owner');

    const existing = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: id, userId } },
      select: { id: true, role: true },
    });
    if (!existing) throw notFound('Esa persona no es miembro del tablero', 'member_not_found');

    const updated = await prisma.boardMember.update({
      where: { id: existing.id },
      data: { role: input.role },
    });
    const closed = await closeUserConnections(id, userId);
    request.log.info({ boardId: id, userId, role: input.role, closed }, 'Rol de miembro actualizado');
    const members = await boardMemberSummaries(id);
    return {
      member: members.find((row) => row.userId === userId) ?? { userId, role: updated.role },
      connectionsClosed: closed,
      members,
    };
  });

  /** Expulsión: cae la fila de miembro y con ella su acceso (y su socket). */
  app.delete('/boards/:id/members/:userId', async (request) => {
    const user = currentUser(request);
    const { id, userId } = memberParamsSchema.parse(request.params);
    const resolution = await resolveBoardAccess(user.id, id);
    const { board } = requireBoardAccess(resolution, 'owner');
    if (userId === board.ownerId) throw conflict('No se puede expulsar al dueño', 'cannot_remove_owner');
    if (userId === user.id) throw conflict('No te podés expulsar a vos mismo', 'cannot_remove_self');

    const deleted = await prisma.boardMember.deleteMany({ where: { boardId: id, userId } });
    if (deleted.count === 0) throw notFound('Esa persona no es miembro del tablero', 'member_not_found');

    const closed = await closeUserConnections(id, userId);
    request.log.info({ boardId: id, userId, closed }, 'Miembro expulsado del tablero');
    return { ok: true, connectionsClosed: closed, members: await boardMemberSummaries(id) };
  });

  /** Invitaciones vivas del tablero (lo que lista el diálogo de compartir). */
  app.get('/boards/:id/invitations', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const resolution = await resolveBoardAccess(user.id, id);
    requireBoardAccess(resolution, 'owner');
    return { invitations: await boardInvitations(id) };
  });

  /** Invitación por email con rol y caducidad (1 a 90 días). */
  app.post('/boards/:id/invitations', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const input = inviteMemberSchema.parse(request.body ?? {});
    const resolution = await resolveBoardAccess(user.id, id);
    const { board } = requireBoardAccess(resolution, 'owner');

    const invitation = await createInvitation({
      boardId: id,
      boardTitle: board.title,
      email: input.email,
      role: input.role,
      ownerId: board.ownerId,
      invitedById: user.id,
      invitedByName: user.name,
      expiresInDays: input.expiresInDays,
    });

    reply.code(201);
    return { invitation, invitations: await boardInvitations(id) };
  });

  app.delete('/boards/:id/invitations/:invitationId', async (request) => {
    const user = currentUser(request);
    const { id, invitationId } = invitationParamsSchema.parse(request.params);
    const resolution = await resolveBoardAccess(user.id, id);
    requireBoardAccess(resolution, 'owner');
    const deleted = await prisma.invitation.deleteMany({ where: { id: invitationId, boardId: id } });
    if (deleted.count === 0) throw notFound('La invitación no existe', 'invitation_not_found');
    return { ok: true, invitations: await boardInvitations(id) };
  });

  /**
   * Revocar una invitación por su id (lo que llama la web: `DELETE
   * /invitations/:id`). El tablero sale de la propia invitación y el permiso
   * se comprueba con el dueño de ese tablero.
   */
  app.delete('/invitations/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const invitation = await prisma.invitation.findUnique({ where: { id }, select: { id: true, boardId: true } });
    if (!invitation) throw notFound('La invitación no existe', 'invitation_not_found');
    const resolution = await resolveBoardAccess(user.id, invitation.boardId);
    requireBoardAccess(resolution, 'owner');
    await prisma.invitation.delete({ where: { id: invitation.id } });
    return { ok: true, invitations: await boardInvitations(invitation.boardId) };
  });

  /**
   * Vista de la invitación. Es **pública** (el token del enlace es la
   * credencial); vive en `invitationViewRoutes` porque este plugin se registra
   * dentro del scope con sesión. El email va enmascarado salvo que quien
   * consulte tenga sesión con ese mismo email.
   */
  // (ruta registrada en `invitationViewRoutes`, al final del archivo)

  /** Aceptar: exige sesión y que el email coincida con el de la invitación. */
  app.post('/invitations/:token/accept', async (request) => {
    const user = currentUser(request);
    const { token } = tokenParamsSchema.parse(request.params);
    const result = await acceptInvitation(token, user);
    // El resumen del tablero (con el rol ya resuelto) viaja en `board`: es lo
    // que lee la web para llevarte al tablero recién aceptado.
    const access = await loadBoardAccess(user.id);
    const record = access.get(result.boardId);
    const board = record ? access.summary(record) : null;
    const role = access.roleOf(result.boardId) ?? result.role;
    return { ...result, role, board };
  });
}

/**
 * Vista de una invitación por su token, **sin sesión** (fase 5, contrato de
 * `ARCHITECTURE.md`: «el token es la credencial»). Es la única ruta del módulo
 * fuera del scope protegido, así que va en su propio plugin y `routes/index.ts`
 * la registra con las públicas.
 *
 * Si quien consulta tiene sesión con el email de la invitación, se lo muestra
 * completo y marca `emailMatches`; si no, va enmascarado.
 */
export async function invitationViewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/invitations/:token', async (request) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const view = await invitationByToken(token);
    if (!view) throw notFound('La invitación no existe', 'invitation_not_found');

    const sessionToken = readSessionToken(request);
    const session = sessionToken ? await resolveSession(sessionToken) : null;
    const sameEmail = session !== null && session.user.email.toLowerCase() === view.email.toLowerCase();
    const { board, ...invitation } = view;
    return {
      // El tablero va en el nivel superior: la web lo lee así en el preview.
      board,
      invitation: {
        ...invitation,
        email: sameEmail ? view.email : maskEmail(view.email),
        emailMatches: sameEmail,
      },
    };
  });
}

/** Rutas de sesión: registro, login, logout y `me`. */

import type { FastifyInstance } from 'fastify';
import { loginSchema, registerSchema } from '@tablero/shared';
import { z } from 'zod';

import { prisma } from '../db.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { loadBoardAccess } from '../lib/boards.js';
import {
  clearSessionCookie,
  createSession,
  currentUser,
  hashSessionToken,
  readSessionToken,
  requireSession,
  setSessionCookie,
} from '../lib/session.js';
import { createUserWithRootBoard, hashPassword, toPublicUser, verifyPassword } from '../lib/users.js';

/** Hash señuelo para igualar tiempos cuando el email no existe. */
let decoyHash: Promise<string> | null = null;
function decoy(): Promise<string> {
  decoyHash ??= hashPassword('tablero-decoy-password-for-timing-equalisation');
  return decoyHash;
}

const meQuerySchema = z.object({ trashed: z.enum(['0', '1']).optional() });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = registerSchema.parse(request.body ?? {});
    const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) throw conflict('Ya existe una cuenta con ese email', 'email_taken');

    const { user } = await createUserWithRootBoard(input);
    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(reply, token, expiresAt);
    reply.code(201);
    return { user: toPublicUser(user) };
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = loginSchema.parse(request.body ?? {});
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await verifyPassword(await decoy(), input.password);
      throw unauthorized('Email o contraseña incorrectos', 'invalid_credentials');
    }
    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) throw unauthorized('Email o contraseña incorrectos', 'invalid_credentials');

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(reply, token, expiresAt);
    return { user: toPublicUser(user) };
  });

  app.post('/auth/logout', { preHandler: requireSession }, async (request, reply) => {
    const token = readSessionToken(request);
    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireSession }, async (request) => {
    const user = currentUser(request);
    const query = meQuerySchema.parse(request.query ?? {});
    const access = await loadBoardAccess(user.id);
    const boards = access.summaries(access.accessible({ includeTrashed: query.trashed === '1' }));
    return { user, boards };
  });
}

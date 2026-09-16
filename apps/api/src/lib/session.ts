/**
 * Sesiones.
 *
 * El token es de 32 bytes aleatorios (base64url) y viaja en la cookie
 * `tablero_session`. En la base solo se guarda su sha256 hex: si la base se
 * filtra, los tokens no son reutilizables.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { prisma } from '../db.js';
import { env } from '../env.js';
import { unauthorized } from './errors.js';

export const SESSION_COOKIE = env.sessionCookieName;
const SESSION_TTL_MS = env.sessionTtlDays * 24 * 60 * 60 * 1000;

export type AuthedUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  settings: unknown;
  createdAt: Date;
};

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt },
  });
  return { token, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    expires: expiresAt,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
  });
}

/** Cookie cruda → mapa. Se usa en HTTP y en el handshake WebSocket. */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    if (key.length === 0) continue;
    try {
      cookies[key] = decodeURIComponent(raw);
    } catch {
      cookies[key] = raw;
    }
  }
  return cookies;
}

/** Token de sesión de la petición. Nunca se acepta por query string ni por body. */
export function readSessionToken(request: FastifyRequest): string | null {
  const fromPlugin = request.cookies?.[SESSION_COOKIE];
  if (typeof fromPlugin === 'string' && fromPlugin.length > 0) return fromPlugin;
  const fromHeader = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE];
  return fromHeader && fromHeader.length > 0 ? fromHeader : null;
}

export type ResolvedSession = { user: AuthedUser; expiresAt: Date };

export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  const { user } = session;
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      settings: user.settings,
      createdAt: user.createdAt,
    },
    expiresAt: session.expiresAt,
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: AuthedUser;
  }
}

/** preHandler: exige sesión válida y deja el usuario en `request.currentUser`. */
export async function requireSession(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = readSessionToken(request);
  if (!token) throw unauthorized();
  const session = await resolveSession(token);
  if (!session) throw unauthorized('Sesión inválida o expirada', 'session_expired');
  request.currentUser = session.user;
}

export function currentUser(request: FastifyRequest): AuthedUser {
  const user = request.currentUser;
  if (!user) throw unauthorized();
  return user;
}

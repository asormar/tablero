/**
 * Construcción de la aplicación Fastify: plugins, guardas y error handler.
 *
 * Orden: cookie → CORS → rate limit → guarda CSRF → rutas → errores.
 */

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Prisma } from '@prisma/client';
import { formatZodError, type ApiError } from '@tablero/shared';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { env } from './env.js';
import { HttpError } from './lib/errors.js';
import { registerRoutes } from './routes/index.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Guarda CSRF: en toda petición mutante, `Origin` (o `Referer` como respaldo)
 * debe coincidir con APP_ORIGIN (o algún origen de ALLOWED_ORIGINS). Si no hay
 * ninguna de las dos cabeceras, se rechaza: no se puede verificar el origen.
 */
async function csrfGuard(request: FastifyRequest): Promise<void> {
  if (!MUTATING_METHODS.has(request.method)) return;
  if (!request.url.startsWith('/api')) return;

  const origin = originOf(request.headers.origin);
  if (origin) {
    if (!env.allowedOrigins.has(origin)) {
      throw new HttpError(403, 'Origen no permitido', 'csrf_origin_mismatch');
    }
    return;
  }
  const refererOrigin = originOf(request.headers.referer);
  if (refererOrigin && env.allowedOrigins.has(refererOrigin)) return;
  throw new HttpError(403, 'Falta la cabecera Origin (o Referer) en una petición mutante', 'csrf_missing_origin');
}

function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError || (error instanceof Error && error.name === 'ZodError');
}

function errorHandler(this: FastifyInstance, error: Error, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof HttpError) {
    reply.code(error.statusCode).send(error.toApiError());
    return;
  }

  if (isZodError(error)) {
    reply.code(400).send(formatZodError(error));
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(', ') : String(error.meta?.target ?? '');
    if (error.code === 'P2002') {
      reply.code(409).send({ error: `Ya existe un registro con ese valor (${target})`, code: 'unique_violation' } satisfies ApiError);
      return;
    }
    if (error.code === 'P2025') {
      reply.code(404).send({ error: 'El recurso no existe', code: 'not_found' } satisfies ApiError);
      return;
    }
    if (error.code === 'P2003') {
      reply.code(409).send({ error: 'La operación viola una referencia', code: 'foreign_key_violation' } satisfies ApiError);
      return;
    }
    request.log.error({ err: error, code: error.code }, 'Error de Prisma no mapeado');
    reply.code(500).send({ error: 'Error interno del servidor', code: 'internal_error' } satisfies ApiError);
    return;
  }

  const statusCode = (error as { statusCode?: number }).statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    if (statusCode === 429) {
      reply.code(429).send({ error: 'Demasiadas peticiones, probá más tarde', code: 'rate_limited' } satisfies ApiError);
      return;
    }
    if (statusCode === 401) {
      reply.code(401).send({ error: 'No autenticado', code: 'unauthenticated' } satisfies ApiError);
      return;
    }
    reply.code(statusCode).send({ error: error.message, code: 'bad_request' } satisfies ApiError);
    return;
  }

  request.log.error({ err: error }, 'Error no controlado');
  reply.code(500).send({ error: 'Error interno del servidor', code: 'internal_error' } satisfies ApiError);
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.logLevel },
    trustProxy: true,
    bodyLimit: env.jsonBodyLimitBytes,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: [...env.allowedOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
  });

  // Un cuerpo vacío con `Content-Type: application/json` (típico en un POST sin
  // datos, como el cierre de sesión) no es un error de validación: se trata
  // como objeto vacío. Sin esto Fastify responde 400.
  app.addContentTypeParser<string>('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (raw === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(raw));
    } catch {
      const error = new SyntaxError('El cuerpo de la petición no es JSON válido') as SyntaxError & { statusCode?: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  app.addHook('onRequest', csrfGuard);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: `Ruta no encontrada: ${request.method} ${request.url}`, code: 'route_not_found' } satisfies ApiError);
  });

  await registerRoutes(app);
  return app;
}

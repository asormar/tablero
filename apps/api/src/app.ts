/**
 * Construcción de la aplicación Fastify: plugins, guardas y error handler.
 *
 * Orden: cookie → CORS → rate limit → guarda CSRF → rutas → errores.
 */

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { Prisma } from '@prisma/client';
import { formatZodError, type ApiError } from '@tablero/shared';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { env } from './env.js';
import { HttpError } from './lib/errors.js';
import { registerRoutes } from './routes/index.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Tope de caracteres del método+ruta en los mensajes de error (y en los logs). */
export const MAX_URL_IN_MESSAGE = 200;

/**
 * Método + URL para un mensaje de error, acotado: un id de 10 000 caracteres no
 * tiene por qué viajar entero en la respuesta del 404 ni en el log.
 */
export function shortenUrl(url: string, max: number = MAX_URL_IN_MESSAGE): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max)}… (${url.length} caracteres)`;
}

/**
 * Stack sin rutas absolutas: cada frame queda como `archivo.ts:línea:columna`.
 * Un `err` serializado por pino guarda el stack completo con las rutas de la
 * máquina (`C:\Users\…`), que no aportan nada al diagnóstico y filtran la
 * estructura del host en los logs.
 */
export function sanitizeErrorStack(stack: string | undefined, maxLines = 20): string | undefined {
  if (!stack) return undefined;
  return stripAbsolutePaths(stack, maxLines);
}

/** `file:///C:/a/b/x.ts` (los módulos ESM de Node en Windows) → solo el nombre. */
const FILE_URL_PATH = /file:\/\/+(?:[^\s()"']*\/)([^\s()"'/]+)/g;

/**
 * Ruta absoluta de Windows (`C:\a\b\x.ts` o `C:/a/b/x.ts`) → solo el nombre.
 * El lookbehind evita comerse `s:/` de una URL (`https://…`).
 */
const WINDOWS_PATH = /(?<![\w:/])[A-Za-z]:[\\/](?:[^\s()"']*[\\/])*([^\s()"'\\/]+)/g;

/** Ruta absoluta POSIX (`/a/b/x.ts`) → solo el nombre (no toca URLs `http://…`). */
const POSIX_PATH = /(^|[\s"'(])\/(?:[^\s()"']*\/)*([^\s()"'/]+)/g;

/**
 * Quita las rutas absolutas de un texto (el mensaje y el stack de un `Error`):
 * queda el nombre del archivo, que es lo que sirve para ubicar el fallo.
 */
export function stripAbsolutePaths(text: string, maxLines?: number): string {
  const lines = text.split('\n');
  const selected = maxLines === undefined ? lines : lines.slice(0, maxLines);
  return selected
    .map((line) =>
      line
        .replace(FILE_URL_PATH, '$1')
        .replace(WINDOWS_PATH, '$1')
        .replace(POSIX_PATH, (_match, prefix: string, file: string) => `${prefix}${file}`),
    )
    .join('\n');
}

/** Datos de un error para el log: nombre, mensaje y stack sin rutas absolutas. */
export function describeErrorForLog(error: Error): { name: string; message: string; stack?: string } {
  const description: { name: string; message: string; stack?: string } = {
    name: error.name,
    message: stripAbsolutePaths(error.message),
  };
  const stack = sanitizeErrorStack(error.stack);
  if (stack) description.stack = stack;
  return description;
}

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

  // Captura con token personal (§7.8): los atajos de iOS/Android y los scripts
  // llegan sin `Origin`. Una petición que trae `Authorization` o
  // `X-Capture-Token` no puede ser un CSRF de navegador (esas cabeceras exigen
  // preflight y el preflight lo corta CORS), y la ruta valida el token.
  const tokenHeader = request.headers.authorization ?? request.headers['x-capture-token'];
  if (typeof tokenHeader === 'string' && tokenHeader.length > 0) return;

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

export function errorHandler(this: FastifyInstance, error: Error, request: FastifyRequest, reply: FastifyReply): void {
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
    request.log.warn({ ...describeErrorForLog(error), code: error.code }, 'Error de Prisma no mapeado');
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

  // Un 500 no es un error de la petición: se registra en `warn` con el stack
  // recortado (sin rutas absolutas de la máquina) y el cliente recibe un
  // mensaje genérico, sin detalles internos.
  request.log.warn(describeErrorForLog(error), 'Error no controlado');
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

  // Subidas de archivos (multipart/form-data). El tamaño máximo sale de
  // MAX_UPLOAD_MB; al excederlo el plugin corta el flujo y la ruta responde 413.
  await app.register(multipart, {
    limits: {
      fileSize: env.maxUploadMb * 1024 * 1024,
      files: 1,
      fields: 10,
      fieldSize: 4096,
    },
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
    reply
      .code(404)
      .send({ error: `Ruta no encontrada: ${request.method} ${shortenUrl(request.url)}`, code: 'route_not_found' } satisfies ApiError);
  });

  await registerRoutes(app);
  return app;
}

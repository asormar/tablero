/**
 * Error handler y 404 del servidor: un id enorme en la ruta no viaja entero en
 * la respuesta y los 500 se registran en `warn` sin rutas absolutas.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

// El logger del servidor real (pino) se silencia antes de importar `app.ts`:
// las pruebas del 404 no ensucian la salida con la ruta de 10 000 caracteres.
process.env.LOG_LEVEL = 'silent';

const { MAX_URL_IN_MESSAGE, buildApp, describeErrorForLog, errorHandler, sanitizeErrorStack, shortenUrl, stripAbsolutePaths } =
  await import('./app.js');

describe('shortenUrl', () => {
  it('deja intacta una ruta corta y acota una larga', () => {
    expect(shortenUrl('/api/boards/bd_1/document')).toBe('/api/boards/bd_1/document');

    const long = `/api/boards/${'a'.repeat(10_000)}`;
    const shortened = shortenUrl(long);
    expect(shortened.length).toBeLessThan(MAX_URL_IN_MESSAGE + 40);
    expect(shortened).toContain(`(${long.length} caracteres)`);
  });
});

describe('sanitizeErrorStack', () => {
  it('reduce cada frame al nombre del archivo, sin rutas de la máquina', () => {
    const stack = [
      'Error: boom',
      '    at handler (C:\\Users\\Alejandro\\source\\repos\\tablero\\apps\\api\\src\\app.ts:107:11)',
      '    at file:///C:/Users/Alejandro/source/repos/tablero/node_modules/lib0/error.js:12:28',
      '    at /home/user/apps/api/src/lib/thing.ts:20:5',
    ].join('\n');

    const sanitized = sanitizeErrorStack(stack);
    expect(sanitized).toContain('app.ts:107:11');
    expect(sanitized).toContain('error.js:12:28');
    expect(sanitized).toContain('thing.ts:20:5');
    expect(sanitized).not.toContain('C:\\Users');
    expect(sanitized).not.toContain('C:/Users');
    expect(sanitized).not.toContain('/home/user');
    expect(sanitized).not.toContain('source\\repos');
  });

  it('recorta el stack a las primeras líneas y tolera `undefined`', () => {
    expect(sanitizeErrorStack(undefined)).toBeUndefined();
    const long = ['Error: boom', ...Array.from({ length: 40 }, (_, index) => `    at f${index} (C:\\x\\f${index}.ts:1:1)`)].join('\n');
    expect(sanitizeErrorStack(long, 5)!.split('\n')).toHaveLength(5);
  });
});

describe('error handler', () => {
  /** `request`/`reply` mínimos: sólo lo que usa el handler. */
  function fake(error: Error): { logs: { payload: unknown; message: string }[]; status: number; body: unknown } {
    const logs: { payload: unknown; message: string }[] = [];
    const result = { logs, status: 0, body: undefined as unknown };
    const request = {
      log: { warn: (payload: unknown, message: string) => logs.push({ payload, message }) },
    } as unknown as FastifyRequest;
    const reply = {
      code(status: number) {
        result.status = status;
        return {
          send(body: unknown) {
            result.body = body;
          },
        };
      },
    } as unknown as FastifyReply;
    errorHandler.call({} as FastifyInstance, error, request, reply);
    return result;
  }

  it('un error no controlado responde 500 y se registra en warn sin rutas absolutas', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at handler (C:\\Users\\Alejandro\\source\\repos\\tablero\\apps\\api\\src\\x.ts:9:9)';

    const { logs, status, body } = fake(error);
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'Error interno del servidor', code: 'internal_error' });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.message).toBe('Error no controlado');
    const payload = logs[0]!.payload as { name: string; message: string; stack?: string };
    expect(payload.name).toBe('Error');
    expect(payload.message).toBe('boom');
    expect(payload.stack).toContain('x.ts:9:9');
    expect(JSON.stringify(payload)).not.toContain('C:\\Users');
    expect(JSON.stringify(payload)).not.toContain('source\\repos');
  });

  it('`describeErrorForLog` tampoco deja rutas absolutas en el mensaje', () => {
    const error = new Error('no se pudo abrir C:\\Users\\Alejandro\\datos\\x.json');
    const described = describeErrorForLog(error);
    expect(described.message).toBe('no se pudo abrir x.json');
    expect(JSON.stringify(described)).not.toContain('C:\\Users');
  });

  it('las URLs de un mensaje quedan intactas (solo se recortan rutas de archivo)', () => {
    expect(stripAbsolutePaths('falló https://example.com/api/boards/bd_1/tasks')).toBe(
      'falló https://example.com/api/boards/bd_1/tasks',
    );
  });
});

describe('404 de ruta desconocida', () => {
  it('acota el id recibido en el mensaje (10 000 caracteres)', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: `/api/desconocida/${'b'.repeat(10_000)}` });
    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: string; code: string };
    expect(body.code).toBe('route_not_found');
    expect(body.error.length).toBeLessThan(300);
    expect(body.error).toContain('(10017 caracteres)');
    await app.close();
  });

  it('una ruta corta sigue devolviendo el método y la ruta tal cual', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/no-existe' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Ruta no encontrada: GET /api/no-existe');
    await app.close();
  });
});

/** Errores HTTP tipados: el error handler global los traduce a `ApiError`. */

import type { ApiError } from '@tablero/shared';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code ?? defaultCode(statusCode);
    if (details !== undefined) this.details = details;
  }

  toApiError(): ApiError {
    const payload: ApiError = { error: this.message, code: this.code };
    if (this.details !== undefined) payload.details = this.details;
    return payload;
  }
}

function defaultCode(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    default:
      return 'error';
  }
}

export const badRequest = (message: string, code?: string, details?: unknown) =>
  new HttpError(400, message, code, details);
export const unauthorized = (message = 'Necesitás iniciar sesión', code?: string) =>
  new HttpError(401, message, code);
export const forbidden = (message = 'No tenés permiso para esta acción', code?: string) =>
  new HttpError(403, message, code);
export const notFound = (message = 'Recurso no encontrado', code?: string) =>
  new HttpError(404, message, code);
export const conflict = (message: string, code?: string, details?: unknown) =>
  new HttpError(409, message, code, details);

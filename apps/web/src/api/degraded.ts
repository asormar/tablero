/**
 * Degradación de las superficies de la fase 5.
 *
 * La API de colaboración (miembros, invitaciones, publicación, comentarios,
 * actividad, notificaciones) puede no estar todavía: en ese caso la interfaz
 * **no se rompe** — avisa y sigue. Mismo criterio que la fase 4: un endpoint que
 * falta se trata como «sin conexión», no como un error fatal.
 */

import { ApiError } from './client';

/** La ruta no existe (o todavía no): 404, 405 y 501 son «todavía no está». */
export function isMissingEndpoint(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 404 || error.status === 405 || error.status === 501;
  return false;
}

/** La API no responde (red caída o timeout). */
export function isOffline(error: unknown): boolean {
  return error instanceof ApiError && (error.isOffline || error.status === -1);
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.isUnauthorized;
}

/** Sin permiso: el servidor respondió 403. */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

/**
 * Texto del aviso para una operación que no se pudo completar. Distingue lo que
 * el usuario puede arreglar (permiso, sesión) de lo que no (servidor).
 */
export function degradationMessage(error: unknown, feature: string): string {
  if (isMissingEndpoint(error)) return `${feature}: la API todavía no expone esta función.`;
  if (isOffline(error)) return `${feature}: la API no responde.`;
  if (isUnauthorized(error)) return `${feature}: hay que iniciar sesión.`;
  if (isForbidden(error)) return `${feature}: tu rol no lo permite.`;
  const message = error instanceof Error ? error.message : String(error);
  return `${feature}: ${message}`;
}

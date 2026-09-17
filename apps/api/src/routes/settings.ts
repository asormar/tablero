/**
 * Ajustes (§7.7 del plan): `GET/PATCH /api/settings` y rotación del token de
 * captura.
 *
 * Viven en `User.settings` (JSON) y se devuelven siempre completos, con los
 * valores por defecto aplicados, para que el cliente no tenga que adivinar.
 * El **token personal de captura** también se muestra acá (lo pide §7.8: «el
 * token se muestra en ajustes») y se puede **rotar** con
 * `POST /api/settings/capture-token`: genera uno nuevo y el anterior queda
 * inválido en el acto (el token viejo ya no resuelve a ninguna cuenta).
 */

import type { FastifyInstance } from 'fastify';
import { updateSettingsSchema, userSettingsSchema } from '@tablero/shared';
import type { UserSettings } from '@tablero/shared';
import type { z } from 'zod';

import { prisma } from '../db.js';
import { currentUser } from '../lib/session.js';
import { createCaptureToken } from '../lib/users.js';

/** Esquema de cada ajuste, tomado del esquema compartido (una sola verdad). */
const USER_SETTING_FIELDS: Record<keyof UserSettings, z.ZodTypeAny> = userSettingsSchema.shape;

/** Valores por defecto del producto (español, fondo de puntos, guías activas). */
export const DEFAULT_SETTINGS: Required<UserSettings> = {
  theme: 'system',
  language: 'es',
  canvasBackground: 'dots',
  showGuides: true,
  snapToGrid: true,
  showMinimap: false,
};

/**
 * Ajustes efectivos: los guardados (validados **campo por campo**, por si la
 * columna trae basura de una versión anterior) sobre los valores por defecto.
 * Un campo inválido no tira abajo los demás.
 */
export function resolveSettings(stored: unknown): Required<UserSettings> {
  const source = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const result: Required<UserSettings> = { ...DEFAULT_SETTINGS };
  for (const [key, schema] of Object.entries(USER_SETTING_FIELDS) as [keyof UserSettings, z.ZodTypeAny][]) {
    const parsed = schema.safeParse(source[key]);
    if (parsed.success && parsed.data !== undefined) {
      result[key] = parsed.data as never;
    }
  }
  return result;
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings', async (request) => {
    const user = currentUser(request);
    // `captureToken` no viaja en la sesión (AuthedUser se devuelve tal cual en
    // `GET /auth/me`), así que se lee acá: solo los ajustes lo muestran.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { settings: true, captureToken: true },
    });
    return { settings: resolveSettings(row.settings), captureToken: row.captureToken };
  });

  app.patch('/settings', async (request) => {
    const user = currentUser(request);
    const patch = updateSettingsSchema.parse(request.body ?? {});
    const merged = { ...resolveSettings(user.settings), ...patch };
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { settings: merged },
      select: { settings: true, captureToken: true },
    });
    return { settings: resolveSettings(updated.settings), captureToken: updated.captureToken };
  });

  /**
   * Rotación del token de captura. Sin cuerpo: genera uno nuevo aleatorio y el
   * anterior deja de existir (no hay período de gracia). Lo que estaba
   * configurado con el token viejo (atajos, scripts) empieza a recibir 401
   * `invalid_capture_token` y hay que actualizarlo.
   */
  app.post('/settings/capture-token', async (request) => {
    const user = currentUser(request);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { captureToken: createCaptureToken() },
      select: { captureToken: true },
    });
    return { captureToken: updated.captureToken };
  });
}

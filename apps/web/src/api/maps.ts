/**
 * Cliente de la búsqueda de lugares (`GET /api/maps/search`).
 *
 * La búsqueda **no** la hace el navegador contra Nominatim: pasa por la API, que
 * manda su propio `User-Agent` y aplica su límite de tasa. Si el endpoint no
 * está disponible, se devuelve una lista vacía y la tarjeta lo dice.
 */

import { type GeocodeResult, geocodeResponseSchema } from '@tablero/shared';

import { apiRequest } from './client';

export async function searchPlaces(query: string, limit = 5): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const payload = await apiRequest<unknown>('/maps/search', { query: { q: trimmed, limit } });
  const parsed = geocodeResponseSchema.safeParse(payload);
  if (!parsed.success) return [];
  return parsed.data.results;
}

/**
 * GET /api/maps/search?q=&limit= — búsqueda de lugares para la tarjeta de mapa.
 *
 * Proxy de Nominatim: la consulta la hace el servidor (nunca el navegador) con
 * un `User-Agent` propio, límite de una consulta por segundo y caché corta. El
 * detalle está en `lib/geocode.ts`; acá solo se valida la entrada, se llama al
 * cliente compartido y se responde con la forma de `geocodeResponseSchema`.
 */

import type { FastifyInstance } from 'fastify';
import { geocodeResponseSchema } from '@tablero/shared';
import { z } from 'zod';

import { geocoder } from '../lib/geocode.js';
import { currentUser } from '../lib/session.js';

const mapsSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  /** Nominatim no aporta más de 10 resultados útiles (`nominatimSearchUrl` lo recorta). */
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export async function mapsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/maps/search', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    currentUser(request);
    const query = mapsSearchQuerySchema.parse(request.query ?? {});
    const { results, cached } = await geocoder().search(query.q, query.limit);
    // `geocodeResponseSchema` es el contrato con la web; `cached` es informativo.
    const payload = geocodeResponseSchema.parse({ results });
    return { ...payload, cached };
  });
}

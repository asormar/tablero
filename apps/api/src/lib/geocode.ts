/**
 * Búsqueda de lugares (`GET /api/maps/search`): proxy de Nominatim.
 *
 * El navegador nunca llama a Nominatim: la [política de uso](https://operations.osmfoundation.org/policies/nominatim)
 * exige identificar la aplicación con un `User-Agent` propio, no pasar de una
 * consulta por segundo y cachear los resultados. Eso solo se puede cumplir del
 * lado del servidor, y acá está:
 *
 * - `User-Agent` propio (configurable con `GEOCODE_USER_AGENT`).
 * - **Una consulta por segundo por proceso**: las consultas se serializan en una
 *   cadena y cada una espera el hueco que deja la anterior (`GEOCODE_MIN_INTERVAL_MS`).
 * - **Caché corta en memoria** de 10 minutos (`GEOCODE_CACHE_TTL_MS`), acotada a
 *   200 consultas distintas para no crecer sin control.
 * - Si Nominatim no contesta o responde con error, sale `502` (nunca se inventa
 *   un resultado vacío que parezca «no hay coincidencias»).
 *
 * Las dependencias (reloj, espera, `fetch`) se inyectan para poder testear el
 * límite de tasa y la caché sin tocar la red.
 */

import type { GeocodeResult } from '@tablero/shared';
import { nominatimSearchUrl, parseNominatimResults } from '@tablero/shared';

import { env } from '../env.js';
import { HttpError } from './errors.js';

const CACHE_MAX_ENTRIES = 200;
const REQUEST_TIMEOUT_MS = 8000;

export type GeocodeDeps = {
  /** `fetch` inyectable (en producción, el global). */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Overrides de configuración (los tests los usan para no esperar de verdad). */
  minIntervalMs?: number;
  cacheTtlMs?: number;
  userAgent?: string;
};

export type GeocodeOutcome = {
  results: GeocodeResult[];
  /** `true` si salió de la caché (no hubo consulta a Nominatim). */
  cached: boolean;
};

type CacheEntry = { at: number; results: GeocodeResult[] };

function cacheKey(query: string, limit: number): string {
  return `${limit}:${query.trim().toLowerCase()}`;
}

/** Cliente de geocodificación con límite de tasa y caché por instancia. */
export class GeocodeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly userAgent: string;
  private readonly cache = new Map<string, CacheEntry>();
  /** Serializa las consultas: la cola garantiza una salida a la vez. */
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = Number.NEGATIVE_INFINITY;

  constructor(deps: GeocodeDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.minIntervalMs = deps.minIntervalMs ?? env.geocode.minIntervalMs;
    this.cacheTtlMs = deps.cacheTtlMs ?? env.geocode.cacheTtlMs;
    this.userAgent = deps.userAgent ?? env.geocode.userAgent;
  }

  async search(query: string, limit: number): Promise<GeocodeOutcome> {
    const key = cacheKey(query, limit);
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.cacheTtlMs) {
      return { results: hit.results, cached: true };
    }

    const results = await this.enqueue(() => this.request(query, limit));
    this.storeInCache(key, results);
    return { results, cached: false };
  }

  /**
   * Encola un pedido respetando el intervalo mínimo entre consultas. Si el
   * cuerpo lanza, la cadena no se rompe: la consulta siguiente vuelve a esperar
   * su hueco desde cero.
   */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();
      return work();
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private storeInCache(key: string, results: GeocodeResult[]): void {
    this.cache.set(key, { at: this.now(), results });
    // Desalojo del más viejo: `Map` conserva el orden de inserción.
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }

  /** Consulta real a Nominatim (ya con el turno de tasa tomado). */
  private async request(query: string, limit: number): Promise<GeocodeResult[]> {
    const url = nominatimSearchUrl(query, limit);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          // Identifica la aplicación: sin esto Nominatim puede bloquear el acceso.
          'user-agent': this.userAgent,
          accept: 'application/json',
          'accept-language': 'es',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new HttpError(
        502,
        `No se pudo consultar el buscador de lugares: ${(error as Error).message}`,
        'geocode_unreachable',
      );
    }

    if (!response.ok) {
      throw new HttpError(
        502,
        `El buscador de lugares respondió ${response.status}`,
        'geocode_upstream_error',
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new HttpError(502, 'El buscador de lugares devolvió una respuesta ilegible', 'geocode_bad_response');
    }
    return parseNominatimResults(body);
  }
}

let shared: GeocodeClient | null = null;

/** Cliente compartido del proceso: así el límite de 1 req/s es global. */
export function geocoder(): GeocodeClient {
  shared ??= new GeocodeClient();
  return shared;
}

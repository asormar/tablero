/**
 * Cliente HTTP tipado.
 *
 * Todas las llamadas salen por aquí para tener un único punto donde traducir
 * fallos de red y respuestas de error a un `ApiError` predecible. La app nunca
 * debe romperse porque la API no responda: los llamantes capturan `ApiError` y
 * siguen funcionando en local.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, status: number, code = 'unknown', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Sin respuesta del servidor (red caída, DNS, CORS, timeout). */
  get isOffline(): boolean {
    return this.status === 0;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

function resolveBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (configured && configured.length > 0) return configured.replace(/\/+$/, '');
  return '/api';
}

/** Base de la API REST (`/api` en desarrollo, proxied por Vite). */
export const API_BASE_URL = resolveBaseUrl();

export type QueryValue = string | number | boolean | undefined | null;

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8000;

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function extractError(payload: unknown, status: number): { message: string; code: string; details: unknown } {
  if (typeof payload === 'string' && payload.trim().length > 0) {
    return { message: payload.trim(), code: 'http_error', details: payload };
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const nested = record['error'];
    if (nested && typeof nested === 'object') {
      const inner = nested as Record<string, unknown>;
      const message = typeof inner['message'] === 'string' ? inner['message'] : undefined;
      const code = typeof inner['code'] === 'string' ? inner['code'] : undefined;
      if (message) return { message, code: code ?? 'http_error', details: payload };
    }
    if (typeof nested === 'string' && nested.length > 0) {
      return { message: nested, code: 'http_error', details: payload };
    }
    if (typeof record['message'] === 'string' && record['message'].length > 0) {
      return {
        message: record['message'],
        code: typeof record['code'] === 'string' ? record['code'] : 'http_error',
        details: payload,
      };
    }
  }
  return { message: `Error ${status}`, code: 'http_error', details: payload };
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return null;
  const type = response.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) return await response.json();
    const text = await response.text();
    if (text.length === 0) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

/**
 * Ejecuta una petición y devuelve el JSON tipado.
 * @throws ApiError en cualquier fallo (incluida la caída de red, con status 0)
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', externalAbort, { once: true });

  const headers: Record<string, string> = { Accept: 'application/json' };
  const method = options.method ?? 'GET';
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: 'include',
      signal: controller.signal,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    const payload = await parseBody(response);
    if (!response.ok) {
      const { message, code, details } = extractError(payload, response.status);
      throw new ApiError(message, response.status, code, details);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      const timedOut = !options.signal?.aborted;
      throw new ApiError(
        timedOut ? 'La API tardó demasiado en responder' : 'Petición cancelada',
        timedOut ? 0 : -1,
        timedOut ? 'timeout' : 'aborted',
      );
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new ApiError(`No se pudo conectar con la API (${reason})`, 0, 'network_error');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', externalAbort);
  }
}

/** ¿La API está viva? Nunca lanza. */
export async function pingApi(timeoutMs = 2500): Promise<boolean> {
  try {
    await apiRequest<unknown>('/health', { timeoutMs });
    return true;
  } catch {
    return false;
  }
}

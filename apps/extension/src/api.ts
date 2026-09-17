/**
 * Cliente del API de Tablero: `POST /api/capture` (token personal en la
 * cabecera `X-Capture-Token`) y `GET /api/health` para la sonda de conexión.
 *
 * Lo usa el service worker, que es el único que hace red: así la petición no se
 * corta si el popup se cierra mientras viaja.
 */

import type { CaptureOutcome, CapturePayload, ConnectionOutcome, Settings } from './types.js';

/**
 * Id de tablero inexistente a propósito para la prueba de conexión: el API
 * autentica primero (401 con token inválido) y responde 404 al no encontrarlo,
 * sin escribir nada. Es la única forma de validar el token sin crear una nota.
 */
export const PROBE_BOARD_ID = 'tablero-extension-prueba-de-conexion';

const PROBE_TEXT = 'Tablero: prueba de conexión de la extensión.';

/** Arma la URL del API tolerando que la base venga con o sin `/api`. */
export function apiUrl(baseUrl: string, path: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '');
  const prefix = /\/api$/.test(root) ? '' : '/api';
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${root}${prefix}${suffix}`;
}

/**
 * Texto de la nota: título, selección y URL (una por línea, sin repetir lo que
 * ya esté incluido). Es la misma composición que hace la PWA al compartir.
 */
export function composeCaptureText(page: { title: string; selection: string; url: string }): string {
  const lines: string[] = [];
  const push = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    if (lines.some((line) => line.includes(trimmed))) return;
    lines.push(trimmed);
  };
  push(page.title);
  push(page.selection);
  push(page.url);
  return lines.join('\n');
}

type ApiBody = { error?: string; code?: string } & Record<string, unknown>;

async function readBody(response: Response): Promise<ApiBody> {
  try {
    const value = (await response.json()) as unknown;
    return typeof value === 'object' && value !== null ? (value as ApiBody) : {};
  } catch {
    return {};
  }
}

function describeNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 0 ? message : 'error de red';
}

function captureHeaders(token: string): Record<string, string> {
  return { 'content-type': 'application/json', 'X-Capture-Token': token };
}

export async function sendCapture(settings: Settings, payload: CapturePayload): Promise<CaptureOutcome> {
  const base = settings.apiBaseUrl.trim();
  if (base.length === 0) {
    return { ok: false, kind: 'api_error', error: 'Falta la URL base del API (Ajustes)' };
  }
  if (settings.captureToken.length === 0) {
    return { ok: false, kind: 'missing_token', error: 'Falta el token personal: pegalo en Ajustes' };
  }

  const body: Record<string, unknown> = { type: payload.type, text: payload.text };
  if (payload.imageDataUrl !== undefined && payload.imageDataUrl.length > 0) {
    body['imageDataUrl'] = payload.imageDataUrl;
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(base, '/capture'), {
      method: 'POST',
      headers: captureHeaders(settings.captureToken),
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      kind: 'unreachable',
      error: `No se pudo contactar el API en ${base} (${describeNetworkError(error)})`,
    };
  }

  const data = await readBody(response);
  if (!response.ok) {
    const message = typeof data.error === 'string' && data.error.length > 0 ? data.error : `El API respondió ${response.status}`;
    const code = typeof data.code === 'string' ? data.code : undefined;
    return {
      ok: false,
      kind: response.status === 401 ? 'invalid_token' : 'api_error',
      status: response.status,
      code,
      error: message,
    };
  }

  return {
    ok: true,
    boardId: typeof data['boardId'] === 'string' ? data['boardId'] : '',
    boardTitle: typeof data['boardTitle'] === 'string' ? data['boardTitle'] : '',
    elementId: typeof data['elementId'] === 'string' ? data['elementId'] : null,
    live: data['live'] === true,
  };
}

/**
 * Prueba de conexión en dos pasos, para distinguir los tres finales posibles:
 *
 *   1. `GET /api/health`  → ¿hay un API de Tablero del otro lado?
 *   2. `POST /api/capture` con un `boardId` inexistente → ¿el token sirve?
 *
 * Paso 2 no crea nada (ver `PROBE_BOARD_ID`).
 */
export async function probeConnection(settings: Settings): Promise<ConnectionOutcome> {
  const base = settings.apiBaseUrl.trim();
  if (base.length === 0) {
    return { ok: false, kind: 'api_error', error: 'Falta la URL base del API' };
  }
  if (settings.captureToken.length === 0) {
    return { ok: false, kind: 'missing_token', error: 'Todavía no guardaste el token personal' };
  }

  let health: Response;
  try {
    health = await fetch(apiUrl(base, '/health'), { method: 'GET', cache: 'no-store' });
  } catch (error) {
    return {
      ok: false,
      kind: 'unreachable',
      error: `No se pudo contactar el API en ${base} (${describeNetworkError(error)})`,
    };
  }
  if (!health.ok) {
    return {
      ok: false,
      kind: 'unreachable',
      status: health.status,
      error: `Hay algo escuchando en ${base} pero no responde como el API de Tablero (GET /api/health → ${health.status})`,
    };
  }

  let probe: Response;
  try {
    probe = await fetch(apiUrl(base, '/capture'), {
      method: 'POST',
      headers: captureHeaders(settings.captureToken),
      body: JSON.stringify({ type: 'note', text: PROBE_TEXT, boardId: PROBE_BOARD_ID }),
    });
  } catch (error) {
    return {
      ok: false,
      kind: 'unreachable',
      error: `El API responde, pero la captura no se pudo enviar (${describeNetworkError(error)})`,
    };
  }

  const data = await readBody(probe);
  const code = typeof data.code === 'string' ? data.code : undefined;
  const message = typeof data.error === 'string' ? data.error : '';

  if (probe.status === 401) {
    return code === 'invalid_capture_token'
      ? { ok: false, kind: 'invalid_token', status: 401, code, error: message || 'Token de captura inválido' }
      : { ok: false, kind: 'missing_token', status: 401, code, error: message || 'Falta el token personal' };
  }

  // 404 (el tablero de prueba no existe) y 403 (sin rol) llegan **después** de
  // autenticar: el token es válido y el endpoint de captura está en su lugar.
  if (probe.status === 404 || probe.status === 403) {
    return {
      ok: true,
      message: `Token válido y API alcanzable (el sondeo sin efectos respondió ${probe.status} ${code ?? ''}`.trim() + ')',
    };
  }

  if (probe.status === 201) {
    // Imposible salvo que exista un tablero con ese id: no se toca nada.
    return { ok: true, message: 'Token válido y API alcanzable (el sondeo respondió 201)' };
  }

  return {
    ok: false,
    kind: 'api_error',
    status: probe.status,
    code,
    error: message || `El API respondió ${probe.status} en la prueba de conexión`,
  };
}

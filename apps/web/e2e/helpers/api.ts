/**
 * Ayudas de API para las pruebas de punta a punta.
 *
 * Todo lo que se comprueba «en el servidor» pasa por acá: cuentas nuevas por
 * prueba, lectura del documento **persistido** (decodificando el estado Yjs que
 * devuelve la API) y limpieza de lo que la prueba creó.
 */

import { randomBytes } from 'node:crypto';

import * as Y from 'yjs';
import { expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';

import { API_ORIGIN, TEST_EMAIL_PREFIX, WEB_ORIGIN } from '../env';

export type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
};

export type TestAccount = {
  email: string;
  name: string;
  password: string;
  userId: string;
  /** Tablero raíz de la cuenta (el que crea el registro). */
  rootBoardId: string;
  cookies: StoredCookie[];
};

export type BoardSummaryJson = {
  id: string;
  parentBoardId: string | null;
  title: string;
  trashedAt: number | null;
  elementCount?: number;
  role?: string;
  publishedSlug?: string | null;
};

export type PersistedElement = {
  id: string;
  type: string | null;
  deletedAt: number | null;
  /** Claves planas del elemento (x, y, width, items JSON, assetId…). */
  fields: Record<string, unknown>;
  /** Texto del `Y.XmlFragment` (solo tarjetas de texto). */
  text: string;
};

export type PersistedBoard = {
  elements: PersistedElement[];
  connectors: { id: string; start: unknown; end: unknown }[];
  order: string[];
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera sugerida por un 429 (el API limita el registro a 10 por minuto y IP). */
function retryDelayMs(response: APIResponse): number {
  const header = response.headers()['retry-after'];
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000 + 400;
  return 6_000;
}

export function uniqueEmail(label = 'test'): string {
  return `${TEST_EMAIL_PREFIX}${label}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}@example.test`;
}

export async function readJson<T>(api: APIRequestContext, url: string): Promise<T> {
  const response = await api.get(url);
  if (!response.ok()) {
    throw new Error(`GET ${url} → ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/**
 * Crea una cuenta nueva por la API y devuelve sus datos, su cookie de sesión y un
 * cliente HTTP ya autenticado (que la limpieza de la prueba reutiliza).
 *
 * Se registra por API (no por la interfaz) porque casi todos los flujos necesitan
 * una cuenta «ya adentro»: el registro y el ingreso por interfaz tienen sus
 * propias pruebas en `auth.spec.ts`.
 */
export async function createTestAccount(
  label = 'test',
): Promise<{ account: TestAccount; api: APIRequestContext }> {
  // El API exige `Origin` (o `Referer`) en toda petición mutante: es la guarda
  // CSRF. El contexto de prueba se presenta como si fuera la web de prueba.
  const context = await playwrightRequest.newContext({
    baseURL: API_ORIGIN,
    extraHTTPHeaders: { origin: WEB_ORIGIN },
  });
  const email = uniqueEmail(label);
  const name = `Cuenta ${label}`;
  const password = 'tablero-e2e-1234';
  try {
    let registered = false;
    for (let attempt = 0; attempt < 5 && !registered; attempt += 1) {
      const response = await context.post('/api/auth/register', { data: { email, name, password } });
      if (response.status() === 429) {
        await sleep(retryDelayMs(response));
        continue;
      }
      expect(response.status(), `registro: ${await response.text()}`).toBe(201);
      registered = true;
    }
    if (!registered) throw new Error('No se pudo registrar la cuenta de prueba: límite de registros del API');

    const me = await context.get('/api/auth/me');
    expect(me.ok(), `GET /api/auth/me → ${me.status()}`).toBe(true);
    const session = (await me.json()) as { user: { id: string }; boards: BoardSummaryJson[] };
    const root = session.boards.find((board) => board.parentBoardId === null);
    if (!root) throw new Error('La cuenta recién creada no tiene tablero raíz');

    const state = await context.storageState();
    return {
      account: {
        email,
        name,
        password,
        userId: session.user.id,
        rootBoardId: root.id,
        cookies: state.cookies as StoredCookie[],
      },
      api: context,
    };
  } catch (error) {
    await context.dispose();
    throw error;
  }
}

/** Decodifica el estado Yjs persistido de un tablero (la foto que ve el servidor). */
export async function fetchPersistedBoard(api: APIRequestContext, boardId: string): Promise<PersistedBoard> {
  const payload = await readJson<{ state: string }>(api, `/api/boards/${encodeURIComponent(boardId)}/document`);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(payload.state, 'base64'));

  const elements: PersistedElement[] = [];
  doc.getMap('elements').forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    const fields: Record<string, unknown> = {};
    for (const key of value.keys()) {
      const raw = value.get(key);
      if (key === 'text' || raw === undefined) continue;
      fields[key] = raw;
    }
    const fragment = value.get('text');
    elements.push({
      id,
      type: typeof fields['type'] === 'string' ? (fields['type'] as string) : null,
      deletedAt: typeof fields['deletedAt'] === 'number' ? (fields['deletedAt'] as number) : null,
      fields,
      text: fragment instanceof Y.XmlFragment ? fragment.toString() : '',
    });
  });

  const connectors: PersistedBoard['connectors'] = [];
  doc.getMap('connectors').forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    connectors.push({ id, start: value.get('from'), end: value.get('to') });
  });

  const order: string[] = [];
  doc.getArray('order').forEach((id) => {
    if (typeof id === 'string') order.push(id);
  });

  return { elements, connectors, order };
}

/**
 * Espera (con reintentos y sin esperas fijas) a que el servidor tenga persistido
 * lo que la prueba acaba de hacer en el lienzo. El cliente escribe con debounce
 * de 2 s, así que la foto tarda un momento en llegar.
 */
export async function waitForPersisted(
  api: APIRequestContext,
  boardId: string,
  predicate: (board: PersistedBoard) => boolean,
  timeout = 30_000,
): Promise<PersistedBoard> {
  const deadline = Date.now() + timeout;
  let last: PersistedBoard | null = null;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      last = await fetchPersistedBoard(api, boardId);
      if (predicate(last)) return last;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  const detail = last
    ? `elementos=${last.elements.length} conectores=${last.connectors.length} tipos=${[
        ...new Set(last.elements.map((element) => element.type)),
      ].join(',')}`
    : `error: ${lastError instanceof Error ? lastError.message : String(lastError)}`;
  throw new Error(`El documento persistido no llegó al estado esperado en ${timeout} ms (${detail})`);
}

/**
 * Limpieza de la prueba: tableros creados, sus subtableros y los archivos
 * subidos. La raíz y la bandeja «Sin ordenar» no se pueden borrar por API (el
 * servidor lo rechaza a propósito); las cuentas las borra el cierre de la
 * corrida (`global-teardown.ts`).
 */
export async function cleanupAccountData(api: APIRequestContext): Promise<void> {
  const created = await readJson<{ boards: BoardSummaryJson[] }>(api, '/api/boards');
  for (const board of created.boards) {
    if (board.parentBoardId === null) continue;
    await api.delete(`/api/boards/${encodeURIComponent(board.id)}`);
    await api.delete(`/api/trash/${encodeURIComponent(board.id)}`);
  }

  const trash = await readJson<{ boards: BoardSummaryJson[] }>(api, '/api/trash');
  for (const board of trash.boards) {
    if (board.parentBoardId === null) continue;
    await api.delete(`/api/trash/${encodeURIComponent(board.id)}`);
  }

  const assets = await readJson<{ assets: { id: string }[] }>(api, '/api/assets');
  for (const asset of assets.assets) {
    await api.delete(`/api/assets/${encodeURIComponent(asset.id)}`);
  }
}

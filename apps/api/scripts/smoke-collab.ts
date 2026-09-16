/**
 * Prueba de humo de tiempo real (queda en el repo).
 *
 *   # con la API y Postgres levantados:
 *   pnpm --filter @tablero/api smoke:collab
 *
 * Verifica, con ejecución real:
 *   1. Alta/login por HTTP y creación de un tablero hijo.
 *   2. Conexión al WebSocket `/collab` con la cookie de sesión, escritura de una
 *      clave en un `Y.Map` y de un elemento `todo` en el documento.
 *   3. Persistencia en Postgres: `BoardDocument.yjsState` tiene bytes.
 *   4. Reconexión: el contenido sigue ahí (lo sirve el estado persistido).
 *   5. La ruta REST de respaldo devuelve el mismo estado en base64.
 *   6. El índice de búsqueda y la vista de tareas ven el contenido escrito.
 */

import assert from 'node:assert/strict';

import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { PrismaClient } from '@prisma/client';
import { addElement, createBoardDoc, ELEMENTS_KEY } from '@tablero/shared';
import WebSocket from 'ws';
import * as Y from 'yjs';

import { loadDotEnv } from '../src/env.js';

loadDotEnv();

const API_URL = process.env.API_URL ?? 'http://localhost:8787';
const WS_URL = process.env.COLLAB_URL ?? 'ws://localhost:8787/collab';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const SMOKE_USER = {
  email: process.env.SMOKE_EMAIL ?? 'smoke@tablero.test',
  name: 'Smoke Test',
  password: process.env.SMOKE_PASSWORD ?? 'smoke-collab-2026',
};
const SMOKE_MAP_KEY = 'smoke';
const SMOKE_NOTE = `hola-collab-${Date.now()}`;
const SMOKE_TASK_TEXT = 'Revisar el tablero';

const prisma = new PrismaClient();
const checks: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  label: string,
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 20_000,
  intervalMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  console.log(`   (timeout esperando: ${label})`);
  return false;
}

type Json = Record<string, unknown>;

async function api(
  path: string,
  options: { method?: string; body?: Json; cookie?: string } = {},
): Promise<{ status: number; json: Json; cookie?: string }> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      origin: APP_ORIGIN,
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json: Json = {};
  try {
    json = text.length > 0 ? (JSON.parse(text) as Json) : {};
  } catch {
    json = { raw: text };
  }
  const setCookie = response.headers.getSetCookie().at(0);
  return {
    status: response.status,
    json,
    ...(setCookie ? { cookie: setCookie.split(';')[0] ?? '' } : {}),
  };
}

/** WebSocket con la cookie de sesión en el handshake (como hace el navegador). */
function cookieWebSocketFactory(sessionCookie: string): unknown {
  return class CookieWebSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, {
        headers: { Cookie: sessionCookie, Origin: APP_ORIGIN },
      });
    }
  };
}

/** Provider de Hocuspocus con la cookie viajando en el upgrade del WebSocket. */
function createProvider(document: Y.Doc, boardId: string, sessionCookie: string): HocuspocusProvider {
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: WS_URL,
    WebSocketPolyfill: cookieWebSocketFactory(sessionCookie),
  });
  return new HocuspocusProvider({
    websocketProvider,
    name: boardId,
    document,
    // El servidor autentica por cookie; este token solo dispara el mensaje de
    // autenticación del protocolo (el provider no lo envía si está vacío).
    token: 'cookie-session',
    broadcast: false,
    quiet: true,
  });
}

/** Cierra el provider y su socket (si no, el proceso queda vivo hasta el idle timeout). */
function closeProvider(provider: HocuspocusProvider): void {
  const socket = provider.configuration.websocketProvider;
  provider.destroy();
  socket.destroy();
}

async function login(): Promise<{ cookie: string; rootBoardId: string }> {
  let cookie: string;
  const registered = await api('/api/auth/register', { method: 'POST', body: SMOKE_USER });
  if (registered.status === 201 && registered.cookie) {
    console.log(`   usuario de humo creado (${SMOKE_USER.email})`);
    cookie = registered.cookie;
    record('registro HTTP', true, `status ${registered.status}`);
  } else {
    const logged = await api('/api/auth/login', {
      method: 'POST',
      body: { email: SMOKE_USER.email, password: SMOKE_USER.password },
    });
    if (logged.status !== 200 || !logged.cookie) {
      throw new Error(`Login falló (${logged.status}): ${JSON.stringify(logged.json)}`);
    }
    cookie = logged.cookie;
    record('login HTTP', true, `status ${logged.status}`);
  }

  const me = await api('/api/auth/me', { cookie });
  const boards = (me.json.boards ?? []) as Json[];
  const root = boards.find((board) => board.parentBoardId === null);
  if (!root) throw new Error('La cuenta no tiene tablero raíz');
  return { cookie, rootBoardId: String(root.id) };
}

async function main(): Promise<void> {
  console.log(`API: ${API_URL} · collab: ${WS_URL}\n`);

  const health = await api('/api/health');
  assert.equal(health.status, 200, 'la API no responde /api/health');
  console.log(`   health: ${JSON.stringify(health.json)}\n`);

  const { cookie, rootBoardId } = await login();
  record('sesión HTTP', cookie.startsWith('tablero_session='), cookie.split('=')[0] ?? '');

  const created = await api('/api/boards', {
    method: 'POST',
    cookie,
    body: { title: 'Smoke collab', parentBoardId: rootBoardId },
  });
  assert.equal(created.status, 201, `no se creó el tablero: ${JSON.stringify(created.json)}`);
  const boardId = String((created.json.board as Json).id);
  record('tablero de humo creado', true, boardId);

  // --- 1. Conexión, escritura y desconexión ---------------------------------
  const docA = createBoardDoc();
  const providerA = createProvider(docA, boardId, cookie);

  const syncedA = await waitFor('primer sync', () => providerA.synced, 15_000, 200);
  record('sync inicial por WebSocket', syncedA, `synced=${providerA.synced}`);
  if (!syncedA) throw new Error('El primer sync no llegó: ¿está la API levantada?');

  const noteMap = docA.getMap<string>(SMOKE_MAP_KEY);
  const elementId = addElement(
    docA,
    'todo',
    {
      createdBy: 'smoke',
      x: 40,
      y: 40,
      title: 'Tareas del humo',
      items: [
        {
          id: 'smoke-item-1',
          text: SMOKE_TASK_TEXT,
          checked: false,
          children: [],
          dueDate: new Date().toISOString().slice(0, 10),
          priority: 'high',
        },
      ],
    },
    'smoke',
  );
  noteMap.set('nota', SMOKE_NOTE);
  await sleep(1000);
  record('escritura en el Y.Map y en elements', true, `nota="${SMOKE_NOTE}" elemento=${elementId}`);

  const sentBefore = docA.getMap(ELEMENTS_KEY).size;
  closeProvider(providerA);
  await sleep(500);

  // --- 2. Persistencia en Postgres ------------------------------------------
  const persisted = await waitFor(
    'persistencia en BoardDocument',
    async () => {
      const row = await prisma.boardDocument.findUnique({ where: { boardId } });
      if (!row) return false;
      const bytes = new Uint8Array(row.yjsState);
      if (bytes.byteLength === 0) return false;
      const probe = new Y.Doc();
      Y.applyUpdate(probe, bytes);
      return probe.getMap(SMOKE_MAP_KEY).get('nota') === SMOKE_NOTE;
    },
    25_000,
    500,
  );
  const row = await prisma.boardDocument.findUnique({ where: { boardId } });
  const byteLength = row ? new Uint8Array(row.yjsState).byteLength : 0;
  record('BoardDocument.yjsState con bytes en Postgres', persisted && byteLength > 0, `${byteLength} bytes`);

  // --- 3. Reconexión: el contenido sigue ahí --------------------------------
  const docB = createBoardDoc();
  const providerB = createProvider(docB, boardId, cookie);
  const syncedB = await waitFor('segundo sync', () => providerB.synced, 15_000, 200);
  const noteAfter = docB.getMap<string>(SMOKE_MAP_KEY).get('nota');
  const elementsAfter = docB.getMap(ELEMENTS_KEY).size;
  record('contenido tras reconectar', syncedB && noteAfter === SMOKE_NOTE && elementsAfter >= 1, `nota="${String(noteAfter)}", elementos=${elementsAfter}`);
  closeProvider(providerB);

  // --- 4. Respaldo REST del documento ---------------------------------------
  const document = await api(`/api/boards/${boardId}/document`, { cookie });
  const state = String((document.json as Json).state ?? '');
  const decoded = Y.encodeStateAsUpdate(new Y.Doc());
  let restOk = state.length > 0;
  if (restOk) {
    const probe = new Y.Doc();
    Y.applyUpdate(probe, new Uint8Array(Buffer.from(state, 'base64')));
    restOk = probe.getMap(SMOKE_MAP_KEY).get('nota') === SMOKE_NOTE;
  }
  record('GET /api/boards/:id/document', document.status === 200 && restOk, `base64 ${state.length} chars (ref ${decoded.byteLength})`);
  if (!restOk) record('estado REST', restOk, `el estado decodificado no contiene ${SMOKE_NOTE}`);

  // --- 5. Búsqueda y tareas -------------------------------------------------
  const search = await api(`/api/search?q=${encodeURIComponent(SMOKE_TASK_TEXT)}`, { cookie });
  const results = (search.json.results ?? []) as Json[];
  const hit = results.some((item) => item.boardId === boardId && String(item.elementType) === 'todo');
  record('GET /api/search encuentra el texto del elemento', search.status === 200 && hit, `${results.length} resultados`);

  const tasks = await api('/api/tasks?filter=all', { cookie });
  const taskList = (tasks.json.tasks ?? []) as Json[];
  const taskHit = taskList.some((task) => task.boardId === boardId && task.text === SMOKE_TASK_TEXT);
  record('GET /api/tasks lista la tarea del documento', tasks.status === 200 && taskHit, `${taskList.length} tareas`);

  const sentAfter = elementsAfter;
  record('elementos conservados', sentAfter === sentBefore, `antes=${sentBefore} después=${sentAfter}`);
}

main()
  .catch((error: unknown) => {
    record('ejecución completa', false, String(error));
  })
  .finally(async () => {
    await prisma.$disconnect();
    const failed = checks.filter((check) => !check.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} verificaciones OK`);
    for (const check of failed) console.log(`  - FALLÓ: ${check.name} ${check.detail}`);
    process.exitCode = failed.length > 0 ? 1 : 0;
    // Red de seguridad: si algún socket quedara abierto, no colgamos el script.
    setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 5000).unref();
  });

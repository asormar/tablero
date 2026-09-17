/**
 * Humo de la fase 4 (productividad): búsqueda, reindexado, historial de
 * versiones, exportación, plantillas, captura, ajustes y almacenamiento.
 *
 *   # con la API y Postgres levantados:
 *   pnpm --filter @tablero/api smoke:productividad
 *
 * Variables: API_URL (http://localhost:8787), COLLAB_URL
 * (ws://localhost:<API>/collab) y APP_ORIGIN (http://localhost:5173).
 *
 * Verifica con ejecución real, entre otras cosas:
 *   - el índice se arma desde el documento Yjs persistido y la búsqueda
 *     devuelve grupos por tablero, fragmento con `<mark>` y posición;
 *   - el snapshot automático del historial (hook de persistencia) y que
 *     **restaurar cierra las conexiones** y devuelve el estado anterior;
 *   - el ZIP de exportación con entradas íntegras (CRC) y los archivos reales;
 *   - las doce plantillas del sistema con documento de verdad y el remapeo de
 *     tarjetas de tablero al instanciarlas;
 *   - la captura con token personal (sin `Origin`, como un atajo del móvil);
 *   - el listado de huérfanos de almacenamiento y su borrado.
 */

import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { createBoardDoc, ensureTextFragment, getOrderedElements, getTextFragment, fragmentToPlainText, addElement, writeTextParagraphs } from '@tablero/shared';
import WebSocket from 'ws';
import * as Y from 'yjs';

import { loadDotEnv } from '../src/env.js';
import { Crc32 } from '../src/lib/zip.js';

loadDotEnv();

const API_URL = process.env.API_URL ?? 'http://localhost:8787';
const WS_URL = process.env.COLLAB_URL ?? API_URL.replace(/^http/, 'ws') + '/collab';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const SMOKE_USER = {
  email: process.env.SMOKE_EMAIL ?? 'smoke-productividad@tablero.test',
  name: 'Humo Productividad',
  password: process.env.SMOKE_PASSWORD ?? 'smoke-productividad-2026',
};

type Json = Record<string, unknown>;
const checks: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label: string, predicate: () => Promise<boolean> | boolean, timeoutMs = 25_000, intervalMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  console.log(`   (timeout esperando: ${label})`);
  return false;
}

type ApiResponse = { status: number; json: Json; text: string; headers: Headers; cookie?: string };

async function api(
  path: string,
  options: { method?: string; body?: Json; cookie?: string; headers?: Record<string, string>; raw?: boolean } = {},
): Promise<ApiResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.raw ? {} : { 'content-type': 'application/json' }),
      origin: APP_ORIGIN,
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = buffer.toString('utf8');
  let json: Json = {};
  try {
    json = text.length > 0 ? (JSON.parse(text) as Json) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  const setCookie = response.headers.getSetCookie().at(0);
  return {
    status: response.status,
    json,
    text,
    headers: response.headers,
    ...(setCookie ? { cookie: setCookie.split(';')[0] ?? '' } : {}),
  };
}

/** WebSocket con la cookie de sesión en el handshake (como hace el navegador). */
function cookieWebSocketFactory(sessionCookie: string): unknown {
  return class CookieWebSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers: { Cookie: sessionCookie, Origin: APP_ORIGIN } });
    }
  };
}

function createProvider(document: Y.Doc, boardId: string, sessionCookie: string): HocuspocusProvider {
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: WS_URL,
    WebSocketPolyfill: cookieWebSocketFactory(sessionCookie),
  });
  return new HocuspocusProvider({
    websocketProvider,
    name: boardId,
    document,
    token: 'cookie-session',
    broadcast: false,
    quiet: true,
  });
}

function closeProvider(provider: HocuspocusProvider): void {
  const socket = provider.configuration.websocketProvider;
  provider.destroy();
  socket.destroy();
}

/** Lector mínimo del ZIP: entradas del directorio central + CRC de cada una. */
function readZip(buffer: Buffer): { name: string; crcOk: boolean; size: number; data: Buffer }[] {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'el ZIP no tiene fin de directorio central');
  const count = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  const entries: { name: string; crcOk: boolean; size: number; data: Buffer }[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, 'cabecera central inválida');
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    const crc32 = new Crc32();
    crc32.update(data);
    entries.push({
      name,
      crcOk: crc32.digest === crc && data.length === uncompressedSize,
      size: uncompressedSize,
      data,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function login(): Promise<{ cookie: string; rootBoardId: string }> {
  const registered = await api('/api/auth/register', { method: 'POST', body: SMOKE_USER });
  if (registered.status === 201 && registered.cookie) {
    console.log(`   usuario de humo creado (${SMOKE_USER.email})`);
    const me = await api('/api/auth/me', { cookie: registered.cookie });
    const root = ((me.json.boards ?? []) as Json[]).find((board) => board.parentBoardId === null);
    if (!root) throw new Error('La cuenta no tiene tablero raíz');
    return { cookie: registered.cookie, rootBoardId: String(root.id) };
  }
  const logged = await api('/api/auth/login', { method: 'POST', body: { email: SMOKE_USER.email, password: SMOKE_USER.password } });
  if (logged.status !== 200 || !logged.cookie) throw new Error(`Login falló (${logged.status}): ${JSON.stringify(logged.json)}`);
  const me = await api('/api/auth/me', { cookie: logged.cookie });
  const root = ((me.json.boards ?? []) as Json[]).find((board) => board.parentBoardId === null);
  if (!root) throw new Error('La cuenta no tiene tablero raíz');
  return { cookie: logged.cookie, rootBoardId: String(root.id) };
}

/** Espera a que el documento persistido contenga el texto indicado. */
async function waitForDocumentText(boardId: string, cookie: string, needle: string): Promise<boolean> {
  return waitFor(`persistencia de «${needle}»`, async () => {
    const response = await api(`/api/boards/${boardId}/document`, { cookie });
    if (response.status !== 200) return false;
    const state = String((response.json as Json).state ?? '');
    if (state.length === 0) return false;
    const doc = createBoardDoc();
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(state, 'base64')));
    return getOrderedElements(doc).some((element) => fragmentToPlainText(getTextFragment(doc, element.id)).includes(needle));
  });
}

function textOf(document: Y.Doc, elementId: string): string {
  return fragmentToPlainText(getTextFragment(document, elementId));
}

async function main(): Promise<void> {
  console.log(`API: ${API_URL} · collab: ${WS_URL}\n`);

  const health = await api('/api/health');
  assert.equal(health.status, 200, 'la API no responde /api/health');

  const { cookie, rootBoardId } = await login();
  record('sesión HTTP', cookie.startsWith('tablero_session='));

  // --- 1. Ajustes -----------------------------------------------------------
  const settings = await api('/api/settings', { cookie });
  const captureToken = String((settings.json as Json).captureToken ?? '');
  record(
    'GET /api/settings devuelve ajustes con valores por defecto y el token de captura',
    settings.status === 200 && captureToken.length >= 10 && (settings.json as Json).settings !== undefined,
    `token de ${captureToken.length} caracteres`,
  );
  const patched = await api('/api/settings', { method: 'PATCH', cookie, body: { theme: 'dark', canvasBackground: 'grid' } });
  const patchedSettings = (patched.json as Json).settings as Json;
  record(
    'PATCH /api/settings guarda el cambio y conserva el resto',
    patched.status === 200 && patchedSettings.theme === 'dark' && patchedSettings.canvasBackground === 'grid' && patchedSettings.language === 'es',
    JSON.stringify(patchedSettings),
  );

  // --- 2. Plantillas --------------------------------------------------------
  const templates = await api('/api/templates', { cookie });
  const templateList = ((templates.json as Json).templates ?? []) as Json[];
  const systemTemplates = templateList.filter((template) => template.system === true);
  record(
    'GET /api/templates lista las doce plantillas del sistema con categorías',
    templates.status === 200 && systemTemplates.length === 12,
    `${templateList.length} plantillas (${systemTemplates.length} del sistema)`,
  );
  const withCards = systemTemplates.filter((template) => Number(template.elementCount) >= 6);
  record(
    'las plantillas del sistema traen tarjetas de verdad (no un tablero vacío)',
    withCards.length === 12,
    withCards.map((template) => `${template.name}:${template.elementCount}`).join(' · '),
  );

  const kanban = templateList.find((template) => String(template.name).includes('kanban')) as Json | undefined;
  assert.ok(kanban, 'no está la plantilla kanban');
  const instantiated = await api(`/api/templates/${String(kanban.id)}/instantiate`, { method: 'POST', cookie, body: { parentBoardId: rootBoardId } });
  const projectBoard = ((instantiated.json as Json).board ?? {}) as Json;
  const projectBoardId = String(projectBoard.id ?? '');
  const instantiatedChildren = ((instantiated.json as Json).children ?? []) as Json[];
  record(
    'POST /api/templates/:id/instantiate crea el tablero y sus subtableros',
    instantiated.status === 201 && projectBoardId.length > 0 && instantiatedChildren.length === 1,
    `tablero ${projectBoardId}, ${instantiatedChildren.length} subtablero(s)`,
  );

  // El documento instanciado tiene las tarjetas y las tarjetas de tablero
  // apuntan a los tableros nuevos (remapeo), no a los del sistema.
  const instantiatedDoc = await api(`/api/boards/${projectBoardId}/document`, { cookie });
  const projectDoc = createBoardDoc();
  Y.applyUpdate(projectDoc, new Uint8Array(Buffer.from(String((instantiatedDoc.json as Json).state ?? ''), 'base64')));
  const projectElements = getOrderedElements(projectDoc);
  const boardCards = projectElements.filter((element) => element.type === 'board');
  const childId = String(instantiatedChildren[0]?.id ?? '');
  const remapped = boardCards.every((element) => (element as { boardId?: string }).boardId === childId);
  const columns = projectElements.filter((element) => element.type === 'column') as (typeof projectElements[number] & { title?: string })[];
  const columnsWithChildren = columns.filter((element) => {
    const map = projectDoc.getMap('elements').get(element.id) as Y.Map<unknown> | undefined;
    const children = map?.get('childrenIds');
    return children instanceof Y.Array && children.length > 0;
  }).length;
  record(
    'la instancia copia el documento (tarjetas, columnas con hijos) y remapea las tarjetas de tablero',
    projectElements.length >= 8 &&
      columns.length === 3 &&
      columnsWithChildren === columns.length &&
      remapped &&
      boardCards.length === 1 &&
      columns.some((column) => column.title === 'Por hacer'),
    `${projectElements.length} elementos, ${columns.length} columnas (${columnsWithChildren} con hijos), tarjeta de tablero → ${remapped ? 'copia' : 'origen'}`,
  );
  const childBoardIdFromCard = String((boardCards[0] as { boardId?: string } | undefined)?.boardId ?? '');
  const childBoardDoc = await api(`/api/boards/${childBoardIdFromCard}/document`, { cookie });
  const childDoc = createBoardDoc();
  Y.applyUpdate(childDoc, new Uint8Array(Buffer.from(String((childBoardDoc.json as Json).state ?? ''), 'base64')));
  const childElements = getOrderedElements(childDoc);
  const childHasContent = childElements.some((element) => {
    if (element.type === 'todo') return (element as { title?: string }).title === 'Decisiones abiertas';
    return textOf(childDoc, element.id).trim().length > 0;
  });
  record(
    'la tarjeta de tablero apunta a una copia propia y esa copia tiene contenido',
    childBoardDoc.status === 200 && childBoardIdFromCard === childId && childHasContent,
    `${childElements.length} elementos en el subtablero`,
  );
  const projectText = projectElements.map((element) => textOf(projectDoc, element.id)).find((text) => text.includes('Definir el alcance'));
  record('el texto de las tarjetas de la plantilla viaja en la copia', Boolean(projectText), projectText ? projectText.split('\n')[0] : 'sin texto');

  // Guardar como plantilla + instanciarla de nuevo.
  const asTemplate = await api(`/api/templates/from-board/${projectBoardId}`, {
    method: 'POST',
    cookie,
    body: { name: `Plantilla propia ${Date.now()}`, category: 'general', description: 'Humo de productividad' },
  });
  const ownTemplate = ((asTemplate.json as Json).template ?? {}) as Json;
  record(
    'POST /api/templates/from-board/:id guarda el tablero como plantilla',
    asTemplate.status === 201 && ownTemplate.system === false,
    `${String(ownTemplate.name)} (${String(asTemplate.json.boards)} tableros)`,
  );
  const fromOwn = await api(`/api/templates/${String(ownTemplate.id)}/instantiate`, { method: 'POST', cookie, body: { title: 'Copia de plantilla propia' } });
  record(
    'la plantilla propia se instancia con su contenido',
    fromOwn.status === 201 && Number((((fromOwn.json as Json).children ?? []) as unknown[]).length) === 1,
    `tablero ${String(((fromOwn.json as Json).board as Json).id)}`,
  );

  // --- 3. Captura rápida ----------------------------------------------------
  const captureText = `captura de humo ${Date.now()}`;
  const capture = await fetch(`${API_URL}/api/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${captureToken}` },
    body: JSON.stringify({ type: 'note', text: captureText }),
  });
  const captured = (await capture.json()) as Json;
  record(
    'POST /api/capture con token personal (sin Origin, como un atajo del móvil)',
    capture.status === 201 && captured.ok === true && String(captured.boardTitle) === 'Sin ordenar',
    `nota ${String(captured.elementId)} en «${String(captured.boardTitle)}» (live=${String(captured.live)})`,
  );
  const badToken = await fetch(`${API_URL}/api/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-capture-token': 'token-invalido' },
    body: JSON.stringify({ type: 'note', text: 'no debería entrar' }),
  });
  record('la captura con token inválido se rechaza', badToken.status === 401, `status ${badToken.status}`);

  // --- 4. Búsqueda ----------------------------------------------------------
  const searchOk = await waitFor('índice de búsqueda del texto capturado', async () => {
    const response = await api(`/api/search?q=${encodeURIComponent(captureText)}`, { cookie });
    return response.status === 200 && Number((response.json as Json).total) >= 1;
  });
  const search = await api(`/api/search?q=${encodeURIComponent(captureText)}`, { cookie });
  const groups = ((search.json as Json).groups ?? []) as Json[];
  const hit = ((groups[0]?.hits ?? []) as Json[])[0] as Json | undefined;
  const position = (hit?.position ?? null) as Json | null;
  record(
    'GET /api/search devuelve resultados agrupados por tablero',
    searchOk && groups.length >= 1 && Number((search.json as Json).total) >= 1,
    `${String((search.json as Json).total)} coincidencias en ${groups.length} tablero(s)`,
  );
  record(
    'el fragmento viene resaltado con <mark> y la posición del elemento',
    Boolean(hit) && String(hit?.headline ?? '').includes('<mark>') && position !== null && typeof position.x === 'number',
    `headline=${String(hit?.headline ?? '').slice(0, 60)} position=${JSON.stringify(position)}`,
  );

  // Acentos: buscar sin tilde encuentra el texto con tilde.
  const accented = 'reseña de diseño';
  const accentedNote = await fetch(`${API_URL}/api/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${captureToken}` },
    body: JSON.stringify({ type: 'note', text: accented }),
  });
  await accentedNote.text();
  const accentSearch = await waitFor('búsqueda sin acento', async () => {
    const response = await api('/api/search?q=resena', { cookie });
    const results = ((response.json as Json).results ?? []) as Json[];
    return results.some((item) => String(item.snippet).includes('reseña'));
  });
  record('la búsqueda sin acentos encuentra el texto con acentos (resena → reseña)', accentSearch);

  const reindex = await api('/api/search/reindex', { method: 'POST', cookie, body: {} });
  const reindexJson = reindex.json as Json;
  record(
    'POST /api/search/reindex recorre los tableros y reindexa los elementos',
    reindex.status === 200 && Number(reindexJson.boards) >= 2 && Number(reindexJson.elements) >= 4,
    `${String(reindexJson.boards)} tableros, ${String(reindexJson.elements)} elementos, ${String(reindexJson.skipped)} sin documento`,
  );

  // --- 5. Historial de versiones -------------------------------------------
  const versionsBoard = await api('/api/boards', { method: 'POST', cookie, body: { title: 'Historial de humo', parentBoardId: rootBoardId } });
  const versionsBoardId = String(((versionsBoard.json as Json).board as Json).id);
  const firstText = `primera versión ${Date.now()}`;

  const docA = createBoardDoc();
  const providerA = createProvider(docA, versionsBoardId, cookie);
  const syncedA = await waitFor('sync inicial del tablero de historial', () => providerA.synced, 15_000, 200);
  assert.ok(syncedA, 'el primer sync no llegó');
  const firstNoteId = addElement(docA, 'note', { createdBy: 'smoke', x: 40, y: 40, width: 300, color: 'yellow' }, 'smoke');
  {
    const fragment = ensureTextFragment(docA, firstNoteId, 'smoke');
    if (fragment) writeTextParagraphs(fragment, firstText, 'smoke');
  }
  await sleep(1000);
  closeProvider(providerA);
  const persistedFirst = await waitForDocumentText(versionsBoardId, cookie, firstText);
  record('el documento escrito por WebSocket queda persistido', persistedFirst, firstText);

  const autoVersions = await waitFor('instantánea automática del hook', async () => {
    const response = await api(`/api/boards/${versionsBoardId}/versions`, { cookie });
    const list = ((response.json as Json).versions ?? []) as Json[];
    return list.some((version) => version.origin === 'auto');
  });
  record('el hook de persistencia guarda una instantánea automática', autoVersions);

  const manual = await api(`/api/boards/${versionsBoardId}/versions`, { method: 'POST', cookie, body: {} });
  const manualVersion = ((manual.json as Json).version ?? {}) as Json;
  record(
    'POST /api/boards/:id/versions crea una instantánea manual',
    manual.status === 201 && manualVersion.origin === 'manual' && Number(manualVersion.elementCount) >= 1,
    `versión ${String(manualVersion.id)} (${String(manualVersion.sizeBytes)} bytes, ${String(manualVersion.elementCount)} elementos)`,
  );

  const detail = await api(`/api/boards/${versionsBoardId}/versions/${String(manualVersion.id)}`, { cookie });
  const preview = ((detail.json as Json).preview ?? {}) as Json;
  record(
    'GET /api/boards/:id/versions/:vid trae la previsualización (título, elementos, tipos)',
    detail.status === 200 && Number(preview.elementCount) >= 1,
    `${String(preview.title)} · ${JSON.stringify(preview.types)}`,
  );

  // Segunda escritura + restauración con la conexión abierta.
  const secondText = `segunda versión ${Date.now()}`;
  const docB = createBoardDoc();
  const providerB = createProvider(docB, versionsBoardId, cookie);
  await waitFor('sync de la segunda conexión', () => providerB.synced, 15_000, 200);
  const secondNoteId = addElement(docB, 'note', { createdBy: 'smoke', x: 400, y: 40, width: 300 }, 'smoke');
  {
    const fragment = ensureTextFragment(docB, secondNoteId, 'smoke');
    if (fragment) writeTextParagraphs(fragment, secondText, 'smoke');
  }
  await sleep(1000);
  const haveSecond = await waitForDocumentText(versionsBoardId, cookie, secondText);
  record('la segunda escritura llega al estado persistido', haveSecond, secondText);

  const restore = await api(`/api/boards/${versionsBoardId}/versions/${String(manualVersion.id)}/restore`, { method: 'POST', cookie, body: {} });
  const restoreJson = restore.json as Json;
  record(
    'POST .../restore cierra las conexiones del tablero y sustituye el estado',
    restore.status === 200 &&
      Number(restoreJson.connectionsClosed) >= 1 &&
      restoreJson.documentUnloaded === true &&
      typeof restoreJson.waitedMs === 'number',
    `conexiones=${String(restoreJson.connectionsClosed)} descargado=${String(restoreJson.documentUnloaded)} espera=${String(restoreJson.waitedMs)}ms versión-previa=${String(restoreJson.previousVersionId).slice(0, 8)}`,
  );
  const disconnected = await waitFor('desconexión del cliente por la restauración', () => providerB.synced === false, 8_000, 200);
  record('el cliente conectado queda desconectado tras restaurar', disconnected, `synced=${String(providerB.synced)}`);
  closeProvider(providerB);

  const restoredDoc = createBoardDoc();
  const docAfter = await api(`/api/boards/${versionsBoardId}/document`, { cookie });
  Y.applyUpdate(restoredDoc, new Uint8Array(Buffer.from(String((docAfter.json as Json).state ?? ''), 'base64')));
  const restoredTexts = getOrderedElements(restoredDoc).map((element) => textOf(restoredDoc, element.id));
  record(
    'el estado restaurado es el de la instantánea (vuelve la primera nota y se va la segunda)',
    restoredTexts.some((text) => text.includes(firstText)) && !restoredTexts.some((text) => text.includes(secondText)),
    `${restoredTexts.length} elementos tras restaurar`,
  );

  // Mientras dura la guardia, una conexión nueva se cierra (el cliente
  // reintenta); al terminar, un cliente que reconecta recibe la versión
  // restaurada.
  const docC = createBoardDoc();
  const providerC = createProvider(docC, versionsBoardId, cookie);
  const blockedDuringGuard = await waitFor('reintento del cliente durante la guardia', () => providerC.synced === true, 3_000, 300);
  const syncedC = await waitFor('reconexión tras la guardia', () => providerC.synced, 30_000, 500);
  const clientTexts = getOrderedElements(docC).map((element) => textOf(docC, element.id));
  record(
    'la guardia de restauración bloquea la reconexión inmediata (evita revivir el estado viejo)',
    !blockedDuringGuard,
    `sync inmediato=${String(blockedDuringGuard)} (esperado false)`,
  );
  record(
    'un cliente que reconecta recibe la versión restaurada',
    syncedC && clientTexts.some((text) => text.includes(firstText)) && !clientTexts.some((text) => text.includes(secondText)),
    `${clientTexts.length} elementos en el cliente`,
  );
  closeProvider(providerC);

  // --- 6. Exportación -------------------------------------------------------
  // Se sube un archivo y se lo cuelga del tablero por WebSocket: así el ZIP
  // tiene que incluir el archivo *real* (streaming desde MinIO).
  const zipAssetName = `pixel-zip-${Date.now()}.png`;
  const zipPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const zipForm = new FormData();
  zipForm.append('file', new Blob([zipPng], { type: 'image/png' }), zipAssetName);
  const zipUpload = await fetch(`${API_URL}/api/assets`, { method: 'POST', headers: { origin: APP_ORIGIN, cookie }, body: zipForm });
  const zipUploadJson = (await zipUpload.json()) as Json;
  const zipAssetId = String((zipUploadJson.asset as Json)?.id ?? '');

  const docD = createBoardDoc();
  const providerD = createProvider(docD, versionsBoardId, cookie);
  await waitFor('sync para colgar la imagen', () => providerD.synced, 15_000, 200);
  addElement(docD, 'image', { createdBy: 'smoke', x: 40, y: 200, width: 200, assetId: zipAssetId, caption: 'Imagen del ZIP' }, 'smoke');
  await sleep(1_000);
  closeProvider(providerD);
  const imagePersisted = await waitFor('persistencia de la imagen', async () => {
    const response = await api(`/api/boards/${versionsBoardId}/document`, { cookie });
    const doc = createBoardDoc();
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(String((response.json as Json).state ?? ''), 'base64')));
    return getOrderedElements(doc).some((element) => (element as { assetId?: string }).assetId === zipAssetId);
  });
  record('la imagen con archivo real queda en el documento', imagePersisted, `asset ${zipAssetId}`);

  const markdown = await api(`/api/boards/${versionsBoardId}/export?format=markdown`, { method: 'POST', cookie, body: {} });
  record(
    'POST /api/boards/:id/export?format=markdown devuelve el Markdown del documento',
    markdown.status === 200 && markdown.text.includes(firstText) && String(markdown.headers.get('content-type')).includes('markdown'),
    `${markdown.text.length} caracteres, content-disposition: ${String(markdown.headers.get('content-disposition')).slice(0, 60)}`,
  );
  record(
    'el Markdown enlaza el archivo real con su ruta dentro del ZIP',
    markdown.text.includes(`![Imagen del ZIP](assets/`),
    markdown.text.split('\n').find((line) => line.startsWith('![')) ?? 'sin enlaces de archivo',
  );
  const plain = await api(`/api/boards/${versionsBoardId}/export?format=text`, { method: 'POST', cookie, body: {} });
  record('la exportación a texto plano incluye el texto', plain.status === 200 && plain.text.includes(firstText), `${plain.text.length} caracteres`);
  const jsonExport = await api(`/api/boards/${versionsBoardId}/export?format=json`, { method: 'POST', cookie, body: {} });
  const jsonPayload = (jsonExport.json as Json).document as Json | undefined;
  record(
    'la exportación a JSON trae el estado Yjs y la proyección del documento',
    jsonExport.status === 200 && jsonPayload !== undefined && typeof jsonPayload.state === 'string' && Array.isArray(jsonPayload.elements),
    `${String(jsonPayload?.elements ? (jsonPayload.elements as unknown[]).length : 0)} elementos, estado ${String(jsonPayload?.state ?? '').length} chars en base64`,
  );

  // ZIP: la respuesta llega como bytes; se verifican entradas y CRC.
  const zipResponse = await fetch(`${API_URL}/api/boards/${versionsBoardId}/export?format=zip`, {
    method: 'POST',
    headers: { origin: APP_ORIGIN, cookie, 'content-type': 'application/json' },
    body: '{}',
  });
  const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
  let zipEntries: ReturnType<typeof readZip> = [];
  let zipError = '';
  try {
    zipEntries = readZip(zipBuffer);
  } catch (error) {
    zipError = String(error);
  }
  const names = zipEntries.map((entry) => entry.name);
  const assetEntry = zipEntries.find((entry) => entry.name.startsWith('assets/') && entry.name.endsWith('.png'));
  record(
    'la exportación ZIP trae board.json/.md/.txt con CRC íntegro',
    zipResponse.status === 200 &&
      names.includes('board.json') &&
      names.includes('board.md') &&
      zipEntries.every((entry) => entry.crcOk) &&
      zipError === '',
    `${zipBuffer.length} bytes, entradas: ${names.join(', ')}${zipError ? ` — ${zipError}` : ''}`,
  );
  record(
    'el ZIP incluye el archivo real (bytes idénticos a los subidos)',
    assetEntry !== undefined && assetEntry.data.equals(zipPng) && assetEntry.crcOk,
    assetEntry ? `${assetEntry.name} (${assetEntry.size} bytes, CRC ok)` : 'no hay entrada de assets/',
  );
  const accountZip = await fetch(`${API_URL}/api/export/account`, { headers: { cookie } });
  const accountBuffer = Buffer.from(await accountZip.arrayBuffer());
  let accountEntries: ReturnType<typeof readZip> = [];
  try {
    accountEntries = readZip(accountBuffer);
  } catch {
    accountEntries = [];
  }
  record(
    'GET /api/export/account arma el ZIP de toda la cuenta (account.json + tableros)',
    accountZip.status === 200 &&
      accountEntries.some((entry) => entry.name === 'account.json') &&
      accountEntries.filter((entry) => entry.name.endsWith('board.json')).length >= 2,
    `${accountEntries.length} entradas, ${accountBuffer.length} bytes`,
  );

  // --- 7. Almacenamiento ----------------------------------------------------
  const storageBefore = await api('/api/storage', { cookie });
  const before = storageBefore.json as Json;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  // `dedupe=false`: el mismo PNG ya se subió arriba para el ZIP y sin esto la
  // API devolvería el archivo existente (que está referenciado, no huérfano).
  form.append('dedupe', 'false');
  form.append('file', new Blob([png], { type: 'image/png' }), 'pixel-humo.png');
  const upload = await fetch(`${API_URL}/api/assets`, { method: 'POST', headers: { origin: APP_ORIGIN, cookie }, body: form });
  const uploadJson = (await upload.json()) as Json;
  const uploadedId = String((uploadJson.asset as Json)?.id ?? '');
  record('subida de un archivo de prueba (para el cálculo de huérfanos)', upload.status === 201, uploadedId);

  const storageAfter = await api('/api/storage', { cookie });
  const after = storageAfter.json as Json;
  const orphan = ((after.orphaned ?? []) as Json[]).find((asset) => asset.id === uploadedId);
  record(
    'GET /api/storage cuenta el espacio usado y detecta el archivo huérfano',
    storageAfter.status === 200 &&
      Number(after.usedBytes) >= Number(before.usedBytes) + png.length - 1 &&
      Number(after.orphanCount) >= 1 &&
      orphan !== undefined,
    `usado=${String(after.usedBytes)} bytes, huérfanos=${String(after.orphanCount)} (${String(orphan?.size)} bytes)`,
  );

  const cleanup = await api('/api/storage/orphans', { method: 'DELETE', cookie });
  const cleanupJson = cleanup.json as Json;
  const storageFinal = await api('/api/storage', { cookie });
  const final = storageFinal.json as Json;
  record(
    'DELETE /api/storage/orphans borra los huérfanos y sus objetos',
    cleanup.status === 200 &&
      Number(cleanupJson.deleted) >= 1 &&
      Number(final.orphanCount) === 0 &&
      Number(final.assetCount) === Number(after.assetCount) - Number(cleanupJson.deleted),
    `borrados=${String(cleanupJson.deleted)} liberado=${String(cleanupJson.freedBytes)} bytes, huérfanos restantes=${String(final.orphanCount)}`,
  );
}

main()
  .catch((error: unknown) => {
    record('ejecución completa', false, String(error));
  })
  .finally(() => {
    const failed = checks.filter((check) => !check.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} verificaciones OK`);
    for (const check of failed) console.log(`  - FALLÓ: ${check.name} ${check.detail}`);
    process.exitCode = failed.length > 0 ? 1 : 0;
    setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 5000).unref();
  });

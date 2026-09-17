/**
 * Humo de la fase 5 (colaboración), con dos cuentas reales.
 *
 *   # con la API y Postgres levantados:
 *   pnpm --filter @tablero/api smoke:colaboracion
 *
 * Variables: API_URL (http://localhost:8787), COLLAB_URL
 * (ws://localhost:<API>/collab) y APP_ORIGIN (http://localhost:5173). Como el
 * script lee `BoardDocument` con Prisma, `DATABASE_URL` tiene que apuntar a la
 * misma base que usa la API.
 *
 * Verifica, con ejecución real:
 *   1. Invitación por email con rol **lector** y aceptación por la segunda cuenta.
 *   2. El lector ve el tablero por la REST **y** por el socket, pero no puede
 *      escribir por ninguno de los dos caminos (403 en la REST, updates
 *      descartados en el socket).
 *   3. Herencia: el lector del padre abre el subtablero.
 *   4. El rol **comentarista** (tercera cuenta): su comentario llega al
 *      documento del servidor por el socket y su edición de una nota se
 *      descarta; el lector tampoco puede comentar.
 *   5. El dueño sube el rol a editor: el socket del lector se cierra con 4403
 *      (Forbidden, el único código propio del protocolo) y al reconectar ya
 *      puede escribir.
 *   6. Edición simultánea de las dos cuentas sobre el mismo documento.
 *   7. Comentario con `@mención` anclado a una tarjeta: la fila plana en la
 *      tabla, el contador de la tarjeta y la notificación para el mencionado.
 *   8. Actividad por lotes (`entries`) y listado por cursor, más el contador de
 *      notificaciones no leídas (marcar leídas con `{}` = todas).
 *   9. Publicación: slug, contraseña, subtableros con slug compuesto, lectura
 *      **sin sesión**, asset firmado y ningún dato privado en el payload.
 *  10. Presencia: quién está mirando el tablero (`users` y `watchers`).
 */

import assert from 'node:assert/strict';

import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { PrismaClient } from '@prisma/client';
import {
  addComment,
  addElement,
  createBoardDoc,
  elementCommentCount,
  elementCount,
  ensureTextFragment,
  getElement,
  readComments,
  writeTextParagraphs,
} from '@tablero/shared';
import WebSocket from 'ws';
import * as Y from 'yjs';

import { loadDotEnv } from '../src/env.js';

loadDotEnv();

const API_URL = process.env.API_URL ?? 'http://localhost:8787';
const WS_URL = process.env.COLLAB_URL ?? API_URL.replace(/^http/, 'ws') + '/collab';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const STAMP = Date.now().toString(36);
const OWNER = {
  email: process.env.SMOKE_OWNER_EMAIL ?? `humo-colab-dueno-${STAMP}@tablero.test`,
  name: 'Dueña del humo',
  password: 'humo-colaboracion-2026',
};
const READER = {
  email: process.env.SMOKE_READER_EMAIL ?? `humo-colab-lector-${STAMP}@tablero.test`,
  name: 'Beto Lector',
  password: 'humo-colaboracion-2026',
};
const COMMENTER = {
  email: process.env.SMOKE_COMMENTER_EMAIL ?? `humo-colab-comentarista-${STAMP}@tablero.test`,
  name: 'Carola Comentarista',
  password: 'humo-colaboracion-2026',
};

/** PNG de 1×1 (para el asset público). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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
  intervalMs = 300,
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

type ApiOptions = {
  method?: string;
  body?: Json | undefined;
  cookie?: string | undefined;
  raw?: boolean;
};

async function api(
  path: string,
  options: ApiOptions = {},
): Promise<{ status: number; json: Json; cookie?: string; headers: Headers; text: string }> {
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
    headers: response.headers,
    text,
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

function createProvider(document: Y.Doc, boardId: string, sessionCookie: string): HocuspocusProvider {
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: WS_URL,
    WebSocketPolyfill: cookieWebSocketFactory(sessionCookie),
    // `quiet: true` = el proveedor reconecta aunque la conexión se cierre con
    // 4403 (Forbidden): el handshake decide otra vez con el permiso vigente.
    // (Sin esto, el proveedor trata 4403 como no reintentable.)
    quiet: true,
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

function closeProvider(provider: HocuspocusProvider): void {
  const socket = provider.configuration.websocketProvider;
  provider.destroy();
  socket.destroy();
}

async function register(account: { email: string; name: string; password: string }): Promise<{ cookie: string; userId: string; rootBoardId: string }> {
  const registered = await api('/api/auth/register', { method: 'POST', body: account });
  if (registered.status !== 201 || !registered.cookie) {
    throw new Error(`No se pudo registrar ${account.email} (${registered.status}): ${JSON.stringify(registered.json)}`);
  }
  const me = await api('/api/auth/me', { cookie: registered.cookie });
  const boards = (me.json.boards ?? []) as Json[];
  const root = boards.find((board) => board.parentBoardId === null);
  if (!root) throw new Error('La cuenta nueva no tiene tablero raíz');
  return { cookie: registered.cookie, userId: String((registered.json.user as Json).id), rootBoardId: String(root.id) };
}

async function main(): Promise<void> {
  console.log(`API: ${API_URL} · collab: ${WS_URL}\n`);

  const health = await api('/api/health');
  assert.equal(health.status, 200, 'la API no responde /api/health');
  console.log(`   health: ${JSON.stringify(health.json)}\n`);

  // --- 0. Dos cuentas -------------------------------------------------------
  const owner = await register(OWNER);
  const reader = await register(READER);
  record('dos cuentas registradas', Boolean(owner.cookie && reader.cookie), `${OWNER.email} · ${READER.email}`);

  const created = await api('/api/boards', {
    method: 'POST',
    cookie: owner.cookie,
    body: { title: 'Humo colaboración', parentBoardId: owner.rootBoardId, icon: '🤝' },
  });
  assert.equal(created.status, 201, `no se creó el tablero: ${JSON.stringify(created.json)}`);
  const boardId = String((created.json.board as Json).id);

  const child = await api('/api/boards', {
    method: 'POST',
    cookie: owner.cookie,
    body: { title: 'Subtema', parentBoardId: boardId },
  });
  const childId = String((child.json.board as Json).id);
  record('tablero y subtablero creados', created.status === 201 && child.status === 201, `${boardId} · ${childId}`);

  // --- 1. El dueño escribe contenido (nota + imagen) ------------------------
  const upload = new FormData();
  upload.append('file', new Blob([PNG_1X1], { type: 'image/png' }), 'pixel.png');
  upload.append('boardId', boardId);
  const uploaded = await fetch(`${API_URL}/api/assets`, {
    method: 'POST',
    headers: { cookie: owner.cookie, origin: APP_ORIGIN },
    body: upload,
  });
  const uploadedJson = (await uploaded.json()) as Json;
  const assetId = String((uploadedJson.asset as Json).id ?? '');
  record('asset subido al tablero', uploaded.status === 201 && assetId.length > 0, assetId);

  const ownerDoc = createBoardDoc();
  const ownerProvider = createProvider(ownerDoc, boardId, owner.cookie);
  const ownerSynced = await waitFor('sync del dueño', () => ownerProvider.synced, 15_000, 200);
  record('el dueño sincroniza por WebSocket', ownerSynced, `synced=${ownerProvider.synced}`);
  if (!ownerSynced) throw new Error('El socket del dueño no sincronizó: ¿está la API levantada?');

  const noteId = addElement(
    ownerDoc,
    'note',
    { createdBy: owner.userId, x: 40, y: 40, width: 260, title: 'Plan de la fase 5' },
    'smoke',
  );
  const fragment = ensureTextFragment(ownerDoc, noteId);
  if (fragment) writeTextParagraphs(fragment, 'Contenido compartido del humo', 'smoke');
  addElement(ownerDoc, 'image', { createdBy: owner.userId, x: 340, y: 40, assetId }, 'smoke');
  await sleep(1_200);
  record('contenido escrito por el dueño', elementCount(ownerDoc) === 2, `${elementCount(ownerDoc)} elementos`);

  // --- 2. Invitación con rol lector y aceptación ----------------------------
  const invited = await api(`/api/boards/${boardId}/invitations`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { email: READER.email, role: 'viewer', expiresInDays: 2 },
  });
  const invitation = invited.json.invitation as Json | undefined;
  const inviteToken = String(invitation?.token ?? '');
  record(
    'invitación por email con rol lector',
    invited.status === 201 && inviteToken.length > 0,
    `token ${inviteToken.slice(0, 8)}…`,
  );

  const invitationView = await api(`/api/invitations/${inviteToken}`, { cookie: reader.cookie });
  const accepted = await api(`/api/invitations/${inviteToken}/accept`, { method: 'POST', cookie: reader.cookie });
  record(
    'la invitación se ve y se acepta',
    invitationView.status === 200 && accepted.status === 200,
    `rol ${String((accepted.json as Json).role)} · ${String((accepted.json as Json).boardTitle)}`,
  );

  const members = await api(`/api/boards/${boardId}/members`, { cookie: owner.cookie });
  const memberList = (members.json.members ?? []) as Json[];
  record(
    'el listado de miembros tiene dueño y lector',
    members.status === 200 && memberList.some((row) => row.isOwner === true) && memberList.some((row) => row.role === 'viewer'),
    memberList.map((row) => `${row.name}:${row.role}`).join(', '),
  );

  // --- 3. El lector lee por REST, no escribe por REST -----------------------
  const readerBoard = await api(`/api/boards/${boardId}`, { cookie: reader.cookie });
  const readerDocument = await api(`/api/boards/${boardId}/document`, { cookie: reader.cookie });
  const readerChild = await api(`/api/boards/${childId}`, { cookie: reader.cookie });
  record(
    'el lector ve el tablero y el subtablero por REST (herencia)',
    readerBoard.status === 200 && readerDocument.status === 200 && readerChild.status === 200,
    `padre ${readerBoard.status} · documento ${readerDocument.status} · hijo ${readerChild.status}`,
  );

  const readerWrite = await api(`/api/boards/${boardId}`, {
    method: 'PATCH',
    cookie: reader.cookie,
    body: { title: 'Lo intento cambiar' },
  });
  record(
    'el lector no puede escribir por REST',
    readerWrite.status === 403 && readerWrite.json.code === 'forbidden_role',
    `${readerWrite.status} ${String(readerWrite.json.code ?? '')}`,
  );

  // --- 4. El lector entra por el socket: lectura sí, escritura no -----------
  const readerDoc = createBoardDoc();
  const readerProvider = createProvider(readerDoc, boardId, reader.cookie);
  const readerSynced = await waitFor('sync del lector', () => readerProvider.synced, 15_000, 200);
  record('el lector sincroniza por WebSocket', readerSynced, `synced=${readerProvider.synced}`);
  record(
    'el socket del lector queda en solo lectura',
    readerProvider.authorizedScope === 'readonly',
    `scope=${String(readerProvider.authorizedScope)}`,
  );
  record(
    'el lector recibe el contenido del dueño',
    getElement(readerDoc, noteId) !== null,
    `${elementCount(readerDoc)} elementos`,
  );

  readerDoc.getMap('lector').set('intento', 'escribir');
  await sleep(1_500);
  const ownerSaw = ownerDoc.getMap('lector').get('intento');
  record('el update del lector no llega al resto (descartado en el servidor)', ownerSaw === undefined, `clave=${String(ownerSaw)}`);

  // El lector tampoco puede comentar: el mismo camino descarta el update.
  const readerCommentId = addComment(
    readerDoc,
    {
      elementId: null,
      x: 0,
      y: 0,
      authorId: reader.userId,
      authorName: READER.name,
      body: 'Como lector no debería entrar',
      mentions: [],
    },
    'smoke',
  );
  await sleep(1_200);
  const readerComments = await api(`/api/boards/${boardId}/comments`, { cookie: owner.cookie });
  record(
    'el lector no puede comentar (update descartado en el servidor)',
    !((readerComments.json.comments ?? []) as Json[]).some((row) => row.id === readerCommentId),
    `${readerCommentId.slice(0, 10)}…`,
  );

  // --- 4b. El comentarista comenta por el socket y no edita -------------------
  const commenter = await register(COMMENTER);
  const invitedCommenter = await api(`/api/boards/${boardId}/invitations`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { email: COMMENTER.email, role: 'commenter' },
  });
  const commenterToken = String(((invitedCommenter.json.invitation ?? {}) as Json).token ?? '');
  await api(`/api/invitations/${commenterToken}/accept`, {
    method: 'POST',
    cookie: commenter.cookie,
  });

  const commenterDoc = createBoardDoc();
  const commenterProvider = createProvider(commenterDoc, boardId, commenter.cookie);
  const commenterSynced = await waitFor('sync del comentarista', () => commenterProvider.synced, 15_000, 200);
  const commenterCommentId = addComment(
    commenterDoc,
    {
      elementId: noteId,
      x: null,
      y: null,
      authorId: commenter.userId,
      authorName: COMMENTER.name,
      body: 'Comentario del comentarista',
      mentions: [],
    },
    'smoke',
  );
  const commentApplied = await waitFor(
    'comentario del comentarista',
    async () => {
      const listed = await api(`/api/boards/${boardId}/comments`, { cookie: owner.cookie });
      return ((listed.json.comments ?? []) as Json[]).some((row) => row.id === commenterCommentId);
    },
    15_000,
    300,
  );
  record(
    'el comentarista puede comentar por el socket (rol `commenter`)',
    commenterSynced && commentApplied,
    `${commenterCommentId.slice(0, 10)}…`,
  );

  addElement(commenterDoc, 'note', { createdBy: commenter.userId, x: 10, y: 10, title: 'No debería entrar' }, 'smoke');
  await sleep(1_500);
  record(
    'el comentarista no puede editar una nota (update descartado)',
    elementCount(ownerDoc) === 2,
    `${elementCount(ownerDoc)} elementos en la copia del dueño`,
  );
  closeProvider(commenterProvider);

  // --- 5. Presencia: quién está mirando -------------------------------------
  const presence = await api(`/api/boards/${boardId}/presence`, { cookie: owner.cookie });
  const present = (presence.json.users ?? []) as Json[];
  const watchers = (presence.json.watchers ?? []) as Json[];
  record(
    'presencia: las dos cuentas están mirando, con nombre y color (`users` y `watchers`)',
    presence.status === 200 &&
      present.some((row) => row.userId === owner.userId && row.connected === true && typeof row.color === 'string') &&
      present.some((row) => row.userId === reader.userId) &&
      watchers.length === present.length,
    present.map((row) => `${row.name}(${String(row.color)},${row.connected ? 'socket' : 'rest'})`).join(', '),
  );

  // --- 6. Subida de rol: cierre con 4403 (Forbidden) y reapertura -----------
  const closes: number[] = [];
  readerProvider.on('close', ({ event }: { event: { code: number } }) => closes.push(event.code));
  const promoted = await api(`/api/boards/${boardId}/members/${reader.userId}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { role: 'editor' },
  });
  const closed = await waitFor('cierre del socket del lector', () => closes.length > 0, 10_000, 100);
  record(
    'subir el rol cierra el socket del lector con 4403 (Forbidden)',
    promoted.status === 200 && closed && closes.includes(4403),
    `rol ${String(((promoted.json.member ?? {}) as Json).role ?? '')} · cierres [${closes.join(',')}]`,
  );
  record(
    'el miembro que cambia de rol viaja en `member` con la forma completa',
    ((promoted.json.member ?? {}) as Json).userId === reader.userId &&
      typeof (((promoted.json.member ?? {}) as Json).name) === 'string',
    JSON.stringify(promoted.json.member ?? null),
  );

  const reopened = await waitFor('reapertura del socket del lector', () => readerProvider.authorizedScope === 'read-write', 20_000, 200);
  record('el lector reconecta y ya puede escribir', reopened, `scope=${String(readerProvider.authorizedScope)}`);

  // --- 7. Edición simultánea ------------------------------------------------
  readerDoc.getMap('edicion').set('lector', 'antes era lector');
  ownerDoc.getMap('edicion').set('dueno', 'dueño escribiendo a la vez');
  await sleep(1_500);

  const probeDoc = createBoardDoc();
  const probeProvider = createProvider(probeDoc, boardId, owner.cookie);
  await waitFor('sync de la tercera conexión', () => probeProvider.synced, 15_000, 200);
  const simultaneous = await waitFor(
    'edición simultánea en el documento',
    () => probeDoc.getMap('edicion').get('lector') === 'antes era lector' && probeDoc.getMap('edicion').get('dueno') === 'dueño escribiendo a la vez',
    15_000,
    300,
  );
  record('edición simultánea de las dos cuentas converge', simultaneous, `${String(probeDoc.getMap('edicion').get('lector'))} + ${String(probeDoc.getMap('edicion').get('dueno'))}`);

  // --- 8. Comentario con mención anclado a la tarjeta ----------------------
  const commentId = addComment(
    ownerDoc,
    {
      elementId: noteId,
      x: null,
      y: null,
      authorId: owner.userId,
      authorName: OWNER.name,
      body: `¿Lo revisás, @${READER.name.split(' ')[0]}?`,
      mentions: [reader.userId],
    },
    'smoke',
  );
  await sleep(1_000);

  const comments = await api(`/api/boards/${boardId}/comments`, { cookie: owner.cookie });
  const rows = (comments.json.comments ?? []) as Json[];
  record(
    'el comentario se extrae del documento a la tabla con la forma plana',
    comments.status === 200 &&
      rows.some(
        (row) =>
          row.id === commentId &&
          row.elementId === noteId &&
          row.parentCommentId === null &&
          row.authorId === owner.userId &&
          Array.isArray(row.mentions) &&
          (row.mentions as unknown[]).includes(reader.userId),
      ),
    `${rows.length} filas · ${JSON.stringify(rows.find((row) => row.id === commentId) ?? null).slice(0, 160)}`,
  );

  // Dos abiertos en la tarjeta: el del comentarista (sección 4b) y este.
  const counter = await waitFor(
    'contador de la tarjeta',
    () => elementCommentCount(readComments(probeDoc), noteId) === 2,
    5_000,
    200,
  );
  record('el contador de la tarjeta sube', counter, `abiertos=${elementCommentCount(readComments(probeDoc), noteId)}`);

  const readerNotifications = await api('/api/notifications?filter=unread', { cookie: reader.cookie });
  const mentions = (readerNotifications.json.notifications ?? []) as Json[];
  record(
    'la mención le llega al mencionado',
    readerNotifications.status === 200 &&
      mentions.some((row) => row.kind === 'mention' && row.boardId === boardId) &&
      typeof readerNotifications.json.unread === 'number',
    `${mentions.length} sin leer · unread=${String(readerNotifications.json.unread)}`,
  );

  // --- 9. Actividad por lotes y por cursor ----------------------------------
  const activity = await api(`/api/boards/${boardId}/activity`, {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      entries: [
        { action: 'element.create', elementId: noteId, elementType: 'note', meta: { title: 'Plan de la fase 5' } },
        { action: 'element.edit', elementId: 'no-existe-123' },
      ],
    },
  });
  const activityList = await api(`/api/boards/${boardId}/activity?limit=10`, { cookie: owner.cookie });
  const events = (activityList.json.entries ?? []) as Json[];
  record(
    'la actividad por lotes guarda lo válido y descarta lo inexistente',
    activity.status === 201 && activity.json.accepted === 1 && activity.json.discarded === 1 && events.length >= 1,
    `aceptados ${String(activity.json.accepted)} · descartados ${String(activity.json.discarded)} · listado ${events.length}`,
  );

  const firstPage = await api(`/api/boards/${boardId}/activity?limit=1`, { cookie: owner.cookie });
  const firstEntries = (firstPage.json.entries ?? []) as Json[];
  const nextCursor = firstPage.json.nextCursor;
  const secondPage = typeof nextCursor === 'string' ? await api(`/api/boards/${boardId}/activity?limit=1&cursor=${encodeURIComponent(nextCursor)}`, { cookie: owner.cookie }) : { status: 0, json: {} as Json };
  const secondEntries = (secondPage.json.entries ?? []) as Json[];
  record(
    'el listado por cursor devuelve `{ entries, nextCursor }` y avanza',
    firstPage.status === 200 && firstEntries.length === 1 && typeof nextCursor === 'string' && secondPage.status === 200,
    `primera ${firstEntries.length} (next=${String(nextCursor).slice(0, 12)}…) · segunda ${secondEntries.length} · acción ${String(events[0]?.action ?? '')}`,
  );

  // --- 10. Notificaciones: contador y marcar leídas -------------------------
  const before = await api('/api/notifications/count', { cookie: reader.cookie });
  const marked = await api('/api/notifications/read', { method: 'POST', cookie: reader.cookie, body: {} });
  const after = await api('/api/notifications/count', { cookie: reader.cookie });
  record(
    'el contador de no leídas cuadra (`unread` de nivel superior) y `{}` marca todas',
    before.status === 200 &&
      typeof before.json.unread === 'number' &&
      (before.json.unread as number) >= 1 &&
      marked.status === 200 &&
      marked.json.unread === 0 &&
      after.status === 200 &&
      after.json.unread === 0,
    `antes ${String(before.json.unread)} → después ${String(after.json.unread)}`,
  );

  // --- 11. Publicación y lectura sin sesión --------------------------------
  const published = await api(`/api/boards/${boardId}/publish`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { password: 'clave-publica-humo', includeSubBoards: true },
  });
  const slug = String((published.json as Json).slug ?? '');
  const publication = (published.json.publication ?? {}) as Json;
  record(
    'publicación con slug, contraseña y subtableros (`hasPassword` + `publication`)',
    published.status === 200 &&
      /^[1-9A-HJ-NP-Za-km-z]{12}$/.test(slug) &&
      published.json.hasPassword === true &&
      publication.slug === slug &&
      publication.hasPassword === true,
    `slug ${slug} · ${String((published.json as Json).url)}`,
  );

  const withoutPassword = await api(`/api/public/boards/${slug}`);
  const withPassword = await api(`/api/public/boards/${slug}?password=clave-publica-humo`);
  const publicSummary = withPassword.json.board as Json;
  record(
    'la vista pública pide la contraseña y abre con ella, sin sesión',
    withoutPassword.status === 401 && withPassword.status === 200,
    `sin contraseña ${withoutPassword.status} · con contraseña ${withPassword.status} · autor ${String(publicSummary.authorName)}`,
  );
  record(
    'la vista pública manda noindex',
    (withPassword.headers.get('x-robots-tag') ?? '').includes('noindex'),
    String(withPassword.headers.get('x-robots-tag')),
  );

  // Los subtableros viajan en el nivel superior con **slug por hijo**.
  const publicChildren = ((withPassword.json.boards ?? withPassword.json.children ?? []) as Json[]) ?? [];
  const childSlug = String(publicChildren[0]?.slug ?? '');
  record(
    'los subtableros publicados llevan su slug compuesto (`padre~hijo`)',
    publicChildren.length === 1 && childSlug === `${slug}~${childId}`,
    `hijos ${publicChildren.length} · slug ${childSlug}`,
  );

  const childPage = await api(`/api/public/boards/${encodeURIComponent(childSlug)}?password=clave-publica-humo`);
  record(
    'el subtablero se abre sin sesión con su propio slug',
    childPage.status === 200 && String((childPage.json.board as Json).boardId) === childId,
    `${childPage.status} · boardId ${String(((childPage.json.board ?? {}) as Json).boardId ?? '')}`,
  );

  const publicDocument = await api(`/api/public/boards/${slug}/document?password=clave-publica-humo`);
  const publicPayload = publicDocument.json.document as Json;
  const publicState = Buffer.from(String(publicDocument.json.state ?? ''), 'base64');
  const probePublic = createBoardDoc();
  Y.applyUpdate(probePublic, new Uint8Array(publicState));
  const publicComments = readComments(probePublic);
  const publicElements = [...probePublic.getMap('elements').values()] as Y.Map<unknown>[];
  const publicAssets = (publicPayload.assets ?? {}) as Json;
  const assetUrl = String(((publicAssets[assetId] ?? {}) as Json).url ?? '');
  record(
    'el documento público llega saneado (`state` de nivel superior, sin comentarios ni ids de autor)',
    publicDocument.status === 200 &&
      typeof publicDocument.json.state === 'string' &&
      publicComments.length === 0 &&
      publicElements.length === 2 &&
      publicElements.every((element) => element.get('createdBy') === undefined) &&
      !publicDocument.text.includes(READER.email) &&
      !publicDocument.text.includes(owner.userId) &&
      // Ni la clave del almacenamiento (`assets/<ownerId>/...`) ni la firma de S3.
      !publicDocument.text.includes('assets/user_') &&
      !publicDocument.text.includes('X-Amz-Signature'),
    `${publicElements.length} elementos · ${publicComments.length} comentarios · assets ${Object.keys(publicAssets).length}`,
  );

  const assetFetch = await fetch(`${API_URL}${assetUrl}`);
  record(
    'el asset de la publicación se sirve firmado y sin exponer el almacenamiento',
    assetFetch.status === 200 && assetFetch.headers.get('content-type') === 'image/png' && assetUrl.includes('token='),
    `${assetFetch.status} ${String(assetFetch.headers.get('content-type'))} · ${assetUrl.slice(0, 60)}…`,
  );

  const childPublic = await api(`/api/public/boards/${encodeURIComponent(childSlug)}/document?password=clave-publica-humo`);
  record(
    'los subtableros se leen sin sesión por su slug compuesto',
    childPublic.status === 200 && typeof childPublic.json.state === 'string',
    `hijo ${childPublic.status} · state ${typeof childPublic.json.state}`,
  );

  const unpublished = await api(`/api/boards/${boardId}/publish`, { method: 'DELETE', cookie: owner.cookie });
  const afterUnpublish = await api(`/api/public/boards/${slug}`);
  record('despublicar cierra la vista pública', unpublished.status === 200 && afterUnpublish.status === 404, `${afterUnpublish.status}`);

  // --- 12. Persistencia en Postgres ----------------------------------------
  const persisted = await waitFor(
    'persistencia en BoardDocument',
    async () => {
      const row = await prisma.boardDocument.findUnique({ where: { boardId } });
      if (!row) return false;
      const bytes = new Uint8Array(row.yjsState);
      if (bytes.byteLength === 0) return false;
      const probe = createBoardDoc();
      Y.applyUpdate(probe, bytes);
      return (
        probe.getMap('edicion').get('lector') === 'antes era lector' &&
        readComments(probe).some((entry) => entry.id === commentId)
      );
    },
    25_000,
    500,
  );
  record('el documento persistido tiene la edición simultánea y el hilo', persisted);

  closeProvider(ownerProvider);
  closeProvider(readerProvider);
  closeProvider(probeProvider);
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
    setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 5000).unref();
  });

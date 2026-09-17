/**
 * Captura rápida (§7.8 del plan): `POST /api/capture`.
 *
 * Pensado para atajos de iOS/Android, scripts y el Share Target de la PWA:
 *   - se autentica con **token personal** (`Authorization: Bearer <token>` o
 *     `X-Capture-Token: <token>`, también `token` en el cuerpo) o con la sesión
 *     del navegador;
 *   - crea una nota (o un enlace) en el tablero «Sin ordenar», o en el tablero
 *     indicado con `boardId` si el usuario tiene permiso de edición;
 *   - escribe sobre el documento **vivo** de Hocuspocus cuando hay servidor
 *     (así el cambio se sincroniza al instante y se persiste igual), y si no,
 *     sobre el estado persistido.
 *
 * El token se muestra en `GET /api/settings`. `image` y `file` quedan fuera
 * (devuelven 400 `capture_unsupported_type`): subir binarios por este endpoint
 * exigiría un camino de subida propio, y el Share Target de la fase 4 solo
 * manda notas y enlaces.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { boundsOfElements, captureSchema, createBoardDoc, ensureTextFragment, getElements, idSchema, writeTextParagraphs, addElement } from '@tablero/shared';
import * as Y from 'yjs';
import { z } from 'zod';

import { transactBoardDocument } from '../collab/server.js';
import { prisma } from '../db.js';
import { ensureUnsortedBoard, loadBoardAccess, accessOrThrow } from '../lib/boards.js';
import { decodeState, loadBoardDoc, syncSearchIndex } from '../lib/documents.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { readSessionToken, resolveSession, type AuthedUser } from '../lib/session.js';

const CAPTURE_ORIGIN = 'capture';

/** Token personal: cabecera primero, cuerpo como respaldo. */
function captureTokenOf(request: FastifyRequest, bodyToken: string | undefined): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')) {
    const value = authorization.slice(7).trim();
    if (value.length > 0) return value;
  }
  const header = request.headers['x-capture-token'];
  if (typeof header === 'string' && header.length > 0) return header;
  return bodyToken && bodyToken.length > 0 ? bodyToken : null;
}

/** Usuario de la petición: token personal o sesión. */
async function resolveCaptureUser(request: FastifyRequest, bodyToken: string | undefined): Promise<AuthedUser> {
  const token = captureTokenOf(request, bodyToken);
  if (token) {
    const user = await prisma.user.findUnique({ where: { captureToken: token } });
    if (!user) throw unauthorized('Token de captura inválido', 'invalid_capture_token');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      settings: user.settings,
      createdAt: user.createdAt,
    };
  }
  const sessionToken = readSessionToken(request);
  if (sessionToken) {
    const session = await resolveSession(sessionToken);
    if (session) return session.user;
  }
  throw unauthorized('Necesitás un token de captura o una sesión', 'capture_unauthorized');
}

const requestSchema = captureSchema.extend({ boardId: idSchema.optional() });

/** Crea el elemento en el documento y devuelve su id. */
function appendElement(doc: Y.Doc, input: { type: 'note' | 'link'; text: string; url?: string | undefined }, userId: string): string {
  const bounds = boundsOfElements(getElements(doc));
  const x = bounds ? bounds.x : 40;
  // Debajo de lo que ya hay: la captura no tapa contenido existente.
  const y = bounds ? bounds.y + bounds.height + 40 : 40;

  if (input.type === 'link' && input.url) {
    return addElement(
      doc,
      'link',
      {
        createdBy: userId,
        x,
        y,
        width: 320,
        url: input.url,
        preview: {
          url: input.url,
          title: input.text.length > 0 ? input.text : null,
          description: null,
          imageUrl: null,
          faviconUrl: null,
          siteName: null,
          embedType: 'generic',
          fetchedAt: Date.now(),
        },
      },
      CAPTURE_ORIGIN,
    );
  }

  const id = addElement(doc, 'note', { createdBy: userId, x, y, width: 300, color: 'yellow' }, CAPTURE_ORIGIN);
  const fragment = ensureTextFragment(doc, id, CAPTURE_ORIGIN);
  if (fragment) writeTextParagraphs(fragment, input.text, CAPTURE_ORIGIN);
  return id;
}

export async function captureRoutes(app: FastifyInstance): Promise<void> {
  app.post('/capture', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = requestSchema.parse(request.body ?? {});
    if (input.type !== 'note' && input.type !== 'link') {
      throw badRequest(`La captura de tipo «${input.type}» todavía no está soportada`, 'capture_unsupported_type');
    }
    const text = (input.text ?? input.title ?? '').trim();
    if (input.type === 'link' && !input.url) throw badRequest('Falta la URL del enlace', 'capture_missing_url');
    if (input.type === 'note' && text.length === 0) throw badRequest('Falta el texto de la nota', 'capture_missing_text');

    const user = await resolveCaptureUser(request, input.token);

    // Tablero destino: el indicado (con permiso de edición) o «Sin ordenar».
    let boardId: string;
    let boardTitle: string;
    if (input.boardId) {
      const access = await loadBoardAccess(user.id);
      const { record } = accessOrThrow(access, input.boardId);
      if (!access.canEdit(record.id)) throw forbidden('Necesitás rol de editor en el tablero destino', 'forbidden_role');
      if (record.trashedAt) throw badRequest('El tablero está en la papelera', 'board_trashed');
      boardId = record.id;
      boardTitle = record.title;
    } else {
      const unsorted = await ensureUnsortedBoard(user.id);
      boardId = unsorted.board.id;
      boardTitle = unsorted.board.title;
    }

    const payload = { type: input.type, text, url: input.url };
    let elementId: string | null = null;
    let stateAfter: Uint8Array | null = null;

    // Documento vivo primero (los clientes lo ven al instante); si no hay
    // servidor de colaboración, se escribe el estado persistido.
    const live = await transactBoardDocument(
      boardId,
      (doc) => {
        elementId = appendElement(doc, payload, user.id);
        stateAfter = Y.encodeStateAsUpdate(doc);
      },
      { userId: user.id, source: CAPTURE_ORIGIN },
    );

    if (!live) {
      const doc = (await loadBoardDoc(boardId)) ?? createBoardDoc();
      elementId = appendElement(doc, payload, user.id);
      stateAfter = Y.encodeStateAsUpdate(doc);
      await prisma.boardDocument.upsert({
        where: { boardId },
        create: { boardId, yjsState: Buffer.from(stateAfter) },
        update: { yjsState: Buffer.from(stateAfter) },
      });
    }

    if (stateAfter) {
      try {
        await syncSearchIndex(boardId, decodeState(stateAfter));
      } catch (error) {
        request.log.warn({ err: error, boardId }, 'La captura no se pudo indexar');
      }
    }

    reply.code(201);
    return { ok: true, boardId, boardTitle, elementId, type: input.type, live };
  });
}

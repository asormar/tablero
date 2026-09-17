/**
 * Exportación (§7.3 del plan).
 *
 *   POST /api/boards/:id/export?format=markdown|text|json|zip
 *   GET  /api/export/account          → ZIP de toda la cuenta
 *
 * Los formatos de texto se arman en el servidor desde el documento persistido.
 * El ZIP incluye los archivos reales leídos de MinIO en streaming (un archivo
 * por vez, sin cargarlos enteros en memoria) y también el Markdown y el texto
 * plano, para que la copia sea legible sin descomprimir el JSON.
 *
 * **Rol mínimo:** la exportación de un tablero exige **editor** (o el dueño). El
 * JSON y el ZIP llevan el `document.state` completo (el estado Yjs en base64,
 * que restaura el documento entero) y el Markdown/texto llevan todo el
 * contenido: no es una vista de lectura más. Un lector recibe 403
 * `forbidden_role`. El ZIP de la cuenta (`GET /api/export/account`) es solo de
 * los tableros propios.
 */

import type { Asset } from '@prisma/client';
import { boardExportQuerySchema, createBoardDoc, getOrderedElements, idSchema } from '@tablero/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PassThrough } from 'node:stream';
import * as Y from 'yjs';
import { z } from 'zod';

import { prisma } from '../db.js';
import { requireBoardEditor, resolveBoardAccessFrom } from '../lib/access.js';
import { loadBoardAccess, type BoardAccess, type BoardRecord } from '../lib/boards.js';
import { encodeStateBase64, loadBoardDoc } from '../lib/documents.js';
import {
  boardExportData,
  buildAssetManifest,
  collectAssetIds,
  renderBoardJson,
  renderMarkdown,
  renderPlainText,
  writeAccountZip,
  writeBoardZip,
  type BoardExportData,
  type ZipBoardEntry,
} from '../lib/export.js';
import { notFound } from '../lib/errors.js';
import { currentUser, type AuthedUser } from '../lib/session.js';
import { safeZipName } from '../lib/zip.js';

const idParamsSchema = z.object({ id: idSchema });

/** `Content-Disposition` con respaldo ASCII y `filename*` UTF-8. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

type BuiltBoard = ZipBoardEntry;

/** Documento (o documento vacío) + datos de exportación de un tablero. */
async function buildBoard(access: BoardAccess, board: BoardRecord, user: AuthedUser): Promise<BuiltBoard> {
  const doc = (await loadBoardDoc(board.id)) ?? createBoardDoc();
  const elements = getOrderedElements(doc);
  const wanted = collectAssetIds(elements);
  const assets: Asset[] =
    wanted.length > 0
      ? await prisma.asset.findMany({ where: { id: { in: wanted }, ownerId: user.id } })
      : [];
  const data: BoardExportData = boardExportData({
    doc,
    info: {
      id: board.id,
      title: board.title,
      icon: board.icon,
      color: board.color,
      path: access.breadcrumbs(board.id).map((crumb) => crumb.title),
    },
    stateBase64: encodeStateBase64(Y.encodeStateAsUpdate(doc)),
    assets: buildAssetManifest(assets),
  });
  return {
    data,
    doc,
    file: `boards/${safeZipName(board.title, 'tablero')}/board.json`,
    meta: { isTemplate: board.isTemplate, isUnsorted: board.isUnsorted },
  };
}

/** Subárbol de un tablero en orden BFS (padres antes que hijos). */
function subtreeOf(access: BoardAccess, rootId: string): BoardRecord[] {
  const members = new Set(access.subtree(rootId));
  const queue: string[] = [rootId];
  const visited = new Set<string>();
  const records: BoardRecord[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const record = access.get(current);
    if (record && !record.trashedAt && access.roleOf(record.id)) records.push(record);
    for (const candidate of members) {
      if (candidate !== current && access.get(candidate)?.parentBoardId === current) queue.push(candidate);
    }
  }
  return records;
}

const FORMATS = {
  markdown: { extension: 'md', contentType: 'text/markdown; charset=utf-8' },
  text: { extension: 'txt', contentType: 'text/plain; charset=utf-8' },
  json: { extension: 'json', contentType: 'application/json; charset=utf-8' },
  zip: { extension: 'zip', contentType: 'application/zip' },
} as const;

function noStore(reply: FastifyReply, fileName: string, contentType: string): void {
  reply.header('cache-control', 'no-store');
  reply.header('content-type', contentType);
  reply.header('content-disposition', contentDisposition(fileName));
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/boards/:id/export', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const query = boardExportQuerySchema.parse(request.query ?? {});
    const access = await loadBoardAccess(user.id);
    // Editor o dueño: el payload (JSON/ZIP) incluye el estado Yjs completo.
    const { board: record } = requireBoardEditor(resolveBoardAccessFrom(access, id));

    const baseName = safeZipName(record.title, 'tablero');
    const format = FORMATS[query.format];

    if (query.format === 'zip') {
      const entries = subtreeOf(access, id).map((board) => board.id);
      const built: BuiltBoard[] = [];
      for (const boardId of entries) {
        const board = access.get(boardId);
        if (!board) continue;
        const entry = await buildBoard(access, board, user);
        // La raíz se llama `board.json`; los subtableros van en `boards/<título>/`.
        built.push(boardId === id ? { ...entry, file: 'board.json' } : entry);
      }
      const root = built[0];
      if (!root) throw notFound('No se pudo preparar la exportación');
      const children = built.slice(1).map((entry, index) => ({
        ...entry,
        file: `boards/${index + 1}-${safeZipName(entry.data.board.title, 'tablero')}/board.json`,
      }));

      const wanted = new Set<string>();
      for (const entry of [root, ...children]) for (const assetId of collectAssetIds(entry.data.elements)) wanted.add(assetId);
      const assets = wanted.size > 0 ? await prisma.asset.findMany({ where: { id: { in: [...wanted] }, ownerId: user.id } }) : [];

      noStore(reply, `${baseName}.zip`, format.contentType);
      const stream = new PassThrough();
      const includeAssets = query.includeAssets !== 'false' && query.includeAssets !== '0';
      writeBoardZip(stream, root, children, assets, { includeAssets })
        .then(({ missing }) => {
          if (missing.length > 0) request.log.warn({ missing }, 'Exportación ZIP: faltan objetos en el almacenamiento');
          stream.end();
        })
        .catch((error: unknown) => {
          request.log.error({ err: error }, 'La exportación ZIP falló');
          stream.destroy(error instanceof Error ? error : new Error(String(error)));
        });
      return reply.send(stream);
    }

    const built = await buildBoard(access, record, user);
    if (query.format === 'markdown') {
      noStore(reply, `${baseName}.md`, format.contentType);
      return reply.send(renderMarkdown(built.data));
    }
    if (query.format === 'text') {
      noStore(reply, `${baseName}.txt`, format.contentType);
      return reply.send(renderPlainText(built.data));
    }
    noStore(reply, `${baseName}.json`, format.contentType);
    return reply.send(JSON.stringify(renderBoardJson(built.data, built.doc), null, 2));
  });

  /**
   * ZIP de la cuenta entera: los tableros propios (incluida la bandeja y las
   * plantillas propias) y los archivos referenciados por sus documentos.
   */
  app.get('/export/account', async (request, reply) => {
    const user = currentUser(request);
    const access = await loadBoardAccess(user.id);
    const own = access.boards.filter((board) => board.ownerId === user.id && !board.trashedAt);

    const entries: BuiltBoard[] = [];
    let index = 0;
    for (const board of own) {
      index += 1;
      const entry = await buildBoard(access, board, user);
      entries.push({
        ...entry,
        file: `boards/${String(index).padStart(2, '0')}-${safeZipName(board.title, 'tablero')}/board.json`,
      });
    }

    const wanted = new Set<string>();
    for (const entry of entries) for (const assetId of collectAssetIds(entry.data.elements)) wanted.add(assetId);
    const assets = wanted.size > 0 ? await prisma.asset.findMany({ where: { id: { in: [...wanted] }, ownerId: user.id } }) : [];

    noStore(reply, `tablero-cuenta-${new Date().toISOString().slice(0, 10)}.zip`, FORMATS.zip.contentType);
    const stream = new PassThrough();
    writeAccountZip(stream, {
      user: { id: user.id, email: user.email, name: user.name },
      boards: entries,
      assets,
    })
      .then(({ missing }) => {
        if (missing.length > 0) request.log.warn({ missing }, 'Exportación de la cuenta: faltan objetos en el almacenamiento');
        stream.end();
      })
      .catch((error: unknown) => {
        request.log.error({ err: error }, 'La exportación de la cuenta falló');
        stream.destroy(error instanceof Error ? error : new Error(String(error)));
      });
    return reply.send(stream);
  });
}

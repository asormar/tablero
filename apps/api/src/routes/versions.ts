/**
 * Historial de versiones (§7.5 del plan).
 *
 *   GET  /api/boards/:id/versions            → listado (más nueva primero)
 *   GET  /api/boards/:id/versions/:vid       → detalle con previsualización
 *   POST /api/boards/:id/versions            → instantánea manual
 *   POST /api/boards/:id/versions/:vid/restore → restaurar (cierra conexiones)
 *
 * El snapshot automático lo crea el hook de persistencia (cada 10 minutos de
 * actividad, ver `lib/versions.ts`). Restaurar = sustituir el estado persistido
 * y cerrar las conexiones del tablero para que los clientes reconecten: no se
 * reescribe el documento vivo.
 */

import type { FastifyInstance } from 'fastify';
import { getOrderedElements, idSchema } from '@tablero/shared';
import { z } from 'zod';

import { closeBoardConnections, beginBoardRestore, finishBoardRestore } from '../collab/server.js';
import { prisma } from '../db.js';
import { accessOrThrow, editorOrThrow, loadBoardAccess } from '../lib/boards.js';
import { decodeState } from '../lib/documents.js';
import { notFound } from '../lib/errors.js';
import { currentUser } from '../lib/session.js';
import { applyVersion, listVersions, pruneVersions, recordVersion, snapshotDocument } from '../lib/versions.js';

const idParamsSchema = z.object({ id: idSchema });
const versionParamsSchema = z.object({ id: idSchema, vid: idSchema });
const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

export async function versionsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/boards/:id/versions', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const query = listQuerySchema.parse(request.query ?? {});
    const access = await loadBoardAccess(user.id);
    accessOrThrow(access, id);
    return { versions: await listVersions(id, query.limit) };
  });

  /** Detalle con previsualización: cantidad de elementos, tipos y primer texto. */
  app.get('/boards/:id/versions/:vid', async (request) => {
    const user = currentUser(request);
    const { id, vid } = versionParamsSchema.parse(request.params);
    const access = await loadBoardAccess(user.id);
    const { record } = accessOrThrow(access, id);
    const version = await prisma.boardVersion.findFirst({ where: { id: vid, boardId: id } });
    if (!version) throw notFound('La versión no existe para este tablero', 'version_not_found');

    const preview: {
      title: string;
      elementCount: number;
      types: Record<string, number>;
      firstText: string | null;
    } = { title: record.title, elementCount: 0, types: {}, firstText: null };
    try {
      const doc = decodeState(new Uint8Array(version.yjsState));
      const elements = getOrderedElements(doc);
      preview.elementCount = elements.length;
      for (const element of elements) preview.types[element.type] = (preview.types[element.type] ?? 0) + 1;
    } catch {
      // Estado ilegible: la previsualización queda en cero, el detalle sigue.
    }

    return {
      version: {
        id: version.id,
        boardId: version.boardId,
        createdAt: version.createdAt.getTime(),
        elementCount: version.elementCount,
        sizeBytes: version.sizeBytes,
        origin: version.origin,
      },
      preview,
    };
  });

  /** Instantánea manual: un punto fijo antes de un cambio grande. */
  app.post('/boards/:id/versions', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const access = await loadBoardAccess(user.id);
    const { record } = editorOrThrow(access, id);
    if (record.trashedAt) {
      reply.code(409);
      return { error: 'El tablero está en la papelera', code: 'board_trashed' };
    }

    const doc = await prisma.boardDocument.findUnique({ where: { boardId: id } });
    if (!doc) {
      reply.code(409);
      return { error: 'El tablero todavía no tiene documento', code: 'missing_document' };
    }
    const decoded = decodeState(new Uint8Array(doc.yjsState));
    const version = await snapshotDocument(id, decoded, 'manual', { force: true });
    await pruneVersions(id);
    reply.code(201);
    return {
      version: version
        ? {
            id: version.id,
            boardId: version.boardId,
            createdAt: version.createdAt.getTime(),
            elementCount: version.elementCount,
            sizeBytes: version.sizeBytes,
            origin: version.origin,
          }
        : null,
    };
  });

  /**
   * Restaurar. Orden importante: primero se cierran las conexiones (así se
   * vacía el guardado pendiente y no pisa lo restaurado), después se guarda el
   * estado actual como `pre-restore` (la restauración es reversible) y recién
   * entonces se sustituye el estado persistido.
   */
  app.post('/boards/:id/versions/:vid/restore', async (request) => {
    const user = currentUser(request);
    const { id, vid } = versionParamsSchema.parse(request.params);
    const access = await loadBoardAccess(user.id);
    editorOrThrow(access, id);
    const version = await prisma.boardVersion.findFirst({ where: { id: vid, boardId: id } });
    if (!version) throw notFound('La versión no existe para este tablero', 'version_not_found');

    // La guardia se abre ANTES de cerrar las conexiones: cualquier cliente que
    // reconecte mientras escribimos la versión restaurada queda afuera (el
    // servidor lo cierra con «Reset Connection», que es reabrible).
    beginBoardRestore(id);
    try {
      const closed = await closeBoardConnections(id);

      const current = await prisma.boardDocument.findUnique({ where: { boardId: id } });
      const previous = current
        ? await recordVersion({
            boardId: id,
            state: new Uint8Array(current.yjsState),
            elementCount: decodeState(new Uint8Array(current.yjsState)).getMap('elements').size,
            origin: 'pre-restore',
            force: true,
          })
        : null;

      const result = await applyVersion(id, version);
      await pruneVersions(id);
      request.log.info(
        { boardId: id, versionId: vid, connections: closed.connections, unloaded: closed.unloaded, waitedMs: closed.waitedMs },
        'Versión restaurada',
      );
      return {
        ok: true,
        version: {
          id: version.id,
          boardId: version.boardId,
          createdAt: version.createdAt.getTime(),
          elementCount: version.elementCount,
          sizeBytes: version.sizeBytes,
          origin: version.origin,
        },
        elements: result.elements,
        connectionsClosed: closed.connections,
        documentUnloaded: closed.unloaded,
        waitedMs: closed.waitedMs,
        previousVersionId: previous?.id ?? null,
      };
    } finally {
      // La guardia sigue activa unos segundos: el cliente reconecta y carga el
      // estado restaurado (el documento ya está descargado).
      finishBoardRestore(id);
    }
  });
}

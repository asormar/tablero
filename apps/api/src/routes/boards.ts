/**
 * Rutas de tableros: listado, creación, edición, papelera, mover, duplicar,
 * migas de pan, hijos y respaldo REST del documento Yjs.
 */

import type { FastifyInstance } from 'fastify';
import type { EffectiveRole } from '@tablero/shared';
import { createBoardSchema, idSchema, moveBoardSchema, updateBoardSchema } from '@tablero/shared';
import { z } from 'zod';

import { prisma } from '../db.js';
import { BoardAccess, loadBoardAccess, type BoardRecord, type SummaryExtras } from '../lib/boards.js';
import { emptyDocumentUpdate, encodeStateBase64, ensureBoardDocument, loadBoardDoc } from '../lib/documents.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { currentUser } from '../lib/session.js';
import { elementCount } from '@tablero/shared';

export const DEFAULT_BOARD_TITLE = 'Tablero sin título';
const DUPLICATE_SUFFIX = ' (copia)';

const idParamsSchema = z.object({ id: idSchema });
const listQuerySchema = z.object({
  filter: z.enum(['recent', 'favorites', 'shared', 'trash']).default('recent'),
  parentBoardId: idSchema.optional(),
});
const duplicateSchema = z.object({ includeChildren: z.boolean().optional() });

function requireAccess(access: BoardAccess, id: string): { record: BoardRecord; role: EffectiveRole } {
  const record = access.get(id);
  const role = access.roleOf(id);
  if (!record || !role) throw notFound('El tablero no existe o no tenés acceso');
  return { record, role };
}

function requireEditor(access: BoardAccess, id: string): { record: BoardRecord; role: EffectiveRole } {
  const found = requireAccess(access, id);
  if (found.role !== 'owner' && found.role !== 'editor') {
    throw forbidden('Necesitás rol de editor en este tablero', 'forbidden_role');
  }
  return found;
}

/** Subárbol en orden BFS (padres antes que hijos). */
function orderedSubtree(access: BoardAccess, rootId: string): BoardRecord[] {
  const members = new Set(access.subtree(rootId));
  const queue: string[] = [rootId];
  const visited = new Set<string>();
  const records: BoardRecord[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const record = access.get(current);
    if (record) records.push(record);
    for (const candidate of members) {
      if (candidate !== current && access.get(candidate)?.parentBoardId === current) queue.push(candidate);
    }
  }
  return records;
}

export async function boardsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/boards', async (request) => {
    const user = currentUser(request);
    const query = listQuerySchema.parse(request.query ?? {});
    const access = await loadBoardAccess(user.id);

    let rows: BoardRecord[];
    switch (query.filter) {
      case 'trash':
        rows = access.accessible({ includeTrashed: true }).filter((board) => board.trashedAt !== null);
        break;
      case 'shared':
        rows = access.accessible().filter((board) => access.roleOf(board.id) !== 'owner');
        break;
      case 'favorites':
        // Los favoritos todavía no se persisten (no hay columna en el plan):
        // el filtro existe y responde vacío a propósito.
        rows = [];
        break;
      default:
        rows = access.accessible();
        rows = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        break;
    }
    if (query.parentBoardId) {
      rows = rows.filter((board) => board.parentBoardId === query.parentBoardId);
    }
    return { boards: access.summaries(rows) };
  });

  app.post('/boards', async (request, reply) => {
    const user = currentUser(request);
    const input = createBoardSchema.parse(request.body ?? {});
    const access = await loadBoardAccess(user.id);

    let parentId: string | null;
    if (input.parentBoardId) {
      const parent = access.get(input.parentBoardId);
      const role = access.roleOf(input.parentBoardId);
      if (!parent || !role) throw notFound('El tablero padre no existe o no tenés acceso');
      if (!access.canEdit(parent.id)) throw forbidden('Necesitás rol de editor en el tablero padre', 'forbidden_role');
      if (parent.trashedAt) throw conflict('No se puede crear dentro de un tablero en la papelera', 'parent_trashed');
      parentId = parent.id;
    } else {
      const root = access.rootBoard();
      if (!root) throw conflict('La cuenta no tiene tablero raíz', 'missing_root_board');
      parentId = root.id;
    }

    let title = input.title && input.title.length > 0 ? input.title : DEFAULT_BOARD_TITLE;
    let documentState: Uint8Array | null = null;
    if (input.templateId) {
      const template = await prisma.template.findUnique({ where: { id: input.templateId } });
      if (!template) throw notFound('La plantilla no existe', 'template_not_found');
      if (template.ownerId !== null && template.ownerId !== user.id && !access.roleOf(template.boardId)) {
        throw forbidden('No tenés acceso a esa plantilla', 'template_forbidden');
      }
      if (!input.title) title = template.name;
      const templateDoc = await prisma.boardDocument.findUnique({ where: { boardId: template.boardId } });
      documentState = templateDoc ? new Uint8Array(templateDoc.yjsState) : null;
    }

    const board = await prisma.$transaction(async (tx) => {
      const created = await tx.board.create({
        data: {
          ownerId: user.id,
          parentBoardId: parentId,
          title,
          icon: input.icon ?? null,
          color: input.color ?? null,
        },
      });
      await tx.boardDocument.create({
        data: { boardId: created.id, yjsState: Buffer.from(documentState ?? emptyDocumentUpdate()) },
      });
      return created;
    });

    const fresh = await loadBoardAccess(user.id);
    const record = fresh.get(board.id);
    if (!record) throw notFound('No se pudo leer el tablero recién creado');
    reply.code(201);
    return { board: fresh.summary(record) };
  });

  app.get('/boards/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const access = await loadBoardAccess(user.id);
    const { record } = requireAccess(access, id);

    const doc = await loadBoardDoc(id);
    const extras: SummaryExtras = { elementCount: doc ? elementCount(doc) : 0 };
    return { board: access.summary(record, extras), breadcrumbs: access.breadcrumbs(id) };
  });

  app.patch('/boards/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const input = updateBoardSchema.parse(request.body ?? {});
    const access = await loadBoardAccess(user.id);
    requireEditor(access, id);

    // `settings` viene en updateBoardSchema pero el modelo Board del plan no
    // tiene esa columna: se acepta y se ignora (documentado en el informe).
    const data: { title?: string; icon?: string | null; color?: string | null; coverImageId?: string | null } = {};
    if (input.title !== undefined && input.title.length > 0) data.title = input.title;
    if (input.icon !== undefined) data.icon = input.icon ?? null;
    if (input.color !== undefined) data.color = input.color ?? null;
    if (input.coverImageId !== undefined) {
      if (input.coverImageId !== null) {
        const asset = await prisma.asset.findUnique({ where: { id: input.coverImageId }, select: { id: true, ownerId: true } });
        if (!asset) throw notFound('El asset de portada no existe', 'asset_not_found');
        if (asset.ownerId !== user.id) throw forbidden('El asset de portada no es tuyo', 'asset_forbidden');
      }
      data.coverImageId = input.coverImageId;
    }

    const updated = Object.keys(data).length > 0
      ? await prisma.board.update({ where: { id }, data })
      : await prisma.board.findUniqueOrThrow({ where: { id } });

    const fresh = await loadBoardAccess(user.id);
    const record = fresh.get(updated.id);
    if (!record) throw notFound();
    return { board: fresh.summary(record) };
  });

  app.delete('/boards/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const access = await loadBoardAccess(user.id);
    const { record } = requireEditor(access, id);
    if (record.parentBoardId === null && record.ownerId === user.id) {
      throw conflict('No se puede enviar a la papelera el tablero raíz', 'cannot_trash_root');
    }

    const ids = access
      .subtree(id)
      .filter((candidate) => {
        const role = access.roleOf(candidate);
        return role === 'owner' || role === 'editor';
      });
    const trashedAt = new Date();
    const result = await prisma.board.updateMany({
      where: { id: { in: ids }, trashedAt: null },
      data: { trashedAt },
    });
    return { ok: true, trashedAt: trashedAt.getTime(), boardIds: ids, updated: result.count };
  });

  app.post('/boards/:id/move', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const input = moveBoardSchema.parse(request.body ?? {});
    const access = await loadBoardAccess(user.id);
    requireEditor(access, id);

    const targetId = input.parentBoardId;
    if (targetId !== null) {
      if (!access.get(targetId) || !access.roleOf(targetId)) {
        throw notFound('El tablero destino no existe o no tenés acceso');
      }
      if (!access.canEdit(targetId)) throw forbidden('Necesitás rol de editor en el destino', 'forbidden_role');
      if (access.get(targetId)?.trashedAt) throw conflict('El destino está en la papelera', 'target_trashed');
    }
    if (!access.canMove(id, targetId)) {
      throw conflict('No se puede mover un tablero dentro de sí mismo o de un descendiente', 'cannot_move_into_descendant');
    }

    const updated = await prisma.board.update({ where: { id }, data: { parentBoardId: targetId } });
    const fresh = await loadBoardAccess(user.id);
    const record = fresh.get(updated.id);
    if (!record) throw notFound();
    return { board: fresh.summary(record) };
  });

  app.post('/boards/:id/duplicate', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const input = duplicateSchema.parse(request.body ?? {});
    const access = await loadBoardAccess(user.id);
    const { record } = requireEditor(access, id);

    const sources = input.includeChildren === true
      ? orderedSubtree(access, id).filter((candidate) => access.canEdit(candidate.id))
      : [record];

    const idMap = new Map<string, string>();
    await prisma.$transaction(async (tx) => {
      for (const source of sources) {
        const parentId =
          source.id === id
            ? record.parentBoardId
            : (source.parentBoardId ? idMap.get(source.parentBoardId) ?? null : null);
        const created = await tx.board.create({
          data: {
            ownerId: user.id,
            parentBoardId: parentId,
            title: source.id === id ? `${source.title}${DUPLICATE_SUFFIX}` : source.title,
            icon: source.icon,
            color: source.color,
            coverImageId: source.coverImageId,
          },
        });
        idMap.set(source.id, created.id);
        // Mismos bytes Yjs que el original (ver informe): el estado se copia tal cual.
        const sourceDoc = await tx.boardDocument.findUnique({ where: { boardId: source.id } });
        await tx.boardDocument.create({
          data: {
            boardId: created.id,
            yjsState: sourceDoc ? Buffer.from(sourceDoc.yjsState) : Buffer.from(emptyDocumentUpdate()),
          },
        });
      }
    });

    const fresh = await loadBoardAccess(user.id);
    const newRootId = idMap.get(id);
    const newRoot = newRootId ? fresh.get(newRootId) : undefined;
    if (!newRoot) throw notFound('No se pudo duplicar el tablero');
    const children = [...idMap.entries()]
      .filter(([sourceId]) => sourceId !== id)
      .map(([, createdAt]) => fresh.get(createdAt))
      .filter((candidate): candidate is BoardRecord => candidate !== undefined);
    reply.code(201);
    return { board: fresh.summary(newRoot), children: fresh.summaries(children) };
  });

  app.get('/boards/:id/breadcrumbs', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const access = await loadBoardAccess(user.id);
    requireAccess(access, id);
    return { breadcrumbs: access.breadcrumbs(id) };
  });

  app.get('/boards/:id/children', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const access = await loadBoardAccess(user.id);
    requireAccess(access, id);
    return { boards: access.summaries(access.children(id)) };
  });

  app.get('/boards/:id/document', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const access = await loadBoardAccess(user.id);
    const { record } = requireAccess(access, id);
    if (record.trashedAt) throw badRequest('El tablero está en la papelera', 'board_trashed');

    const document = await ensureBoardDocument(id);
    return { state: encodeStateBase64(new Uint8Array(document.yjsState)), updatedAt: document.updatedAt.getTime() };
  });
}

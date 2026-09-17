/**
 * Plantillas (§7.1 del plan).
 *
 *   GET  /api/templates                  → catálogo (sistema + propias)
 *   POST /api/templates/:id/instantiate  → crear un tablero desde la plantilla
 *   POST /api/templates/from-board/:id   → guardar un tablero como plantilla
 *
 * Las plantillas del sistema (`ownerId = null`) las crea `scripts/seed-templates.ts`
 * con su documento Yjs: instanciar copia el documento (no un tablero vacío) y
 * remapea las tarjetas de tablero para que apunten a las copias.
 */

import type { FastifyInstance } from 'fastify';
import { instantiateTemplateSchema, templateSchema } from '@tablero/shared';
import { z } from 'zod';

import { prisma } from '../db.js';
import { accessOrThrow, editorOrThrow, loadBoardAccess } from '../lib/boards.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { currentUser } from '../lib/session.js';
import { copyBoardSubtree, fetchTemplateSubtree, templateElementCounts } from '../lib/templates.js';

const idParamsSchema = z.object({ id: z.string().min(1).max(64) });

/** Guardar como plantilla: nombre/descripción/categoría + subtableros. */
const fromBoardSchema = templateSchema
  .omit({ boardId: true })
  .extend({ includeChildren: z.boolean().optional() });

export async function templatesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/templates', async (request) => {
    const user = currentUser(request);
    const rows = await prisma.template.findMany({
      where: { OR: [{ ownerId: null }, { ownerId: user.id }] },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    const counts = await templateElementCounts(rows.map((row) => row.boardId));
    const templates = rows.map((row) => ({
      id: row.id,
      boardId: row.boardId,
      name: row.name,
      description: row.description,
      category: row.category,
      system: row.ownerId === null,
      elementCount: counts.get(row.boardId) ?? 0,
      createdAt: row.createdAt.getTime(),
    }));

    const categories = new Map<string, number>();
    for (const template of templates) {
      categories.set(template.category, (categories.get(template.category) ?? 0) + 1);
    }

    return {
      templates,
      categories: [...categories.entries()].map(([category, count]) => ({ category, count })),
    };
  });

  /** Instanciar: un tablero nuevo con el documento de la plantilla. */
  app.post('/templates/:id/instantiate', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const input = instantiateTemplateSchema.parse(request.body ?? {});
    const access = await loadBoardAccess(user.id);

    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) throw notFound('La plantilla no existe', 'template_not_found');
    if (template.ownerId !== null && template.ownerId !== user.id && !access.canEdit(template.boardId)) {
      throw notFound('La plantilla no existe', 'template_not_found');
    }

    let parentId: string | null = null;
    if (input.parentBoardId) {
      const { record } = accessOrThrow(access, input.parentBoardId);
      if (!access.canEdit(record.id)) {
        throw forbidden('Necesitás rol de editor en el tablero destino', 'forbidden_role');
      }
      if (record.trashedAt) throw conflict('El destino está en la papelera', 'parent_trashed');
      parentId = record.id;
    } else {
      const root = access.rootBoard();
      if (!root) throw conflict('La cuenta no tiene tablero raíz', 'missing_root_board');
      parentId = root.id;
    }

    const sources = await fetchTemplateSubtree(template.boardId);
    if (sources.length === 0) throw notFound('La plantilla no tiene tablero', 'template_board_missing');
    const copy = await copyBoardSubtree({
      sources,
      ownerId: user.id,
      rootParentId: parentId,
      rootTitle: input.title && input.title.length > 0 ? input.title : template.name,
      isTemplate: false,
    });

    const fresh = await loadBoardAccess(user.id);
    const root = fresh.get(copy.root.id);
    if (!root) throw notFound('No se pudo leer el tablero creado');
    const children = copy.created
      .filter((entry) => entry.sourceId !== sources[0]!.id)
      .map((entry) => fresh.get(entry.board.id))
      .filter((board): board is NonNullable<typeof board> => board !== undefined);

    reply.code(201);
    return {
      board: fresh.summary(root),
      children: fresh.summaries(children),
      template: { id: template.id, name: template.name, category: template.category },
    };
  });

  /** Guardar un tablero (y sus subtableros) como plantilla propia. */
  app.post('/templates/from-board/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const input = fromBoardSchema.parse(request.body ?? {});
    const access = await loadBoardAccess(user.id);
    const { record } = editorOrThrow(access, id);

    const sources = await fetchTemplateSubtree(id);
    const includeChildren = input.includeChildren !== false;
    const root = access.rootBoard();
    const copy = await copyBoardSubtree({
      sources: includeChildren ? sources : [sources[0]!],
      ownerId: user.id,
      rootParentId: record.parentBoardId ?? root?.id ?? null,
      rootTitle: input.name,
      isTemplate: true,
    });

    const template = await prisma.template.create({
      data: {
        ownerId: user.id,
        boardId: copy.root.id,
        category: input.category && input.category.length > 0 ? input.category : 'general',
        name: input.name,
        description: input.description ?? null,
      },
    });

    reply.code(201);
    return {
      template: {
        id: template.id,
        boardId: template.boardId,
        name: template.name,
        description: template.description,
        category: template.category,
        system: false,
        createdAt: template.createdAt.getTime(),
      },
      boards: copy.created.length,
    };
  });
}

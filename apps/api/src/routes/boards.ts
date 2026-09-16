/**
 * Rutas de tableros: listado (con filtros de la fase 3), creación, edición,
 * favoritos, papelera, «Sin ordenar», mover, duplicar, migas de pan, hijos y
 * respaldo REST del documento Yjs.
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
/** Título de la bandeja de entrada de la cuenta (§4.3 del plan). */
export const UNSORTED_BOARD_TITLE = 'Sin ordenar';
const UNSORTED_BOARD_ICON = '📥';
const DUPLICATE_SUFFIX = ' (copia)';

const idParamsSchema = z.object({ id: idSchema });
const listQuerySchema = z.object({
  // `all` es el listado normal (sin la bandeja «Sin ordenar»); `recent` ordena
  // por última modificación y `favorites` por cuándo se marcó la estrella.
  filter: z.enum(['all', 'favorites', 'recent', 'shared', 'trash']).default('all'),
  parentBoardId: idSchema.optional(),
});
const duplicateSchema = z.object({ includeChildren: z.boolean().optional() });

/**
 * PATCH de tablero con `favorite`, que todavía no está en `updateBoardSchema`
 * de `@tablero/shared`: se extiende acá el mismo objeto estricto para que
 * `favorite` entre y cualquier otro campo desconocido siga respondiendo 400.
 */
const updateBoardBodySchema = updateBoardSchema
  .innerType()
  .extend({ favorite: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nada que actualizar' });

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

/**
 * Lote en papelera: el tablero y los descendientes que cayeron con él.
 *
 * Mandar un tablero a la papelera marca todo su subárbol con **la misma** marca
 * de tiempo; restaurar o borrar definitivamente trabaja sobre ese lote. Un hijo
 * que se mandó a la papelera por separado (otra marca) conserva su estado: se
 * restaura o se borra por su cuenta.
 */
function trashedBatch(access: BoardAccess, id: string): string[] {
  const record = access.get(id);
  const trashedAt = record?.trashedAt ?? null;
  if (!trashedAt) return [id];
  const batch = trashedAt.getTime();
  return access.subtree(id).filter((candidateId) => {
    if (candidateId === id) return true;
    const candidate = access.get(candidateId);
    return (
      candidate !== undefined &&
      candidate.trashedAt !== null &&
      candidate.trashedAt.getTime() === batch &&
      access.canEdit(candidateId)
    );
  });
}

export async function boardsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/boards', async (request) => {
    const user = currentUser(request);
    const query = listQuerySchema.parse(request.query ?? {});
    const access = await loadBoardAccess(user.id);

    const byUpdatedDesc = (a: BoardRecord, b: BoardRecord) => b.updatedAt.getTime() - a.updatedAt.getTime();
    let rows: BoardRecord[];
    switch (query.filter) {
      case 'trash':
        rows = access
          .accessible({ includeTrashed: true })
          .filter((board) => board.trashedAt !== null)
          .sort((a, b) => (b.trashedAt?.getTime() ?? 0) - (a.trashedAt?.getTime() ?? 0));
        break;
      case 'shared':
        rows = access.accessible().filter((board) => access.roleOf(board.id) !== 'owner');
        break;
      case 'favorites':
        rows = access
          .accessible()
          .filter((board) => board.favoriteAt !== null)
          .sort((a, b) => (b.favoriteAt?.getTime() ?? 0) - (a.favoriteAt?.getTime() ?? 0));
        break;
      case 'recent':
        rows = [...access.accessible()].sort(byUpdatedDesc);
        break;
      default:
        // `all`: el listado normal nunca incluye la bandeja «Sin ordenar», que
        // tiene su propio endpoint (`GET /api/boards/unsorted`).
        rows = access.accessible().filter((board) => !board.isUnsorted).sort(byUpdatedDesc);
        break;
    }
    if (query.parentBoardId) {
      rows = rows.filter((board) => board.parentBoardId === query.parentBoardId);
    }
    return { boards: access.summaries(rows) };
  });

  /**
   * Bandeja de entrada de la cuenta (§4.3): devuelve el tablero «Sin ordenar»,
   * creándolo si todavía no existe. Es único por cuenta y cuelga de la raíz (ya
   * que solo el registro crea raíces).
   */
  app.get('/boards/unsorted', async (request) => {
    const user = currentUser(request);
    let access = await loadBoardAccess(user.id);
    let board = access.unsortedBoard();
    let created = false;

    if (board && board.trashedAt) {
      // La bandeja no se pierde: si alguien la mandó a la papelera, al pedirla
      // vuelve. (El REST ya rechaza mandarla a la papelera; esto es defensivo.)
      await prisma.board.updateMany({
        where: { id: { in: [board.id] }, trashedAt: { not: null } },
        data: { trashedAt: null },
      });
      access = await loadBoardAccess(user.id);
      board = access.unsortedBoard();
    } else if (!board) {
      const root = access.rootBoard();
      if (!root) throw conflict('La cuenta no tiene tablero raíz', 'missing_root_board');
      const result = await prisma.$transaction(async (tx) => {
        // Carrera entre dos pestañas: la segunda reutiliza la bandeja ya creada.
        const existing = await tx.board.findFirst({ where: { ownerId: user.id, isUnsorted: true } });
        if (existing) return { board: existing, created: false };
        const row = await tx.board.create({
          data: {
            ownerId: user.id,
            parentBoardId: root.id,
            title: UNSORTED_BOARD_TITLE,
            icon: UNSORTED_BOARD_ICON,
            isUnsorted: true,
          },
        });
        await tx.boardDocument.create({
          data: { boardId: row.id, yjsState: Buffer.from(emptyDocumentUpdate()) },
        });
        return { board: row, created: true };
      });
      created = result.created;
      access = await loadBoardAccess(user.id);
      board = access.get(result.board.id);
    }

    if (!board) throw notFound('No se pudo obtener el tablero «Sin ordenar»');
    return { board: access.summary(board), created };
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
    const input = updateBoardBodySchema.parse(request.body ?? {});
    const access = await loadBoardAccess(user.id);
    requireEditor(access, id);

    // `settings` ya no está en updateBoardSchema: el modelo Board no tiene esa
    // columna y el esquema (`.strict()`) rechaza el campo con 400 en vez de
    // aceptarlo y descartarlo en silencio.
    const data: {
      title?: string;
      icon?: string | null;
      color?: string | null;
      coverImageId?: string | null;
      favoriteAt?: Date | null;
    } = {};
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
    // La estrella guarda cuándo se marcó (y no un booleano) para poder ordenar
    // los favoritos por relevancia de uso.
    if (input.favorite !== undefined) data.favoriteAt = input.favorite ? new Date() : null;

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
    if (record.isUnsorted) {
      // Misma idea que la raíz: la bandeja «Sin ordenar» es una sola por cuenta
      // y tiene su propio endpoint, así que no se manda a la papelera.
      throw conflict('No se puede enviar a la papelera el tablero «Sin ordenar»', 'cannot_trash_unsorted');
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

  /**
   * Papelera de tableros (§12 del plan): listado, restaurar y borrado definitivo.
   *
   * El listado trae el árbol caído con lo necesario para pintarlo y restaurarlo
   * (título, icono, color, padre, marca de tiempo). Restaurar y borrar
   * definitivamente trabajan sobre el lote que cayó junto con el tablero.
   */
  app.get('/trash', async (request) => {
    const user = currentUser(request);
    const access = await loadBoardAccess(user.id);
    const rows = access
      .accessible({ includeTrashed: true })
      .filter((board) => board.trashedAt !== null)
      .sort((a, b) => (b.trashedAt?.getTime() ?? 0) - (a.trashedAt?.getTime() ?? 0));
    return { boards: access.summaries(rows) };
  });

  app.post('/trash/:id/restore', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const access = await loadBoardAccess(user.id);
    const { record } = requireEditor(access, id);
    if (!record.trashedAt) {
      throw conflict('El tablero no está en la papelera', 'board_not_trashed');
    }
    const blockedBy = access.trashedAncestorOf(id);
    if (blockedBy) {
      throw conflict(`Restaurá primero «${blockedBy.title}»`, 'parent_trashed');
    }

    const ids = trashedBatch(access, id);
    await prisma.board.updateMany({ where: { id: { in: ids }, trashedAt: { not: null } }, data: { trashedAt: null } });

    const fresh = await loadBoardAccess(user.id);
    const restored = fresh.get(id);
    if (!restored) throw notFound();
    return { ok: true, boardIds: ids, board: fresh.summary(restored) };
  });

  app.delete('/trash/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const access = await loadBoardAccess(user.id);
    const { record } = requireEditor(access, id);
    if (!record.trashedAt) {
      throw conflict('Solo se puede borrar definitivamente lo que está en la papelera', 'board_not_trashed');
    }

    // Las filas dependientes (documento, permisos, comentarios) caen por FK.
    const ids = trashedBatch(access, id);
    const result = await prisma.board.deleteMany({ where: { id: { in: ids } } });
    return { ok: true, boardIds: ids, deleted: result.count };
  });

  app.post('/boards/:id/move', async (request) => {
    const user = currentUser(request);
    const { id } = idParamsSchema.parse(request.params);
    const input = moveBoardSchema.parse(request.body ?? {});
    const access = await loadBoardAccess(user.id);
    requireEditor(access, id);

    const targetId = input.parentBoardId;
    // Las raíces solo se crean en el registro: aceptar `null` dejaría una
    // segunda raíz, que además después no se puede mandar a la papelera.
    if (targetId === null) {
      throw conflict('Solo el registro crea el tablero raíz de una cuenta', 'cannot_create_second_root');
    }
    if (!access.get(targetId) || !access.roleOf(targetId)) {
      throw notFound('El tablero destino no existe o no tenés acceso');
    }
    if (!access.canEdit(targetId)) throw forbidden('Necesitás rol de editor en el destino', 'forbidden_role');
    if (access.get(targetId)?.trashedAt) throw conflict('El destino está en la papelera', 'target_trashed');
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

    // Duplicar la raíz no puede crear otra raíz: la copia se anida dentro de la
    // raíz de la cuenta (una sola raíz por usuario, la del registro). Si el
    // tablero duplicado es la raíz de otro, la copia cuelga de la raíz propia.
    const copyParentId = record.parentBoardId ?? access.rootBoard()?.id;
    if (!copyParentId) throw conflict('La cuenta no tiene tablero raíz', 'missing_root_board');

    const idMap = new Map<string, string>();
    await prisma.$transaction(async (tx) => {
      for (const source of sources) {
        // Un hijo cuyo padre no está en la copia (p. ej. filtrado por permisos)
        // se anida en la copia de la raíz, nunca al nivel superior.
        const parentId =
          source.id === id
            ? copyParentId
            : (source.parentBoardId ? idMap.get(source.parentBoardId) ?? copyParentId : copyParentId);
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

/**
 * Actividad del tablero (fase 5).
 *
 * La reporta el **cliente** por lotes (`POST /api/boards/:id/activity`), con el
 * usuario tomado de la sesión: no es una frontera de seguridad (es un registro
 * para leer) y evita diffear el documento en cada guardado. El servidor:
 *
 *   - limita el lote (`MAX_ACTIVITY_BATCH`) y la antigüedad de las marcas del
 *     cliente (ni futuro ni más de 30 días atrás);
 *   - valida los `elementId` contra el documento **vivo** si el tablero está
 *     abierto en memoria (el registro del servidor de colaboración) y, si no,
 *     contra el persistido. Validar solo contra el persistido descartaba casi
 *     todo: el cliente reporta a los 2,5 s y el guardado va con debounce (2 s,
 *     tope 10 s), así que el elemento recién creado todavía no estaba en
 *     `BoardDocument` y el evento se tiraba;
 *   - guarda el actor de la sesión, nunca el que venga en el cuerpo.
 */

import type { ActivityAction, ActivitySummary } from '@tablero/shared';
import { elementsOf } from '@tablero/shared';
import type * as Y from 'yjs';

import { liveBoardDocument } from '../collab/server.js';
import { prisma } from '../db.js';
import { loadBoardDoc } from './documents.js';

export type ActivityEventInput = {
  action: ActivityAction;
  elementId?: string | undefined;
  elementType?: string | undefined;
  meta?: Record<string, unknown> | undefined;
  at?: number | undefined;
};

/** Tolerancia de reloj del cliente (5 min) y antigüedad máxima aceptada. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type RecordActivityResult = { accepted: number; discarded: number; events: ActivitySummary[] };

function clampTimestamp(at: number | undefined, now: number): Date {
  if (typeof at !== 'number' || !Number.isFinite(at)) return new Date(now);
  const bounded = Math.min(Math.max(at, now - MAX_AGE_MS), now + CLOCK_SKEW_MS);
  return new Date(bounded);
}

/**
 * Guarda el lote.
 *
 * El documento para validar sale de: `options.doc` (lo pasa un test) → el
 * documento **vivo** del tablero si está abierto en el servidor de colaboración
 * → el estado persistido. Los eventos de elementos que no están en él se
 * descartan en silencio.
 */
export async function recordActivity(
  boardId: string,
  userId: string,
  events: ActivityEventInput[],
  options: { doc?: Y.Doc | null; now?: number } = {},
): Promise<RecordActivityResult> {
  const now = options.now ?? Date.now();
  const doc =
    options.doc !== undefined ? options.doc : (liveBoardDocument(boardId) ?? (await loadBoardDoc(boardId)));
  const existing = doc ? new Set(elementsOf(doc).keys()) : null;

  const accepted: ActivityEventInput[] = [];
  let discarded = 0;
  for (const event of events) {
    if (event.elementId !== undefined && existing !== null && !existing.has(event.elementId)) {
      discarded += 1;
      continue;
    }
    // Un tablero sin documento todavía no tiene elementos: los eventos con
    // elemento no pueden verificarse y se descartan (no se inventa el registro).
    if (event.elementId !== undefined && existing === null) {
      discarded += 1;
      continue;
    }
    accepted.push(event);
  }
  if (accepted.length === 0) return { accepted: 0, discarded, events: [] };

  const rows = await prisma.$transaction(
    accepted.map((event) =>
      prisma.activity.create({
        data: {
          boardId,
          userId,
          action: event.action,
          elementId: event.elementId ?? null,
          elementType: event.elementType ?? null,
          meta: (event.meta ?? {}) as object,
          createdAt: clampTimestamp(event.at, now),
        },
        include: { user: { select: { name: true } } },
      }),
    ),
  );

  return {
    accepted: rows.length,
    discarded,
    events: rows.map(toActivitySummary),
  };
}

function toActivitySummary(row: {
  id: string;
  boardId: string;
  userId: string;
  action: string;
  elementId: string | null;
  elementType: string | null;
  meta: unknown;
  createdAt: Date;
  user: { name: string };
}): ActivitySummary {
  return {
    id: row.id,
    boardId: row.boardId,
    userId: row.userId,
    userName: row.user.name,
    action: row.action as ActivityAction,
    elementId: row.elementId,
    elementType: row.elementType,
    meta: (row.meta ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.getTime(),
  };
}

export type ListActivityOptions = {
  limit: number;
  /** Cursor opaco que devolvió el listado anterior (`nextCursor`). */
  cursor?: string | undefined;
  elementId?: string | undefined;
};

/**
 * Cursor opaco del listado: `createdAt` (ms) + id de la última entrada. Viaja
 * en base64url para que el cliente no dependa del formato.
 */
export function encodeActivityCursor(row: { createdAt: number; id: string }): string {
  return Buffer.from(`${row.createdAt}:${row.id}`, 'utf8').toString('base64url');
}

export function decodeActivityCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = raw.indexOf(':');
    if (separator <= 0) return null;
    const createdAt = Number.parseInt(raw.slice(0, separator), 10);
    const id = raw.slice(separator + 1);
    if (!Number.isFinite(createdAt) || id.length === 0) return null;
    return { createdAt: new Date(createdAt), id };
  } catch {
    return null;
  }
}

/** Registro del tablero, lo más nuevo primero, paginado por cursor. */
export async function listActivity(boardId: string, options: ListActivityOptions): Promise<ActivitySummary[]> {
  const cursor = decodeActivityCursor(options.cursor);
  const rows = await prisma.activity.findMany({
    where: {
      boardId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
      ...(options.elementId ? { elementId: options.elementId } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit,
    include: { user: { select: { name: true } } },
  });
  return rows.map(toActivitySummary);
}

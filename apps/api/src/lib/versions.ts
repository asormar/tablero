/**
 * Historial de versiones (§7.5 del plan).
 *
 * Mecanismo elegido:
 *
 *   - **Instantáneas automáticas** del documento Yjs en `BoardVersion`, creadas
 *     desde el mismo hook de persistencia de Hocuspocus (`onStoreDocument`).
 *     El throttle es de **10 minutos de actividad por tablero**: al guardar, si
 *     la última instantánea es más vieja que el intervalo, se agrega una nueva.
 *     El throttle se resuelve contra la base (una consulta por índice), así que
 *     sobrevive a reinicios y vale también con varias instancias del API.
 *   - **Instantánea manual** (`POST /api/boards/:id/versions`) para que el
 *     usuario fije un punto antes de un cambio grande.
 *   - **Restaurar** sustituye el estado persistido y **cierra las conexiones de
 *     ese tablero** (Hocuspocus descarga el documento): los clientes reconectan
 *     y reciben el estado restaurado. Antes de sustituir se guarda el estado
 *     actual como instantánea `pre-restore`, así la restauración es reversible.
 *   - **Retención acotada**: se conservan las últimas 50 instantáneas de cada
 *     tablero y, de lo más viejo (hasta 30 días), una por día.
 */

import type { BoardVersion } from '@prisma/client';
import * as Y from 'yjs';

import { prisma } from '../db.js';
import { decodeState, syncSearchIndex } from './documents.js';

/** Intervalo del snapshot automático: 10 minutos de actividad por tablero. */
export const VERSION_INTERVAL_MS = 10 * 60 * 1000;
/** Instantáneas recientes que se conservan siempre, por tablero. */
export const VERSION_KEEP_RECENT = 50;
/** Días hacia atrás en los que se conserva, además, una instantánea por día. */
export const VERSION_KEEP_DAILY_DAYS = 30;

export type VersionOrigin = 'auto' | 'manual' | 'pre-restore';

export type VersionSummary = {
  id: string;
  boardId: string;
  createdAt: number;
  elementCount: number;
  sizeBytes: number;
  origin: string;
};

export function toVersionSummary(version: BoardVersion): VersionSummary {
  return {
    id: version.id,
    boardId: version.boardId,
    createdAt: version.createdAt.getTime(),
    elementCount: version.elementCount,
    sizeBytes: version.sizeBytes,
    origin: version.origin,
  };
}

/**
 * Guarda una instantánea si el throttle lo permite (o si `force`).
 * Devuelve la fila creada, o `null` si se omitió por el intervalo.
 */
export async function recordVersion(input: {
  boardId: string;
  state: Uint8Array;
  elementCount: number;
  origin: VersionOrigin;
  force?: boolean;
  now?: Date;
}): Promise<BoardVersion | null> {
  const now = input.now ?? new Date();
  if (!input.force) {
    const latest = await prisma.boardVersion.findFirst({
      where: { boardId: input.boardId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest && now.getTime() - latest.createdAt.getTime() < VERSION_INTERVAL_MS) return null;
  }
  return prisma.boardVersion.create({
    data: {
      boardId: input.boardId,
      yjsState: Buffer.from(input.state),
      elementCount: input.elementCount,
      sizeBytes: input.state.byteLength,
      origin: input.origin,
      createdAt: now,
    },
  });
}

/** Instantánea de un `Y.Doc` vivo (los bytes se calculan acá). */
export async function snapshotDocument(
  boardId: string,
  doc: Y.Doc,
  origin: VersionOrigin,
  options: { force?: boolean } = {},
): Promise<BoardVersion | null> {
  const state = Y.encodeStateAsUpdate(doc);
  return recordVersion({
    boardId,
    state,
    elementCount: doc.getMap('elements').size,
    origin,
    force: options.force,
  });
}

/**
 * Retención: últimas `VERSION_KEEP_RECENT` + una por día (hasta 30 días).
 * Devuelve cuántas filas se borraron.
 */
export async function pruneVersions(boardId: string, now: Date = new Date()): Promise<number> {
  const rows = await prisma.boardVersion.findMany({
    where: { boardId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });
  if (rows.length <= VERSION_KEEP_RECENT) return 0;

  const keep = new Set<string>();
  for (const row of rows.slice(0, VERSION_KEEP_RECENT)) keep.add(row.id);

  const oldestKept = now.getTime() - VERSION_KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000;
  const daysSeen = new Set<string>();
  for (const row of rows.slice(VERSION_KEEP_RECENT)) {
    if (row.createdAt.getTime() < oldestKept) continue;
    const day = row.createdAt.toISOString().slice(0, 10);
    if (daysSeen.has(day)) continue;
    daysSeen.add(day);
    keep.add(row.id);
  }

  const deleteIds = rows.filter((row) => !keep.has(row.id)).map((row) => row.id);
  if (deleteIds.length === 0) return 0;
  const result = await prisma.boardVersion.deleteMany({ where: { id: { in: deleteIds } } });
  return result.count;
}

/** Listado de versiones de un tablero, la más nueva primero. */
export async function listVersions(boardId: string, limit = 50): Promise<VersionSummary[]> {
  const rows = await prisma.boardVersion.findMany({
    where: { boardId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(toVersionSummary);
}

/**
 * Sustituye el estado persistido del tablero por el de la instantánea y deja el
 * índice de búsqueda al día. El cierre de las conexiones lo hace la ruta (es
 * este proceso el que las tiene abiertas).
 */
export async function applyVersion(boardId: string, version: BoardVersion): Promise<{ elements: number }> {
  const state = new Uint8Array(version.yjsState);
  await prisma.boardDocument.upsert({
    where: { boardId },
    create: { boardId, yjsState: Buffer.from(state) },
    update: { yjsState: Buffer.from(state) },
  });
  const doc = decodeState(state);
  const elements = await syncSearchIndex(boardId, doc);
  return { elements };
}

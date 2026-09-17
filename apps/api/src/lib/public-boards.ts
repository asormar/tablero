/**
 * Publicación de tableros (fase 5): `/p/:slug`, solo lectura y sin sesión.
 *
 * Decisiones:
 * - El slug es **inadvertible**: 12 caracteres base58 aleatorios (no el título).
 * - La contraseña es opcional y se guarda con argon2 (nunca en claro).
 * - La vista pública **no tiene socket**: el visitante lee la proyección del
 *   documento persistido + un mapa de assets firmados, y la web refresca cada
 *   15 s. Es una simplificación deliberada: la colaboración en vivo es para las
 *   cuentas con sesión.
 * - No se filtra nada privado: ni emails, ni miembros, ni la conversación de
 *   los comentarios, ni los ids de autor que viajan dentro del documento. El
 *   estado que sale es una **copia saneada** (sin `comment-pin`, sin
 *   `createdBy`/`deletedBy`), no el documento real.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Asset } from '@prisma/client';
import type { PublicAssetRef, PublicBoardDocument, PublicBoardSummary, PublicSubBoard } from '@tablero/shared';
import { COMMENTS_KEY, elementCount, elementsOf, getOrderedElements, isImageMime, removeElements } from '@tablero/shared';
import * as Y from 'yjs';

import { prisma } from '../db.js';
import { env } from '../env.js';
import { decodeState } from './documents.js';
import { getObjectStream, type ObjectStream } from './storage.js';
import { badRequest, notFound } from './errors.js';
import { collectAssetIds } from './export.js';

import { hashPassword, verifyPassword } from './users.js';

/** Alfabeto base58 (sin 0, O, I, l: no se confunden al dictarlos). */
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const PUBLIC_SLUG_LENGTH = 12;

/** Slug inadvertible: 12 caracteres base58 (~70 bits). */
export function generatePublicSlug(length: number = PUBLIC_SLUG_LENGTH): string {
  const bytes = randomBytes(length * 2);
  let slug = '';
  let index = 0;
  while (slug.length < length) {
    const byte = bytes[index++];
    if (byte === undefined || byte >= 232) {
      // Rechazo del resto (232 = 4 * 58): evita el sesgo de módulo.
      const extra = randomBytes(4);
      for (const value of extra) {
        if (value < 232) {
          slug += BASE58[value % 58];
          if (slug.length >= length) break;
        }
      }
      continue;
    }
    slug += BASE58[byte % 58];
  }
  return slug;
}

export type PublishInput = {
  password?: string | null | undefined;
  includeSubBoards?: boolean | undefined;
  rotateSlug?: boolean | undefined;
};

export type PublishResult = { slug: string; publishedAt: Date; includeSubBoards: boolean; requiresPassword: boolean };

/**
 * Publica (o actualiza la publicación de) un tablero. Sin `password` no se
 * toca la contraseña existente; con `password: null` se quita. `rotateSlug`
 * genera un enlace nuevo (el anterior deja de existir).
 */
export async function publishBoard(
  boardId: string,
  input: PublishInput,
  current: { publishedSlug: string | null; publishedAt: Date | null },
): Promise<PublishResult> {
  const data: {
    publishedSlug?: string;
    publishedPasswordHash?: string | null;
    publishedAt: Date;
    publicIncludeSubBoards?: boolean;
  } = { publishedAt: current.publishedAt ?? new Date() };

  if (input.rotateSlug === true || !current.publishedSlug) {
    data.publishedSlug = await uniquePublicSlug();
  }
  if (input.password !== undefined) {
    if (input.password === null) {
      data.publishedPasswordHash = null;
    } else {
      if (input.password.length < 4) throw badRequest('La contraseña debe tener al menos 4 caracteres', 'invalid_password');
      data.publishedPasswordHash = await hashPassword(input.password);
    }
  }
  if (input.includeSubBoards !== undefined) data.publicIncludeSubBoards = input.includeSubBoards;

  const row = await prisma.board.update({
    where: { id: boardId },
    data,
    select: { publishedSlug: true, publishedAt: true, publicIncludeSubBoards: true, publishedPasswordHash: true },
  });
  return {
    slug: row.publishedSlug!,
    publishedAt: row.publishedAt ?? new Date(),
    includeSubBoards: row.publicIncludeSubBoards,
    requiresPassword: row.publishedPasswordHash !== null,
  };
}

/** Slug libre (reintenta ante una colisión, que es improbable). */
export async function uniquePublicSlug(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = generatePublicSlug();
    const existing = await prisma.board.findUnique({ where: { publishedSlug: slug }, select: { id: true } });
    if (!existing) return slug;
  }
  throw new Error('No se pudo generar un slug público libre');
}

/** Despublica: el enlace deja de resolver y la contraseña se descarta. */
export async function unpublishBoard(boardId: string): Promise<void> {
  await prisma.board.update({
    where: { id: boardId },
    data: { publishedSlug: null, publishedPasswordHash: null, publishedAt: null },
  });
}

export type PublishedBoard = {
  id: string;
  ownerId: string;
  title: string;
  icon: string | null;
  color: string | null;
  parentBoardId: string | null;
  trashedAt: Date | null;
  /** Slug con el que se pidió la publicación (compuesto si es un subtablero). */
  publishedSlug: string;
  /** Slug de la publicación **raíz**: la base de los slugs de sus hijos. */
  rootSlug: string;
  publishedPasswordHash: string | null;
  publishedAt: Date;
  publicIncludeSubBoards: boolean;
  ownerName: string;
};

const PUBLISHED_SELECT = {
  id: true,
  ownerId: true,
  title: true,
  icon: true,
  color: true,
  parentBoardId: true,
  trashedAt: true,
  publishedSlug: true,
  publishedPasswordHash: true,
  publishedAt: true,
  publicIncludeSubBoards: true,
  owner: { select: { name: true } },
} as const;

/** Enlace público del tablero (`/p/:slug`), para mostrarlo y copiarlo. */
export function publicBoardUrl(slug: string): string {
  return `${env.appOrigin.replace(/\/$/, '')}/p/${slug}`;
}

// --- Slugs compuestos de los subtableros ------------------------------------
//
// Cada subtablero navegable tiene **slug propio**: `<slug del padre>~<boardId>`.
// La web enlaza a `/p/<slug>` y el servidor resuelve el compuesto comprobando
// que el hijo cuelga de la publicación y que el ajuste los incluye.

export const PUBLIC_SLUG_SEPARATOR = '~';

/** Slug compuesto de un subtablero publicado. */
export function publicChildSlug(parentSlug: string, boardId: string): string {
  return `${parentSlug}${PUBLIC_SLUG_SEPARATOR}${boardId}`;
}

/** Separa un slug compuesto; `null` si es un slug simple (la publicación raíz). */
export function splitPublicSlug(slug: string): { parentSlug: string; boardId: string } | null {
  const at = slug.indexOf(PUBLIC_SLUG_SEPARATOR);
  if (at <= 0 || at >= slug.length - 1) return null;
  return { parentSlug: slug.slice(0, at), boardId: slug.slice(at + 1) };
}

/** Tablero publicado por slug (null si no existe, no está publicado o está en la papelera). */
export async function findPublishedBoard(slug: string): Promise<PublishedBoard | null> {
  const root = await findPublishedRoot(slug);
  if (root) return root;

  const composite = splitPublicSlug(slug);
  if (!composite) return null;
  const parent = await findPublishedRoot(composite.parentSlug);
  if (!parent || !parent.publicIncludeSubBoards) return null;
  const child = await publishedDescendant(parent, composite.boardId);
  if (!child) return null;
  // El hijo hereda la contraseña, la fecha y el ajuste de la publicación raíz;
  // su `publishedSlug` es el compuesto con el que se pidió (y con el que se
  // firman sus assets).
  return {
    ...child,
    publishedSlug: slug,
    rootSlug: parent.publishedSlug,
    publishedPasswordHash: parent.publishedPasswordHash,
    publishedAt: parent.publishedAt,
    publicIncludeSubBoards: parent.publicIncludeSubBoards,
    ownerName: parent.ownerName,
  };
}

async function findPublishedRoot(slug: string): Promise<PublishedBoard | null> {
  const row = await prisma.board.findUnique({ where: { publishedSlug: slug }, select: PUBLISHED_SELECT });
  if (!row || row.publishedAt === null || row.publishedSlug === null || row.trashedAt !== null) return null;
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    icon: row.icon,
    color: row.color,
    parentBoardId: row.parentBoardId,
    trashedAt: row.trashedAt,
    publishedSlug: row.publishedSlug,
    rootSlug: row.publishedSlug,
    publishedPasswordHash: row.publishedPasswordHash,
    publishedAt: row.publishedAt,
    publicIncludeSubBoards: row.publicIncludeSubBoards,
    ownerName: row.owner.name,
  };
}

/**
 * Descendiente de la publicación (el boardId pedido), subiendo por la cadena de
 * ancestros: solo se sirve si cuelga del tablero publicado (a cualquier
 * profundidad) y no está en la papelera.
 */
async function publishedDescendant(parent: PublishedBoard, boardId: string): Promise<PublishedBoard | null> {
  if (boardId === parent.id) return parent;
  const seen = new Set<string>();
  let cursor: string | null = boardId;
  let requested: {
    id: string;
    ownerId: string;
    title: string;
    icon: string | null;
    color: string | null;
    parentBoardId: string | null;
    trashedAt: Date | null;
  } | null = null;
  while (cursor && !seen.has(cursor) && seen.size < 32) {
    seen.add(cursor);
    const row: {
      id: string;
      ownerId: string;
      title: string;
      icon: string | null;
      color: string | null;
      parentBoardId: string | null;
      trashedAt: Date | null;
    } | null = await prisma.board.findUnique({
      where: { id: cursor },
      select: { id: true, ownerId: true, title: true, icon: true, color: true, parentBoardId: true, trashedAt: true },
    });
    if (!row || row.trashedAt) return null;
    requested ??= row;
    if (row.parentBoardId === parent.id) {
      return {
        ...requested,
        publishedSlug: parent.publishedSlug,
        rootSlug: parent.publishedSlug,
        publishedPasswordHash: parent.publishedPasswordHash,
        publishedAt: parent.publishedAt,
        publicIncludeSubBoards: parent.publicIncludeSubBoards,
        ownerName: parent.ownerName,
      };
    }
    cursor = row.parentBoardId;
  }
  return null;
}

/** Comprueba la contraseña de la publicación (`true` si no hay contraseña). */
export async function checkPublicPassword(board: PublishedBoard, password: string | undefined): Promise<boolean> {
  if (board.publishedPasswordHash === null) return true;
  if (!password) return false;
  return verifyPassword(board.publishedPasswordHash, password);
}

/**
 * ¿Puede el visitante anónimo abrir ese tablero? Solo el publicado y, si el
 * ajuste lo permite, sus descendientes.
 */
export async function resolvePublicTarget(
  board: PublishedBoard,
  requestedBoardId: string | undefined,
): Promise<{ id: string; title: string; breadcrumbs: { id: string; title: string }[] } | null> {
  if (!requestedBoardId || requestedBoardId === board.id) {
    return { id: board.id, title: board.title, breadcrumbs: [{ id: board.id, title: board.title }] };
  }
  if (!board.publicIncludeSubBoards) return null;

  const path: { id: string; title: string }[] = [];
  let cursor: string | null = requestedBoardId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor) && path.length < 32) {
    seen.add(cursor);
    const row: { id: string; title: string; parentBoardId: string | null; trashedAt: Date | null } | null =
      await prisma.board.findUnique({
        where: { id: cursor },
        select: { id: true, title: true, parentBoardId: true, trashedAt: true },
      });
    if (!row || row.trashedAt) return null;
    path.unshift({ id: row.id, title: row.title });
    if (row.parentBoardId === board.id) {
      return { id: requestedBoardId, title: row.title, breadcrumbs: [{ id: board.id, title: board.title }, ...path] };
    }
    cursor = row.parentBoardId;
  }
  return null;
}

/** Subtítulos publicados: los descendientes directos, con su slug compuesto. */
export async function publicSubBoards(board: PublishedBoard): Promise<PublicSubBoard[]> {
  if (!board.publicIncludeSubBoards) return [];
  const rows = await prisma.board.findMany({
    where: { parentBoardId: board.id, trashedAt: null },
    select: { id: true, title: true, icon: true, color: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  // La base del slug es el de la publicación **raíz** (no el compuesto del
  // tablero que se está mirando): así un nieto también se resuelve.
  return rows.map((row) => ({
    id: row.id,
    slug: publicChildSlug(board.rootSlug, row.id),
    title: row.title,
    icon: row.icon,
    color: row.color,
  }));
}

/** Resumen público: metadatos del tablero, sin nada de la cuenta. */
export async function publicBoardSummary(board: PublishedBoard): Promise<PublicBoardSummary> {
  const [document, subBoards] = await Promise.all([
    prisma.boardDocument.findUnique({ where: { boardId: board.id }, select: { yjsState: true } }),
    publicSubBoards(board),
  ]);
  let count = 0;
  if (document) {
    try {
      count = elementCount(decodeState(new Uint8Array(document.yjsState)));
    } catch {
      count = 0;
    }
  }
  return {
    slug: board.publishedSlug,
    boardId: board.id,
    title: board.title,
    icon: board.icon,
    color: board.color,
    publishedAt: board.publishedAt.getTime(),
    includeSubBoards: board.publicIncludeSubBoards,
    requiresPassword: board.publishedPasswordHash !== null,
    authorName: board.ownerName,
    subBoards,
    elementCount: count,
  };
}

/**
 * Estado Yjs saneado para el visitante: fuera la conversación de comentarios
 * (`doc.getMap('comments')`, que es privada) y los ids de autor de cada
 * elemento. Los `comment-pin` que quedaran de documentos viejos también se
 * retiran: los comentarios ya no son elementos del lienzo.
 */
export function sanitizePublicState(state: Uint8Array): Uint8Array {
  const doc = decodeState(state);
  const store = elementsOf(doc);
  const comments: string[] = [];
  store.forEach((map, id) => {
    if (map.get('type') === 'comment-pin') {
      comments.push(id);
      return;
    }
    map.delete('createdBy');
    map.delete('deletedBy');
  });
  if (comments.length > 0) removeElements(doc, comments, 'public');
  const commentStore = doc.getMap(COMMENTS_KEY);
  const commentIds = [...commentStore.keys()];
  if (commentIds.length > 0) {
    doc.transact(() => {
      for (const id of commentIds) commentStore.delete(id);
    }, 'public');
  }
  return Y.encodeStateAsUpdate(doc);
}

function toPublicAssetRef(asset: Asset, url: string, thumbnailUrl: string | null): PublicAssetRef {
  return {
    id: asset.id,
    mime: asset.mime,
    type: asset.type,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    originalName: asset.originalName,
    url,
    thumbnailUrl,
  };
}

// --- Assets públicos firmados ----------------------------------------------
//
// El visitante anónimo no puede usar `/api/assets/:id` (exige sesión) y las
// claves del almacenamiento (`assets/<ownerId>/<assetId>.<ext>`) no deben salir
// del servidor: llevan el id del dueño dentro. Por eso la vista pública firma
// sus propios enlaces con HMAC —vida corta— y los sirve el API en streaming.

/** Secreto de firma: `SESSION_SECRET` si está, y si no uno aleatorio del proceso. */
let fallbackSecret: Buffer | null = null;
function assetSecret(): Buffer {
  if (env.sessionSecret.length >= 32) return Buffer.from(env.sessionSecret, 'utf8');
  fallbackSecret ??= randomBytes(32);
  return fallbackSecret;
}

/** Vida de los enlaces públicos de asset (15 min, como las URLs firmadas de S3). */
export const PUBLIC_ASSET_TTL_MS = 15 * 60 * 1000;

function signPayload(payload: string): string {
  return createHmac('sha256', assetSecret()).update(payload).digest('base64url');
}

export type PublicAssetVariant = 'raw' | 'thumb';

/** Firma un enlace de asset para una publicación (`slug` + `assetId` + variante). */
export function signPublicAsset(input: { slug: string; assetId: string; variant: PublicAssetVariant; expiresAt: number }): string {
  const payload = `${input.slug}.${input.assetId}.${input.variant}.${input.expiresAt}`;
  return `${input.expiresAt}.${signPayload(payload)}`;
}

/** Comprueba la firma y la caducidad del enlace público de un asset. */
export function verifyPublicAssetToken(
  token: string | undefined,
  input: { slug: string; assetId: string; variant: PublicAssetVariant; now?: number },
): boolean {
  if (!token) return false;
  const separator = token.indexOf('.');
  if (separator <= 0) return false;
  const expiresAt = Number.parseInt(token.slice(0, separator), 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= (input.now ?? Date.now())) return false;
  const expected = signPayload(`${input.slug}.${input.assetId}.${input.variant}.${expiresAt}`);
  const provided = token.slice(separator + 1);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/** URL pública (firmada) de un asset de la publicación. */
export function publicAssetUrl(slug: string, assetId: string, variant: PublicAssetVariant = 'raw'): string {
  const token = signPublicAsset({ slug, assetId, variant, expiresAt: Date.now() + PUBLIC_ASSET_TTL_MS });
  const suffix = variant === 'thumb' ? '&variant=thumb' : '';
  return `/api/public/boards/${slug}/assets/${assetId}?token=${encodeURIComponent(token)}${suffix}`;
}

/** Documento público: estado saneado + assets firmados + migas de navegación. */
export async function publicBoardDocument(
  board: PublishedBoard,
  target: { id: string; title: string; breadcrumbs: { id: string; title: string }[] },
): Promise<PublicBoardDocument> {
  const row = await prisma.boardDocument.findUnique({ where: { boardId: target.id } });
  if (!row) throw notFound('El tablero todavía no tiene contenido', 'public_document_missing');

  const state = sanitizePublicState(new Uint8Array(row.yjsState));
  const doc = decodeState(state);
  const wanted = collectAssetIds(getOrderedElements(doc));
  const assets = wanted.length > 0 ? await prisma.asset.findMany({ where: { id: { in: wanted } } }) : [];

  const map: Record<string, PublicAssetRef> = {};
  for (const asset of assets) {
    const hasPreview = asset.thumbnailKey !== null || isImageMime(asset.mime);
    map[asset.id] = toPublicAssetRef(
      asset,
      publicAssetUrl(board.publishedSlug, asset.id, 'raw'),
      hasPreview ? publicAssetUrl(board.publishedSlug, asset.id, 'thumb') : null,
    );
  }

  return {
    boardId: target.id,
    title: target.title,
    state: Buffer.from(state).toString('base64'),
    updatedAt: row.updatedAt.getTime(),
    assets: map,
    breadcrumbs: target.breadcrumbs,
  };
}

/**
 * Objeto del asset para servirlo en la vista pública: la variante `thumb` usa
 * la miniatura si existe y, si no, el original (igual que `/assets/:id/thumb`).
 */
export async function publicAssetObject(assetId: string, variant: PublicAssetVariant): Promise<{ asset: Asset; stream: ObjectStream } | null> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) return null;
  const key = variant === 'thumb' ? (asset.thumbnailKey ?? asset.storageKey) : asset.storageKey;
  const stream = await getObjectStream(key);
  if (!stream) return null;
  return { asset, stream };
}

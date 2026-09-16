/** Usuarios: alta con tablero raíz y utilidades de contraseña. */

import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { ROOT_BOARD_TITLE } from '@tablero/shared';
import type { User } from '@prisma/client';

import { prisma } from '../db.js';
import { emptyDocumentUpdate } from './documents.js';

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  settings: unknown;
  createdAt: Date;
};

/** Proyección segura: nunca incluye `passwordHash` ni `captureToken`. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    settings: user.settings,
    createdAt: user.createdAt,
  };
}

export function hashPassword(password: string): Promise<string> {
  return argonHash(password);
}

/** Verificación tolerante: un hash corrupto no debe tumbar la request. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(passwordHash, password);
  } catch {
    return false;
  }
}

export const ROOT_BOARD_ICON = '🏠';

/**
 * Alta de usuario: cuenta + tablero raíz 'Inicio' + documento Yjs vacío, todo
 * en una transacción (un usuario sin raíz deja la app inutilizable).
 */
export async function createUserWithRootBoard(input: { email: string; name: string; password: string }) {
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, passwordHash },
    });
    const rootBoard = await tx.board.create({
      data: {
        ownerId: user.id,
        parentBoardId: null,
        title: ROOT_BOARD_TITLE,
        icon: ROOT_BOARD_ICON,
      },
    });
    await tx.boardDocument.create({
      data: { boardId: rootBoard.id, yjsState: Buffer.from(emptyDocumentUpdate()) },
    });
    return { user, rootBoard };
  });
}

/** Crea tablero + documento vacío (o con los bytes de una plantilla). */
export async function createBoardWithDocument(input: {
  ownerId: string;
  parentBoardId: string | null;
  title: string;
  icon?: string | null;
  color?: string | null;
  documentState?: Uint8Array;
}) {
  return prisma.$transaction(async (tx) => {
    const board = await tx.board.create({
      data: {
        ownerId: input.ownerId,
        parentBoardId: input.parentBoardId,
        title: input.title,
        icon: input.icon ?? null,
        color: input.color ?? null,
      },
    });
    await tx.boardDocument.create({
      data: {
        boardId: board.id,
        yjsState: Buffer.from(input.documentState ?? emptyDocumentUpdate()),
      },
    });
    return board;
  });
}

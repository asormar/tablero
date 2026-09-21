/**
 * Colaboración (fase 5): contratos compartidos entre API y web.
 *
 * Acá viven los esquemas de entrada y los tipos de respuesta de miembros,
 * invitaciones, comentarios, actividad, notificaciones, presencia y
 * publicación; y el color del cursor, que sale del id del usuario.
 *
 * La autorización real vive en el servidor (`apps/api/src/lib/access.ts`):
 * `resolveBoardAccess(userId, boardId)` devuelve `owner | editor | commenter |
 * viewer | none` con herencia por la cadena de ancestros.
 */

import { z } from 'zod';

import { BOARD_ROLES, type BoardRole, type EffectiveRole } from './boards.js';
import { MENTION_LIMIT } from './comments.js';
import { emailSchema, idSchema } from './schema.js';

/** Rol efectivo de un tablero, incluido «sin acceso». */
export type AccessLevel = EffectiveRole | 'none';

// --- Color del cursor -------------------------------------------------------

/**
 * Ocho tokens de la paleta para los cursores ajenos. Se eligen del id del
 * usuario (hash estable FNV-1a), así que dos personas distintas casi nunca
 * comparten color y el mismo usuario siempre tiene el mismo.
 *
 * El orden y el hash son **los mismos que usa la web**
 * (`apps/web/src/collab/presence.ts`): la presencia que publica el servidor y
 * el color que cada cliente calcula para sí tienen que coincidir.
 */
export const CURSOR_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'teal', 'red', 'indigo'] as const;
export type CursorColor = (typeof CURSOR_COLORS)[number];

/** Hash FNV-1a de 32 bits sin signo (idéntico al de la web). */
export function cursorHash(userId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Color de cursor del usuario: estable, derivado de su id (no del nombre). */
export function cursorColor(userId: string): CursorColor {
  const index = cursorHash(userId) % CURSOR_COLORS.length;
  return CURSOR_COLORS[index]!;
}

// --- Miembros e invitaciones ------------------------------------------------

export type BoardMemberSummary = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: BoardRole;
  /** Quién dio el acceso (`null` en la fila del dueño). */
  invitedById: string | null;
  createdAt: number;
  /** El dueño no tiene fila de miembro; se marca para que la web no lo expulse. */
  isOwner: boolean;
};

export type InvitationSummary = {
  id: string;
  boardId: string;
  email: string;
  role: BoardRole;
  expiresAt: number;
  acceptedAt: number | null;
  createdAt: number;
  expired: boolean;
  /** Enlace `/invite/:token` (solo lo devuelve quien puede gestionar el tablero). */
  token: string;
  link: string;
};

export const defaultInviteExpiryDays = 7;

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(BOARD_ROLES),
  /** Caducidad de la invitación en días (1 a 90; por defecto 7). */
  expiresInDays: z.number().int().min(1).max(90).default(defaultInviteExpiryDays),
});

export const updateMemberSchema = z.object({ role: z.enum(BOARD_ROLES) }).strict();

/** Alta directa de un miembro ya registrado (por email), sin invitación. */
export const addMemberSchema = z.object({ email: emailSchema, role: z.enum(BOARD_ROLES) });

export const membersQuerySchema = z.object({
  includeInvitations: z.enum(['0', '1', 'true', 'false']).default('true'),
});

// --- Publicación ------------------------------------------------------------

export const publishBoardSchema = z
  .object({
    /** Contraseña opcional de la vista pública (argon2 en la base). */
    password: z.string().min(4).max(100).nullish(),
    /** La vista pública navega los subtableros (solo lectura). */
    includeSubBoards: z.boolean().optional(),
    /** Genera un slug nuevo (invalida el enlace anterior). */
    rotateSlug: z.boolean().optional(),
  })
  .strict();

export const publicBoardQuerySchema = z.object({ password: z.string().min(1).max(100).optional() });

export const publicDocumentQuerySchema = z.object({
  password: z.string().min(1).max(100).optional(),
  /** Subtablero publicado que se quiere leer (si el ajuste lo permite). */
  boardId: idSchema.optional(),
});

/**
 * Subtablero navegable de la publicación: cada hijo lleva su **slug propio**
 * compuesto (`<slug del padre>~<boardId>`), resuelto en el servidor; la web
 * enlaza a `/p/<slug del hijo>`.
 */
export type PublicSubBoard = {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  color: string | null;
};

export type PublicBoardSummary = {
  slug: string;
  boardId: string;
  title: string;
  icon: string | null;
  color: string | null;
  publishedAt: number;
  includeSubBoards: boolean;
  requiresPassword: boolean;
  /** Nombre del dueño (nunca email ni ids de miembros). */
  authorName: string;
  subBoards: PublicSubBoard[];
  elementCount: number;
};

export type PublicAssetRef = {
  id: string;
  mime: string;
  type: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  originalName: string;
  /** URL firmada de vida corta (15 min): el visitante anónimo la usa tal cual. */
  url: string;
  thumbnailUrl: string | null;
};

export type PublicBoardDocument = {
  boardId: string;
  title: string;
  /** Estado Yjs en base64 (la web lo carga en modo lectura). */
  state: string;
  updatedAt: number;
  /** Mapa `assetId → URL firmada` para los elementos del documento. */
  assets: Record<string, PublicAssetRef>;
  /** Camino desde el tablero publicado hasta el que se está leyendo. */
  breadcrumbs: { id: string; title: string }[];
};

// --- Comentarios ------------------------------------------------------------

/** Tope de caracteres de un comentario (coherente con la web: 2000). */
export const MAX_COMMENT_BODY = 2000;

export const createCommentSchema = z.object({
  boardId: idSchema,
  /** Tarjeta a la que se ancla el hilo (ausente = chincheta suelta). */
  elementId: idSchema.nullish(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  body: z.string().trim().min(1).max(MAX_COMMENT_BODY),
  /** Chincheta a la que se responde. */
  parentId: idSchema.optional(),
  /** Ids de miembros mencionados (la web autocompleta y los manda explícitos). */
  mentions: z.array(idSchema).max(MENTION_LIMIT).optional(),
});

export const commentResolveSchema = z.object({ resolved: z.boolean().optional() }).strict();

export const commentsQuerySchema = z.object({
  /** `all` (por defecto) incluye los resueltos; `open` solo los abiertos. */
  filter: z.enum(['all', 'open', 'resolved']).default('all'),
  elementId: idSchema.optional(),
});

/**
 * Fila plana de comentario, tal cual la devuelve `GET /boards/:id/comments`
 * (la misma forma que el `Y.Map` del documento). La web la mapea a su
 * `CommentEntry`: `parentCommentId` → `parentId`, `x`/`y`, `resolvedAt`,
 * `resolvedBy` y `mentions` incluidos.
 */
export type CommentRow = {
  id: string;
  boardId: string;
  elementId: string | null;
  parentCommentId: string | null;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  x: number | null;
  y: number | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
  mentions: string[];
  createdAt: number;
};

// --- Actividad --------------------------------------------------------------

/**
 * Acciones que reporta el cliente (punteadas, tal cual las escribe la web en
 * `apps/web/src/lib/activityView.ts`, que es el contrato).
 */
export const ACTIVITY_ACTIONS = [
  'board.create',
  'board.rename',
  'board.publish',
  'board.unpublish',
  'element.create',
  'element.edit',
  'element.move',
  'element.delete',
  'element.restore',
  'comment.create',
  'comment.resolve',
  'comment.delete',
  'member.invite',
  'member.add',
  'member.role',
  'member.remove',
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** Tope de eventos por lote (el cliente agrupa y reenvía lo que quede afuera). */
export const MAX_ACTIVITY_BATCH = 50;

export const activityEntrySchema = z.object({
  action: z.enum(ACTIVITY_ACTIONS),
  elementId: idSchema.nullish(),
  /**
   * Tipo del elemento, **tal cual vive en el documento**. No se cierra contra
   * `ELEMENT_TYPES`: el `type` de un elemento es un string libre del documento
   * (esa lista es el vocabulario que usa la interfaz, no una restricción de
   * runtime) y los documentos reales traen tipos fuera de la lista —importados,
   * de plantillas o de versiones viejas—. Rechazarlos tiraba el lote entero; el
   * registro de actividad es para leer, no una frontera de seguridad.
   */
  elementType: z.string().trim().min(1).max(64).nullish(),
  /** Datos libres del evento (título anterior, destino de un movimiento…). */
  meta: z.record(z.unknown()).nullish(),
  /** Marca de tiempo del cliente; el servidor la acota a un rango razonable. */
  at: z.number().int().optional(),
});

/** Lote del cliente: `{ entries: [{ action, elementId, elementType, meta, at }] }`. */
export const activityBatchSchema = z.object({
  entries: z.array(activityEntrySchema).min(1).max(MAX_ACTIVITY_BATCH),
});

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Paginación por cursor: el `nextCursor` del listado anterior. */
  cursor: z.string().min(1).max(200).optional(),
  elementId: idSchema.optional(),
});

export type ActivitySummary = {
  id: string;
  boardId: string;
  userId: string;
  userName: string;
  action: ActivityAction;
  elementId: string | null;
  elementType: string | null;
  meta: Record<string, unknown>;
  createdAt: number;
};

// --- Notificaciones ---------------------------------------------------------

export const NOTIFICATION_KINDS = ['mention', 'reply', 'comment', 'board-shared', 'task-overdue'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationsQuerySchema = z.object({
  filter: z.enum(['all', 'unread']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Marcar leídas: `{ ids }` marca las indicadas y `{ all: true }` todas. El
 * cuerpo vacío `{}` también marca **todas** — es lo que manda la web cuando no
 * hay una selección (`markNotificationsRead(null)`).
 */
export const readNotificationsSchema = z.object({
  ids: z.array(idSchema).min(1).max(200).optional(),
  all: z.boolean().optional(),
});

export type NotificationSummary = {
  id: string;
  kind: NotificationKind;
  boardId: string | null;
  boardTitle: string | null;
  boardSlug: string | null;
  elementId: string | null;
  actorId: string | null;
  actorName: string | null;
  meta: Record<string, unknown>;
  readAt: number | null;
  createdAt: number;
};

export type NotificationCount = { unread: number; total: number };

// --- Presencia --------------------------------------------------------------

/** Ventana de la presencia: quien se vio en los últimos 60 s está «mirando». */
export const PRESENCE_WINDOW_MS = 60_000;

export type PresenceUser = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** Color del cursor derivado del id. */
  color: CursorColor;
  role: AccessLevel;
  /** Última señal de vida (ms). */
  lastSeenAt: number;
  /** Hay una conexión de socket abierta en este momento. */
  connected: boolean;
};

export type { BoardRole, EffectiveRole };

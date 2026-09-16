/**
 * Esquemas Zod compartidos entre API y web.
 * Toda entrada externa se valida con estos esquemas (sección 12 del plan).
 */

import { z } from 'zod';

import { BOARD_ROLES } from './boards.js';
import { COLOR_TOKENS } from './colors.js';
import { ELEMENT_TYPES } from './elements.js';

export const idSchema = z.string().min(1).max(64);

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(200);

export const registerSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(80),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  avatarUrl: z.string().url().max(2048).nullish(),
  settings: z
    .object({
      theme: z.enum(['light', 'dark', 'system']).optional(),
      language: z.enum(['es', 'en']).optional(),
      canvasBackground: z.enum(['plain', 'dots', 'grid']).optional(),
      showGuides: z.boolean().optional(),
      snapToGrid: z.boolean().optional(),
      showMinimap: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

export const createBoardSchema = z.object({
  title: z.string().trim().max(200).optional(),
  parentBoardId: idSchema.nullish(),
  icon: z.string().max(32).nullish(),
  color: z.string().max(32).nullish(),
  templateId: idSchema.nullish(),
});

export const updateBoardSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    icon: z.string().max(32).nullish(),
    color: z.string().max(32).nullish(),
    coverImageId: idSchema.nullish(),
    settings: z.record(z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nada que actualizar' });

export const moveBoardSchema = z.object({
  parentBoardId: idSchema.nullable(),
  index: z.number().int().min(0).optional(),
});

export const elementPatchSchema = z.object({
  id: idSchema,
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().positive().max(20000).optional(),
  height: z.number().positive().max(20000).optional(),
  color: z.enum(COLOR_TOKENS).optional(),
  locked: z.boolean().optional(),
});

export const elementTypeSchema = z.enum(ELEMENT_TYPES);

export const listAssetsSchema = z.object({
  boardId: idSchema.optional(),
  type: z.enum(['image', 'video', 'audio', 'file']).optional(),
});

/** Subida de un archivo (`multipart/form-data`, campo `file`). */
export const uploadAssetSchema = z.object({
  boardId: idSchema.optional(),
  /** Reutiliza el archivo si el mismo usuario ya subió uno idéntico. */
  dedupe: z.coerce.boolean().default(true),
});

/** URL firmada para subir directo al almacenamiento (sin pasar por la API). */
export const presignAssetSchema = z.object({
  name: z.string().trim().min(1).max(300),
  mime: z.string().trim().min(1).max(200),
  size: z.number().int().positive(),
});

export const assetIdParamSchema = z.object({ id: idSchema });

export const linkPreviewQuerySchema = z.object({
  url: z.string().trim().min(4).max(2048),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: elementTypeSchema.optional(),
  boardId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const taskFilterSchema = z.enum(['all', 'overdue', 'today', 'upcoming', 'done']);

export const tasksQuerySchema = z.object({
  filter: taskFilterSchema.default('all'),
  boardId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const createCommentSchema = z.object({
  boardId: idSchema,
  elementId: idSchema.optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  body: z.string().trim().min(1).max(4000),
  parentId: idSchema.optional(),
  mentions: z.array(idSchema).max(50).optional(),
});

export const updateCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(4000).optional(),
    resolved: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export const shareSchema = z.object({
  email: emailSchema.optional(),
  userId: idSchema.optional(),
  role: z.enum(BOARD_ROLES),
  /** `true` para permitir sobrescribir el rol heredado de un tablero padre. */
  override: z.boolean().optional(),
});

export const publishSchema = z.object({
  published: z.boolean(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{3,48}$/)
    .optional(),
  password: z.string().min(4).max(100).nullish(),
  includeChildren: z.boolean().optional(),
});

export const captureSchema = z.object({
  type: z.enum(['note', 'link', 'image', 'file']),
  text: z.string().max(20000).optional(),
  url: z.string().url().max(2048).optional(),
  title: z.string().max(300).optional(),
  boardId: idSchema.optional(),
  imageDataUrl: z.string().max(20_000_000).optional(),
  /** Token personal para atajos de iOS/Android o scripts. */
  token: z.string().min(10).max(200).optional(),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().max(60).optional(),
  boardId: idSchema.optional(),
});

export const importSchema = z.object({
  format: z.enum(['tablero-zip', 'markdown', 'csv', 'images']),
  targetBoardId: idSchema.optional(),
});

export const exportQuerySchema = z.object({
  format: z.enum(['pdf', 'png', 'markdown', 'text', 'zip']),
  includeAssets: z.coerce.boolean().default(true),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type ShareInput = z.infer<typeof shareSchema>;
export type CaptureInput = z.infer<typeof captureSchema>;

/** Error de validación homogéneo para las respuestas de la API. */
export type ApiError = {
  error: string;
  code?: string;
  details?: unknown;
};

export function formatZodError(error: z.ZodError): ApiError {
  return {
    error: 'Datos inválidos',
    code: 'validation_error',
    details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  };
}

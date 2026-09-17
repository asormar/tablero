/**
 * Plantillas (punto 2 de la fase 4). Contrato asumido con el API:
 *
 *   GET  /templates                → { templates: [{ id, name, description, category }] }
 *   POST /templates/:id/instantiate → { board }
 *   POST /templates/from-board/:id  → { template }
 *
 * Las 12 plantillas del sistema las siembra el API (`ownerId` nulo) con su
 * documento Yjs real; acá solo se listan, se filtran por categoría y se
 * instancian. Si el endpoint todavía no existe, la galería lo dice sin romper.
 */

import type { BoardSummary } from '@tablero/shared';

import { apiRequest } from '@/api/client';

export type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Plantilla del sistema (sin dueño). */
  system: boolean;
};

function toTemplate(raw: unknown): TemplateSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'] : null;
  if (!id) return null;
  const ownerId = record['ownerId'];
  return {
    id,
    name: typeof record['name'] === 'string' ? record['name'] : (record['title'] as string | undefined) ?? id,
    description: typeof record['description'] === 'string' ? record['description'] : '',
    category: typeof record['category'] === 'string' && record['category'].length > 0 ? record['category'] : 'otros',
    system: ownerId === null || ownerId === undefined,
  };
}

export function normalizeTemplates(payload: unknown): TemplateSummary[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>)['templates'])
      ? ((payload as Record<string, unknown>)['templates'] as unknown[])
      : [];
  return list.map(toTemplate).filter((item): item is TemplateSummary => item !== null);
}

export async function fetchTemplates(): Promise<TemplateSummary[]> {
  return normalizeTemplates(await apiRequest<unknown>('/templates'));
}

export type InstantiateInput = { parentBoardId?: string | null; title?: string };

/** Instancia una plantilla y devuelve el tablero nuevo. */
export async function instantiateTemplate(
  templateId: string,
  input: InstantiateInput = {},
): Promise<BoardSummary> {
  const payload = await apiRequest<unknown>(`/templates/${encodeURIComponent(templateId)}/instantiate`, {
    method: 'POST',
    body: { parentBoardId: input.parentBoardId ?? null, ...(input.title ? { title: input.title } : {}) },
    timeoutMs: 30_000,
  });
  const record = (payload ?? {}) as Record<string, unknown>;
  const board = (record['board'] ?? payload) as BoardSummary | undefined;
  if (!board || typeof board.id !== 'string') throw new Error('El servidor no devolvió el tablero nuevo');
  return board;
}

export type SaveTemplateInput = {
  name: string;
  description?: string;
  category?: string;
};

/** Guarda el tablero (y sus subtableros) como plantilla. */
export async function saveBoardAsTemplate(
  boardId: string,
  input: SaveTemplateInput,
): Promise<TemplateSummary> {
  const payload = await apiRequest<unknown>(`/templates/from-board/${encodeURIComponent(boardId)}`, {
    method: 'POST',
    body: input,
    timeoutMs: 60_000,
  });
  const record = (payload ?? {}) as Record<string, unknown>;
  const template = toTemplate(record['template'] ?? payload);
  if (!template) throw new Error('El servidor no devolvió la plantilla');
  return template;
}

/** Categorías presentes en una lista de plantillas, en orden alfabético. */
export function templateCategories(templates: TemplateSummary[]): string[] {
  return [...new Set(templates.map((template) => template.category))].sort((a, b) => a.localeCompare(b, 'es'));
}

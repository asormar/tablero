/**
 * Nombres de archivo de la exportación (punto 3 de la fase 4).
 *
 * Función pura para poder probarla: el título se normaliza a un nombre seguro
 * (sin acentos, sin espacios) y se le pega la extensión del formato.
 */

export type ExportFormat = 'markdown' | 'text' | 'png' | 'pdf' | 'json' | 'zip';

const EXTENSIONS: Record<ExportFormat, string> = {
  markdown: 'md',
  text: 'txt',
  png: 'png',
  pdf: 'pdf',
  json: 'json',
  zip: 'zip',
};

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** `«Guion de vídeo»` → `guion-de-video`. */
export function slugify(input: string, fallback = 'tablero'): string {
  const slug = input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length > 0 ? slug : fallback;
}

export function fileNameFor(title: string, format: ExportFormat, stamped = false): string {
  const base = slugify(title);
  const suffix = stamped ? `-${new Date().toISOString().slice(0, 10)}` : '';
  return `${base}${suffix}.${EXTENSIONS[format]}`;
}

/**
 * Importación desde la interfaz (punto 3 de la fase 4): el ZIP lo lee el cliente
 * con `fflate`, como dice el plan, y valida el JSON antes de tocar nada.
 *
 * Formatos aceptados:
 *  - ZIP de copia de seguridad: JSON del documento (`state` en base64) + archivos
 *    reales bajo `assets/`. También se acepta un JSON con `elements` (formato sin
 *    Yjs) para no depender de una sola forma.
 *  - Markdown: cada archivo entra como un documento del tablero abierto.
 *  - CSV: se convierte con `tableFromDelimited` (tabla) o `todoItemsFromDelimited`
 *    (lista de tareas) — los ayudantes compartidos de la fase 3.
 *  - Imágenes: lote al tablero abierto (las sube el mismo camino que el pegado).
 *
 * Todo lo que se pueda probar sin DOM vive acá (funciones puras).
 */

import { strFromU8, unzipSync } from 'fflate';

export type ImportKind = 'zip' | 'markdown' | 'csv' | 'image' | 'unknown';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'];

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : '';
}

export function detectImportKind(fileName: string, mime = ''): ImportKind {
  const extension = extensionOf(fileName);
  if (extension === 'zip') return 'zip';
  if (extension === 'md' || extension === 'markdown' || mime.startsWith('text/markdown')) return 'markdown';
  if (extension === 'csv' || extension === 'tsv' || mime.includes('csv')) return 'csv';
  if (IMAGE_EXTENSIONS.includes(extension) || mime.startsWith('image/')) return 'image';
  return 'unknown';
}

export type BackupAsset = { name: string; bytes: Uint8Array };

export type ParsedBackup = {
  /** Título del tablero guardado, si el JSON lo trae. */
  title: string | null;
  /** Update de Yjs (bytes) para aplicar al documento del tablero nuevo. */
  state: Uint8Array | null;
  /** Elementos en JSON (formato alternativo sin Yjs). */
  elements: unknown[];
  assets: BackupAsset[];
  /** Lo que se pudo leer y lo que no, para el aviso final. */
  notes: string[];
};

/** Base64 (o array de bytes) → bytes. Devuelve `null` si no se puede. */
export function decodeState(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (Array.isArray(raw) && raw.every((item) => typeof item === 'number')) {
    return Uint8Array.from(raw as number[]);
  }
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    if (typeof atob === 'function') {
      const binary = atob(raw);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
  } catch {
    return null;
  }
  return null;
}

function isJsonName(name: string): boolean {
  return name.toLowerCase().endsWith('.json');
}

function looksLikeBackup(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return 'state' in record || 'elements' in record || 'document' in record;
}

/**
 * Lee el ZIP de copia de seguridad. No lanza por contenido inesperado: devuelve
 * lo que encontró y lo anota en `notes` (la interfaz muestra el resumen).
 */
export function parseBackupZip(bytes: Uint8Array): ParsedBackup {
  const result: ParsedBackup = { title: null, state: null, elements: [], assets: [], notes: [] };
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => !file.name.endsWith('/') && file.originalSize < 200 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ZIP ilegible';
    result.notes.push(`No se pudo descomprimir el ZIP: ${message}`);
    return result;
  }

  const names = Object.keys(entries);
  if (names.length === 0) {
    result.notes.push('El ZIP está vacío.');
    return result;
  }

  // 1) Documento: el primer JSON que parezca copia de seguridad.
  const jsonNames = names.filter(isJsonName).sort((a, b) => a.length - b.length);
  for (const name of jsonNames) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(strFromU8(entries[name]!));
    } catch {
      result.notes.push(`${name} no es JSON válido.`);
      continue;
    }
    if (!looksLikeBackup(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    const document = (record['document'] as Record<string, unknown> | undefined) ?? record;
    result.state = decodeState(
      (document as Record<string, unknown>)['state'] ?? (document as Record<string, unknown>)['yDoc'],
    );
    if (typeof record['title'] === 'string') result.title = record['title'];
    else if (typeof (record['board'] as Record<string, unknown> | undefined)?.['title'] === 'string') {
      result.title = (record['board'] as Record<string, unknown>)['title'] as string;
    }
    const elements = (document as Record<string, unknown>)['elements'] ?? record['elements'];
    if (Array.isArray(elements)) result.elements = elements;
    break;
  }

  // 2) Archivos reales: todo lo que esté bajo assets/ (o imágenes sueltas).
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower === 'board.json' || isJsonName(lower)) continue;
    const isAsset = lower.startsWith('assets/') || lower.includes('/assets/') || IMAGE_EXTENSIONS.includes(extensionOf(lower));
    if (!isAsset) continue;
    const shortName = name.split('/').pop() ?? name;
    result.assets.push({ name: shortName, bytes: entries[name]! });
  }

  if (!result.state && result.elements.length === 0) {
    result.notes.push('El ZIP no trae ni documento Yjs ni elementos en JSON.');
  }
  if (result.assets.length > 0) {
    result.notes.push(`${result.assets.length} archivo(s) en el ZIP; se importan como tarjetas de archivo.`);
  }
  return result;
}

/**
 * Markdown → texto plano para la tarjeta de documento: se quitan las marcas
 * (encabezados, énfasis, bloques de código) y se conservan las líneas.
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/^```.*$/gm, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/^\s*(\d+)\.\s+/gm, '$1. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Título razonable para una importación: el nombre del archivo, sin extensión. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const index = base.lastIndexOf('.');
  const trimmed = index > 0 ? base.slice(0, index) : base;
  return trimmed.trim().length > 0 ? trimmed.trim() : 'Importado';
}

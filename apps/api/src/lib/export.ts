/**
 * Exportación de tableros (§7.3 del plan): Markdown, texto plano, JSON y ZIP
 * con los archivos reales.
 *
 * Decisiones:
 *   - Los tres formatos de texto se arman **en el servidor** desde el documento
 *     Yjs persistido. PNG y PDF los resuelve el navegador (no pasan por acá).
 *   - El ZIP lleva `board.json` (metadatos + proyección legible + estado Yjs en
 *     base64) y los archivos binarios tal cual, streameados desde MinIO: no se
 *     cargan enteros en memoria. La importación del ZIP la hace el cliente.
 *   - El JSON incluye el **estado Yjs** (`document.state`, base64) además de la
 *     proyección: es lo único que restaura el texto enriquecido (los
 *     `Y.XmlFragment` no viajan en un JSON plano) y lo que hace que la copia de
 *     seguridad sea fiel.
 */

import type { Asset } from '@prisma/client';
import {
  cellDisplay,
  fragmentToPlainText,
  getOrderedElements,
  getTextFragment,
  toPlainDocument,
  type CanvasElement,
  type TableData,
  type TodoItem,
} from '@tablero/shared';
import type { Readable, Writable } from 'node:stream';

import { getObjectStream } from './storage.js';
import { ZipWriter, safeZipName } from './zip.js';

export type BoardExportInfo = {
  id: string;
  title: string;
  icon: string | null;
  color: string | null;
  /** Ruta desde la raíz (`['Inicio', 'Proyecto']`). */
  path: string[];
  elementCount: number;
};

export type ExportAsset = {
  assetId: string;
  file: string;
  originalName: string;
  mime: string;
  size: number;
};

export type BoardExportData = {
  board: BoardExportInfo;
  elements: CanvasElement[];
  /** Texto plano por elemento (títulos de nota/encabezado y cuerpo). */
  texts: Map<string, string>;
  /** Estado Yjs completo (base64) para restaurar el documento sin pérdidas. */
  stateBase64: string;
  assets: ExportAsset[];
};

const TYPE_LABELS: Record<string, string> = {
  note: 'Nota',
  document: 'Documento',
  todo: 'Lista de tareas',
  image: 'Imagen',
  link: 'Enlace',
  file: 'Archivo',
  video: 'Vídeo',
  audio: 'Audio',
  board: 'Tablero',
  column: 'Columna',
  heading: 'Encabezado',
  swatch: 'Muestra de color',
  sketch: 'Dibujo',
  table: 'Tabla',
  line: 'Línea',
  map: 'Mapa',
  'comment-pin': 'Comentario',
};

/** `assetId` referenciado por un elemento (imagen, archivo, vídeo, audio o portada). */
export function assetIdsOf(element: CanvasElement): string[] {
  const ids: string[] = [];
  const candidate = element as { assetId?: unknown; coverAssetId?: unknown };
  if (typeof candidate.assetId === 'string' && candidate.assetId.length > 0) ids.push(candidate.assetId);
  if (typeof candidate.coverAssetId === 'string' && candidate.coverAssetId.length > 0) ids.push(candidate.coverAssetId);
  return ids;
}

/** Ids de asset de un conjunto de elementos, sin repetir. */
export function collectAssetIds(elements: CanvasElement[]): string[] {
  const ids = new Set<string>();
  for (const element of elements) for (const id of assetIdsOf(element)) ids.add(id);
  return [...ids];
}

/**
 * Manifiesto de archivos: nombre único dentro del ZIP (`assets/<n>-<nombre>`).
 * Dos assets con el mismo nombre original no se pisan.
 */
export function buildAssetManifest(assets: Asset[]): ExportAsset[] {
  const used = new Set<string>();
  const manifest: ExportAsset[] = [];
  assets.forEach((asset, index) => {
    const base = safeZipName(asset.originalName, `archivo-${index + 1}`);
    let file = `assets/${index + 1}-${base}`;
    if (used.has(file)) {
      file = `assets/${index + 1}-${asset.id.slice(-6)}-${base}`;
    }
    used.add(file);
    manifest.push({
      assetId: asset.id,
      file,
      originalName: asset.originalName,
      mime: asset.mime,
      size: asset.size,
    });
  });
  return manifest;
}

/** Texto plano de cada elemento (el cuerpo enriquecido sale del fragmento). */
export function textsOf(doc: import('yjs').Doc): Map<string, string> {
  const texts = new Map<string, string>();
  for (const element of getOrderedElements(doc)) {
    const rich = fragmentToPlainText(getTextFragment(doc, element.id)).trim();
    if (rich.length > 0) texts.set(element.id, rich);
    else if (element.type === 'todo') texts.set(element.id, element.title ?? '');
  }
  return texts;
}

/**
 * Metadatos de una tarea en texto (`vence 2026-01-01, prioridad high`). Lo
 * comparten el Markdown y el texto plano: si un formato pierde la fecha o la
 * prioridad, los dos exportadores se separan.
 */
function todoExtras(item: Pick<TodoItem, 'dueDate' | 'priority'>): string {
  const extras: string[] = [];
  if (item.dueDate) extras.push(`vence ${item.dueDate}`);
  if (item.priority && item.priority !== 'none') extras.push(`prioridad ${item.priority}`);
  return extras.join(', ');
}

function todoLines(items: TodoItem[] | undefined, depth = 0): string[] {
  const lines: string[] = [];
  for (const item of items ?? []) {
    const check = item.checked ? '[x]' : '[ ]';
    const extras = todoExtras(item);
    const suffix = extras.length > 0 ? ` _(${extras})_` : '';
    lines.push(`${'  '.repeat(depth)}- ${check} ${item.text}${suffix}`);
    lines.push(...todoLines(item.children, depth + 1));
  }
  return lines;
}

/** Líneas de una tarea y sus subtareas en texto plano (`[x] texto (vence …)`). */
function todoPlainLines(items: TodoItem[] | undefined, depth = 0): string[] {
  const lines: string[] = [];
  for (const item of items ?? []) {
    const check = item.checked ? '[x]' : '[ ]';
    const extras = todoExtras(item);
    const suffix = extras.length > 0 ? ` (${extras})` : '';
    lines.push(`${'    '.repeat(depth)}${check} ${item.text}${suffix}`);
    lines.push(...todoPlainLines(item.children, depth + 1));
  }
  return lines;
}

/** Markdown del tablero (§7.3: texto + enlaces a los recursos). */
export function renderMarkdown(data: BoardExportData, options: { boardLinks?: Map<string, string> } = {}): string {
  const lines: string[] = [];
  const { board } = data;
  lines.push(`# ${board.icon ? `${board.icon} ` : ''}${board.title}`, '');
  if (board.path.length > 1) lines.push(`> Ruta: ${board.path.join(' › ')}`, '');
  lines.push(`> ${board.elementCount} elementos · exportado el ${new Date().toLocaleString('es')}`, '', '---', '');

  const assetsByElement = new Map<string, ExportAsset>();
  for (const element of data.elements) {
    const assetId = assetIdsOf(element)[0];
    if (!assetId) continue;
    const asset = data.assets.find((candidate) => candidate.assetId === assetId);
    if (asset) assetsByElement.set(element.id, asset);
  }

  for (const element of data.elements) {
    const text = (data.texts.get(element.id) ?? '').trim();
    switch (element.type) {
      case 'heading': {
        lines.push(`## ${text.length > 0 ? text : 'Encabezado'}`, '');
        break;
      }
      case 'note':
      case 'document': {
        lines.push(text.length > 0 ? text : `_(${TYPE_LABELS[element.type]} vacío)_`, '');
        break;
      }
      case 'todo': {
        const todo = element as CanvasElement & { items?: Parameters<typeof todoLines>[0]; title?: string };
        if (todo.title) lines.push(`**${todo.title}**`);
        lines.push(...todoLines(todo.items), '');
        break;
      }
      case 'table': {
        const table = (element as CanvasElement & { table?: TableData }).table;
        if (!table) break;
        const header = table.columns.map((column) => column.title || ' ');
        lines.push(`| ${header.join(' | ')} |`);
        lines.push(`| ${header.map(() => '---').join(' | ')} |`);
        for (const row of table.rows) {
          const cells = table.columns.map((column) =>
            cellDisplay(row.cells[column.id] ?? { value: '' }, column.type as 'text'),
          );
          lines.push(`| ${cells.join(' | ')} |`);
        }
        lines.push('');
        break;
      }
      case 'link': {
        const link = element as CanvasElement & { url?: string; preview?: { title?: string | null } | null };
        const label = link.preview?.title ?? link.url ?? '';
        lines.push(link.url ? `[${label}](${link.url})` : `_Enlace sin URL_`, '');
        break;
      }
      case 'image':
      case 'file':
      case 'video':
      case 'audio': {
        const asset = assetsByElement.get(element.id);
        const caption = (element as CanvasElement & { caption?: string }).caption ?? '';
        if (!asset) {
          lines.push(`_(${TYPE_LABELS[element.type]} sin archivo)_`, '');
          break;
        }
        if (element.type === 'image') lines.push(`![${caption || asset.originalName}](${asset.file})`, '');
        else lines.push(`[${caption || asset.originalName}](${asset.file})`, '');
        break;
      }
      case 'board': {
        const boardElement = element as CanvasElement & { boardId?: string };
        const target = boardElement.boardId ? options.boardLinks?.get(boardElement.boardId) : undefined;
        lines.push(`### 📄 Tablero: ${text.length > 0 ? text : boardElement.boardId ?? ''}`, '');
        if (target) lines.push(`[Abrir la copia exportada](${target})`, '');
        break;
      }
      case 'column': {
        const column = element as CanvasElement & { title?: string };
        lines.push(`### Columna: ${column.title ?? ''}`, '');
        break;
      }
      case 'swatch': {
        const swatch = element as CanvasElement & { hex?: string; name?: string };
        lines.push(`Muestra de color: \`${swatch.hex ?? ''}\`${swatch.name ? ` (${swatch.name})` : ''}`, '');
        break;
      }
      case 'map': {
        const map = (element as CanvasElement & { map?: { lat: number; lng: number; zoom: number; markers: { lat: number; lng: number; label: string }[] } }).map;
        lines.push(`**Mapa** (${map?.markers.length ?? 0} marcadores)`, '');
        for (const marker of map?.markers ?? []) {
          lines.push(`- (${marker.lat.toFixed(5)}, ${marker.lng.toFixed(5)}) ${marker.label}`);
        }
        lines.push('');
        break;
      }
      case 'sketch': {
        const sketch = element as CanvasElement & { strokes?: unknown[] };
        lines.push(`_Dibujo (${sketch.strokes?.length ?? 0} trazos)_`, '');
        break;
      }
      default: {
        if (text.length > 0) lines.push(text, '');
        break;
      }
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/**
 * Texto plano del tablero. Lleva la misma información que el Markdown —en
 * particular la fecha y la prioridad de cada tarea—, sin la sintaxis: antes se
 * perdían y una copia "de respaldo" en .txt quedaba incompleta respecto del .md.
 */
export function renderPlainText(data: BoardExportData): string {
  const lines: string[] = [];
  lines.push(data.board.title.toUpperCase());
  if (data.board.path.length > 1) lines.push(data.board.path.join(' › '));
  lines.push(`${data.board.elementCount} elementos · exportado el ${new Date().toLocaleString('es')}`, '');
  for (const element of data.elements) {
    const text = (data.texts.get(element.id) ?? '').trim();
    switch (element.type) {
      case 'heading':
        lines.push(text.length > 0 ? text : 'Encabezado', '');
        break;
      case 'todo': {
        const todo = element as CanvasElement & { items?: TodoItem[]; title?: string };
        if (todo.title) lines.push(todo.title);
        lines.push(...todoPlainLines(todo.items));
        lines.push('');
        break;
      }
      case 'link': {
        const link = element as CanvasElement & { url?: string; preview?: { title?: string | null } | null };
        lines.push(link.preview?.title ?? link.url ?? '');
        lines.push('');
        break;
      }
      case 'swatch': {
        const swatch = element as CanvasElement & { hex?: string };
        lines.push(swatch.hex ?? '');
        lines.push('');
        break;
      }
      case 'table': {
        const table = (element as CanvasElement & { table?: TableData }).table;
        for (const row of table?.rows ?? []) {
          lines.push(
            (table?.columns ?? [])
              .map((column) => cellDisplay(row.cells[column.id] ?? { value: '' }, column.type as 'text'))
              .join('\t'),
          );
        }
        lines.push('');
        break;
      }
      case 'image':
      case 'file':
      case 'video':
      case 'audio': {
        const asset = data.assets.find((candidate) => candidate.assetId === assetIdsOf(element)[0]);
        lines.push(asset ? asset.originalName : `(${TYPE_LABELS[element.type]} sin archivo)`);
        lines.push('');
        break;
      }
      case 'map': {
        const map = (element as CanvasElement & { map?: { markers: { lat: number; lng: number; label: string }[] } }).map;
        lines.push(`Mapa (${map?.markers.length ?? 0} marcadores)`);
        for (const marker of map?.markers ?? []) lines.push(`  (${marker.lat}, ${marker.lng}) ${marker.label}`);
        lines.push('');
        break;
      }
      default:
        if (text.length > 0) lines.push(text, '');
        break;
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export type BoardJson = {
  format: 'tablero.board';
  version: 1;
  exportedAt: string;
  board: {
    id: string;
    title: string;
    icon: string | null;
    color: string | null;
    path: string[];
    elementCount: number;
  };
  document: {
    /** Estado Yjs en base64: restaura el documento completo (texto incluido). */
    state: string;
    elements: unknown[];
    order: string[];
    texts: Record<string, string>;
  };
  assets: ExportAsset[];
};

/** JSON de un tablero (mismo contenido conceptual que el `board.json` del ZIP). */
export function renderBoardJson(data: BoardExportData, doc: import('yjs').Doc): BoardJson {
  const plain = toPlainDocument(doc);
  return {
    format: 'tablero.board',
    version: 1,
    exportedAt: new Date().toISOString(),
    board: {
      id: data.board.id,
      title: data.board.title,
      icon: data.board.icon,
      color: data.board.color,
      path: data.board.path,
      elementCount: data.board.elementCount,
    },
    document: {
      state: data.stateBase64,
      elements: plain.elements,
      order: plain.order,
      texts: Object.fromEntries(data.texts),
    },
    assets: data.assets,
  };
}

/** Datos de exportación de un tablero, listos para renderizar en cualquier formato. */
export function boardExportData(input: {
  doc: import('yjs').Doc;
  info: Omit<BoardExportInfo, 'elementCount'>;
  stateBase64: string;
  assets: ExportAsset[];
}): BoardExportData {
  const elements = getOrderedElements(input.doc);
  return {
    board: { ...input.info, elementCount: elements.length },
    elements,
    texts: textsOf(input.doc),
    stateBase64: input.stateBase64,
    assets: input.assets,
  };
}

/** Escribe los archivos binarios (stream de MinIO) dentro del ZIP. */
async function addAssetFiles(writer: ZipWriter, manifest: ExportAsset[], assets: Asset[]): Promise<string[]> {
  const missing: string[] = [];
  for (const entry of manifest) {
    const asset = assets.find((candidate) => candidate.id === entry.assetId);
    if (!asset) {
      missing.push(entry.file);
      continue;
    }
    const object = await getObjectStream(asset.storageKey);
    if (!object) {
      missing.push(entry.file);
      continue;
    }
    // El tamaño real del objeto manda (la fila puede haber quedado desfasada
    // respecto del archivo): el método *store* exige declararlo exacto.
    const size = object.size > 0 ? object.size : asset.size;
    await writer.addStream(entry.file, size, object.body as Readable);
  }
  return missing;
}

export type ZipBoardEntry = {
  data: BoardExportData;
  doc: import('yjs').Doc;
  file: string;
  /** Metadatos extra para `account.json` (plantilla, bandeja, papelera). */
  meta?: { isTemplate?: boolean; isUnsorted?: boolean };
};

/**
 * ZIP de un tablero: `board.json` + `board.md` + `board.txt` de la raíz y de
 * cada subtablero incluido, más los archivos reales. El llamador pasa los
 * assets ya filtrados por dueño.
 */
export async function writeBoardZip(
  out: Writable,
  root: ZipBoardEntry,
  children: ZipBoardEntry[],
  assets: Asset[],
  options: { includeAssets?: boolean } = {},
): Promise<{ missing: string[] }> {
  const writer = new ZipWriter(out);
  const boardLinks = new Map<string, string>();
  for (const entry of [root, ...children]) boardLinks.set(entry.data.board.id, entry.file.replace(/board\.json$/, 'board.md'));

  const allAssets = new Map<string, ExportAsset>();
  for (const entry of [root, ...children]) for (const asset of entry.data.assets) allAssets.set(asset.assetId, asset);

  await writer.addBuffer('board.json', Buffer.from(JSON.stringify(renderBoardJson(root.data, root.doc), null, 2), 'utf8'));
  await writer.addBuffer(
    'board.md',
    Buffer.from(renderMarkdown(root.data, { boardLinks }), 'utf8'),
  );
  await writer.addBuffer('board.txt', Buffer.from(renderPlainText(root.data), 'utf8'));
  for (const entry of children) {
    await writer.addBuffer(
      `${entry.file}`,
      Buffer.from(JSON.stringify(renderBoardJson(entry.data, entry.doc), null, 2), 'utf8'),
    );
    await writer.addBuffer(
      `${entry.file.replace(/board\.json$/, 'board.md')}`,
      Buffer.from(renderMarkdown(entry.data, { boardLinks }), 'utf8'),
    );
    await writer.addBuffer(
      `${entry.file.replace(/board\.json$/, 'board.txt')}`,
      Buffer.from(renderPlainText(entry.data), 'utf8'),
    );
  }

  let missing: string[] = [];
  if (options.includeAssets !== false) {
    missing = await addAssetFiles(writer, [...allAssets.values()], assets);
  }
  await writer.finalize();
  return { missing };
}

export type AccountZipInput = {
  user: { id: string; email: string; name: string };
  boards: ZipBoardEntry[];
  assets: Asset[];
  includeAssets?: boolean;
};

/** ZIP de la cuenta entera: `account.json` + un `board.json`/`.md`/`.txt` por tablero. */
export async function writeAccountZip(out: Writable, input: AccountZipInput): Promise<{ missing: string[] }> {
  const writer = new ZipWriter(out);
  const boardLinks = new Map<string, string>();
  for (const entry of input.boards) boardLinks.set(entry.data.board.id, entry.file.replace(/board\.json$/, 'board.md'));

  const account = {
    format: 'tablero.account' as const,
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    user: input.user,
    boards: input.boards.map((entry) => ({
      id: entry.data.board.id,
      title: entry.data.board.title,
      path: entry.data.board.path,
      elementCount: entry.data.board.elementCount,
      file: entry.file,
      ...(entry.meta?.isTemplate ? { isTemplate: true } : {}),
      ...(entry.meta?.isUnsorted ? { isUnsorted: true } : {}),
    })),
  };
  await writer.addBuffer('account.json', Buffer.from(JSON.stringify(account, null, 2), 'utf8'));

  for (const entry of input.boards) {
    await writer.addBuffer(entry.file, Buffer.from(JSON.stringify(renderBoardJson(entry.data, entry.doc), null, 2), 'utf8'));
    await writer.addBuffer(
      entry.file.replace(/board\.json$/, 'board.md'),
      Buffer.from(renderMarkdown(entry.data, { boardLinks }), 'utf8'),
    );
    await writer.addBuffer(entry.file.replace(/board\.json$/, 'board.txt'), Buffer.from(renderPlainText(entry.data), 'utf8'));
  }

  const allAssets = new Map<string, ExportAsset>();
  for (const entry of input.boards) for (const asset of entry.data.assets) allAssets.set(asset.assetId, asset);
  let missing: string[] = [];
  if (input.includeAssets !== false) {
    missing = await addAssetFiles(writer, [...allAssets.values()], input.assets);
  }
  await writer.finalize();
  return { missing };
}

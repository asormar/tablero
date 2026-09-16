/**
 * Modelo de elementos del lienzo.
 *
 * El elemento vive en un `Y.Map` plano (claves primitivas) y los datos
 * enriquecidos se guardan como JSON serializado o como `Y.XmlFragment`
 * (el campo `text` de notas, documentos, encabezados y títulos de tareas).
 */

import type { ColorToken } from './colors.js';

export const ELEMENT_TYPES = [
  'note',
  'document',
  'todo',
  'image',
  'link',
  'file',
  'video',
  'audio',
  'board',
  'column',
  'heading',
  'swatch',
  'sketch',
  'table',
  'line',
  'map',
  'comment-pin',
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];

/** Tipos que la barra lateral puede crear arrastrando (fase 1 marcados en `defaultSize`). */
export const CREATABLE_TYPES: ElementType[] = [
  'note',
  'link',
  'todo',
  'line',
  'board',
  'column',
  'comment-pin',
  'table',
  'file',
  'sketch',
  'swatch',
  'heading',
  'document',
  'audio',
  'map',
];

export type HeadingSize = 'S' | 'M' | 'L' | 'XL';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'doing' | 'done';

export type ImageCrop = { x: number; y: number; width: number; height: number };

export type TodoItem = {
  id: string;
  text: string;
  checked: boolean;
  /** Solo un nivel de anidación, como en Milanote. */
  children: TodoItem[];
  dueDate?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority;
  completedAt?: number | null;
};

export type TableCell = {
  value: string;
  color?: ColorToken;
  align?: 'left' | 'center' | 'right';
};

export type TableColumn = {
  id: string;
  title: string;
  width: number;
  type: 'text' | 'number' | 'checkbox' | 'date';
};

export type TableData = {
  columns: TableColumn[];
  rows: { id: string; cells: Record<string, TableCell> }[];
  hasHeader: boolean;
};

export type SketchStroke = {
  id: string;
  tool: 'pen' | 'marker' | 'highlighter' | 'eraser' | 'line' | 'rect' | 'ellipse';
  color: string;
  size: number;
  /** Puntos aplanados [x0, y0, presión0, x1, y1, presión1, …] en coordenadas de la tarjeta. */
  points: number[];
};

export type MapMarker = { id: string; lat: number; lng: number; label: string };
export type MapData = { lat: number; lng: number; zoom: number; markers: MapMarker[] };

export type LinkPreviewData = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  siteName: string | null;
  embedType: LinkEmbedType;
  embedUrl?: string | null;
  fetchedAt: number;
};

export const LINK_EMBED_TYPES = [
  'youtube',
  'vimeo',
  'spotify',
  'soundcloud',
  'twitter',
  'maps',
  'figma',
  'loom',
  'codepen',
  'generic',
] as const;

export type LinkEmbedType = (typeof LINK_EMBED_TYPES)[number];

/** Campos comunes a todo elemento del lienzo. */
export type BaseElement = {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  /** La altura suele ser automática; se persiste cuando el usuario la fija. */
  height?: number;
  /** Id de la columna contenedora, si la hay. */
  parentId?: string;
  color?: ColorToken;
  /** Color literal para elementos que no usan tokens (muestras, dibujos). */
  hex?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  commentsCount?: number;
  /** Posición bloqueada: no se puede arrastrar. */
  locked?: boolean;
  /** Papelera: marca de borrado (30 días antes de poder purgarse). */
  deletedAt?: number | null;
  deletedBy?: string | null;
}

export type NoteElement = BaseElement & { type: 'note' | 'document' | 'heading' | 'todo' };
export type HeadingExtras = { size?: HeadingSize };
export type BoardCardElement = BaseElement & {
  type: 'board';
  boardId: string;
  icon?: string;
  coverAssetId?: string;
  showPreview?: boolean;
};
export type ColumnElement = BaseElement & {
  type: 'column';
  title: string;
  collapsed?: boolean;
};
export type AssetElement = BaseElement & {
  type: 'image' | 'file' | 'video' | 'audio';
  assetId: string;
  caption?: string;
  crop?: ImageCrop;
  frameless?: boolean;
  /** Anchura del recorte proporcional usada para calcular la altura. */
  naturalWidth?: number;
  naturalHeight?: number;
};
export type LinkElement = BaseElement & { type: 'link'; url: string; preview?: LinkPreviewData; displaySize?: 'compact' | 'medium' | 'large' };
export type SwatchElement = BaseElement & { type: 'swatch'; hex: string; name?: string };
export type SketchElement = BaseElement & { type: 'sketch'; strokes: SketchStroke[]; background?: 'transparent' | 'white' };
export type TableElement = BaseElement & { type: 'table'; table: TableData };
export type MapElement = BaseElement & { type: 'map'; map: MapData };
export type CommentPinElement = BaseElement & { type: 'comment-pin'; resolved?: boolean };
export type TodoExtras = { items?: TodoItem[]; hideCompleted?: boolean; title?: string };
export type LineElement = BaseElement & { type: 'line'; points: number[] };

export type CanvasElement =
  | (NoteElement & HeadingExtras & TodoExtras)
  | BoardCardElement
  | ColumnElement
  | AssetElement
  | LinkElement
  | SwatchElement
  | SketchElement
  | TableElement
  | MapElement
  | CommentPinElement;

/** Anchos y alturas por defecto (sección 11 del plan). */
export const DEFAULT_SIZES: Record<ElementType, { width: number; height?: number }> = {
  note: { width: 240 },
  document: { width: 260, height: 160 },
  todo: { width: 260 },
  image: { width: 320, height: 213 },
  link: { width: 300, height: 96 },
  file: { width: 220, height: 72 },
  video: { width: 320, height: 200 },
  audio: { width: 280, height: 92 },
  board: { width: 140, height: 120 },
  column: { width: 280, height: 200 },
  heading: { width: 320, height: 44 },
  swatch: { width: 140, height: 112 },
  sketch: { width: 320, height: 220 },
  table: { width: 420, height: 200 },
  line: { width: 1, height: 1 },
  map: { width: 360, height: 260 },
  'comment-pin': { width: 28, height: 28 },
};

export const MIN_ELEMENT_WIDTH = 80;
export const NODE_DEFAULT_WIDTH: Partial<Record<ElementType, number>> = {
  note: 240,
  heading: 320,
};

/** Tipos cuyo ancho se puede cambiar desde los tiradores laterales. */
export const RESIZABLE_WIDTH: ElementType[] = [
  'note',
  'document',
  'todo',
  'image',
  'link',
  'file',
  'video',
  'audio',
  'board',
  'column',
  'heading',
  'swatch',
  'sketch',
  'table',
  'map',
];

/** Tipos que admiten redimensión proporcional desde la esquina. */
export const ASPECT_RESIZABLE: ElementType[] = ['image', 'sketch', 'video', 'map'];

/** Tipos que contienen otros elementos. */
export const CONTAINER_TYPES: ElementType[] = ['column'];

export function isContainerType(type: ElementType): boolean {
  return CONTAINER_TYPES.includes(type);
}

export function isRichTextType(type: ElementType): boolean {
  return type === 'note' || type === 'document' || type === 'heading';
}

export const ELEMENT_LABELS: Record<ElementType, string> = {
  note: 'Nota',
  document: 'Documento',
  todo: 'Tareas',
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

export function elementLabel(type: ElementType): string {
  return ELEMENT_LABELS[type] ?? 'Elemento';
}

/** Texto plano representativo de un elemento (búsqueda, exportación, tooltips). */
export function elementPlainText(element: CanvasElement | undefined): string {
  if (!element) return '';
  switch (element.type) {
    case 'note':
    case 'document':
    case 'heading':
      return '';
    case 'todo':
      return element.title ?? '';
    case 'board':
      return element.icon ? `${element.icon}` : '';
    case 'column':
      return element.title ?? '';
    case 'image':
    case 'video':
    case 'audio':
      return element.caption ?? '';
    case 'file':
      return element.caption ?? '';
    case 'link':
      return element.preview?.title ?? element.url;
    case 'swatch':
      return element.name ?? element.hex;
    default:
      return '';
  }
}

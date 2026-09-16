/**
 * Archivos soltados en el lienzo: clasificación y colocación en bloque.
 *
 * Todo lo de este módulo es puro (no toca el DOM ni la API) para poder probarlo
 * con vitest en entorno de nodo: la capa que sí toca el navegador es
 * `canvas/uploadController.ts`.
 */

import {
  type AssetKind,
  type Point,
  type Rect,
  type Size,
  DEFAULT_SIZES,
  assetKindFromMime,
  extensionForMime,
  isPdfMime,
} from '@tablero/shared';

/** Lo mínimo que se necesita de un `File` (permite objetos de prueba). */
export type DroppableFile = {
  name: string;
  type: string;
  size: number;
};

export type ClassifiedFile = {
  /** Posición en el lote original (el orden de la cascada). */
  index: number;
  name: string;
  mime: string;
  size: number;
  kind: AssetKind;
  extension: string;
  isPdf: boolean;
  /** Nombre del elemento provisional que se crea al soltar. */
  title: string;
};

/**
 * Clasifica los archivos soltados (imagen → imagen, vídeo → vídeo, audio →
 * audio, el resto → archivo) conservando el orden de llegada.
 */
export function classifyDroppedFiles(files: readonly DroppableFile[]): ClassifiedFile[] {
  return files.map((file, index) => {
    const mime = (file.type || '').toLowerCase();
    const kind = assetKindFromMime(mime);
    return {
      index,
      name: file.name || `archivo-${index + 1}`,
      mime,
      size: Number.isFinite(file.size) ? file.size : 0,
      kind,
      extension: extensionForMime(mime, file.name),
      isPdf: isPdfMime(mime),
      title: file.name || `archivo-${index + 1}`,
    };
  });
}

/** Columna de la rejilla del lote: crece con la raíz del número de archivos. */
export function batchColumns(count: number, maxColumns = 5): number {
  if (count <= 1) return 1;
  return Math.max(1, Math.min(maxColumns, Math.ceil(Math.sqrt(count))));
}

export type BatchPlacementInput = {
  /** Tamaños ya conocidos (uno por archivo, en orden). */
  sizes: readonly Size[];
  /** Esquina superior izquierda pedida para la primera tarjeta. */
  origin: Point;
  /** Separación entre tarjetas. */
  gap?: number;
  maxColumns?: number;
  /** Rectángulos ya ocupados: solo se usan para el punto de partida. */
  existing?: readonly Rect[];
  /** Separación a la que se aparta el lote de lo que ya hay. */
  avoidGap?: number;
};

export type BatchPlacement = {
  positions: Point[];
  columns: number;
  rows: number;
  /** Ancho máximo ocupado por la rejilla (mundo). */
  width: number;
  /** Alto total ocupado por la rejilla (mundo). */
  height: number;
};

function overlapsAny(x: number, y: number, size: Size, rects: readonly Rect[], gap: number): boolean {
  for (const rect of rects) {
    const separated =
      x + size.width + gap <= rect.x ||
      rect.x + rect.width + gap <= x ||
      y + size.height + gap <= rect.y ||
      rect.y + rect.height + gap <= y;
    if (!separated) return true;
  }
  return false;
}

/**
 * Rejilla en cascada para un lote de archivos: se coloca fila a fila usando la
 * altura real de cada tarjeta (las imágenes ya se han medido antes), así que dos
 * tarjetas del lote nunca se solapan aunque tengan aspectos distintos.
 *
 * Si el bloque choca con lo que ya hay en el tablero, se aparta hacia abajo
 * hasta encontrar sitio libre: el usuario ve las tarjetas donde las soltó.
 */
export function batchPlacement(input: BatchPlacementInput): BatchPlacement {
  const gap = input.gap ?? 16;
  const avoidGap = input.avoidGap ?? gap;
  const count = input.sizes.length;
  if (count === 0) return { positions: [], columns: 0, rows: 0, width: 0, height: 0 };

  const columns = batchColumns(count, input.maxColumns ?? 5);
  const rows = Math.ceil(count / columns);

  // Ancho de cada columna y alto de cada fila según las medidas reales.
  const columnWidths = new Array<number>(columns).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);
  input.sizes.forEach((size, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, size.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, size.height);
  });

  const offsetsX: number[] = [];
  let cursorX = 0;
  for (let column = 0; column < columns; column += 1) {
    offsetsX.push(cursorX);
    cursorX += (columnWidths[column] ?? 0) + gap;
  }
  const offsetsY: number[] = [];
  let cursorY = 0;
  for (let row = 0; row < rows; row += 1) {
    offsetsY.push(cursorY);
    cursorY += (rowHeights[row] ?? 0) + gap;
  }
  const totalWidth = Math.max(1, cursorX - gap);
  const totalHeight = Math.max(1, cursorY - gap);

  const occupied = input.existing ?? [];
  let startX = Math.round(input.origin.x);
  let startY = Math.round(input.origin.y);
  // El bloque completo se aparta en vertical mientras choque con lo que ya hay.
  let guard = 0;
  while (
    guard < 200 &&
    overlapsAny(startX, startY, { width: totalWidth, height: totalHeight }, occupied, avoidGap)
  ) {
    startY += Math.round(totalHeight + avoidGap);
    guard += 1;
  }

  const positions: Point[] = input.sizes.map((_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return { x: startX + (offsetsX[column] ?? 0), y: startY + (offsetsY[row] ?? 0) };
  });

  return { positions, columns, rows, width: totalWidth, height: totalHeight };
}

/** Alto de reserva de un tipo mientras no se conoce el tamaño real del archivo. */
export function fallbackSizeFor(kind: AssetKind): Size {
  const size = DEFAULT_SIZES[kind === 'image' ? 'image' : kind];
  return { width: size.width, height: size.height ?? 200 };
}

/**
 * Alto que añade el marco de la tarjeta alrededor del medio: relleno (8+8) más
 * el pie de foto (una línea) o la barra del vídeo. Se mide en el navegador y se
 * usa para colocar el lote: sin él, dos filas de la cascada se pisarían 12 px.
 */
export const CARD_CHROME: Record<AssetKind, number> = {
  image: 40,
  video: 60,
  audio: 74,
  file: 0,
};

/** Relleno lateral de la tarjeta (el medio se dibuja dentro). */
export const CARD_PADDING_X = 8;

/** Tamaño con el que nace la tarjeta de un archivo (sin pasarse del ancho base). */
export function cardSizeFor(kind: AssetKind, natural?: Size | null): Size {
  const base = fallbackSizeFor(kind);
  const chrome = CARD_CHROME[kind];
  if (!natural || natural.width <= 0 || natural.height <= 0) {
    return { width: base.width, height: base.height + chrome };
  }
  const width = Math.max(80, Math.min(base.width, Math.round(natural.width)));
  if (kind === 'audio') return { width, height: chrome };
  // El medio ocupa el ancho interior (la tarjeta tiene relleno a los lados).
  const inner = Math.max(24, width - CARD_PADDING_X * 2);
  return { width, height: Math.round((inner * natural.height) / natural.width) + chrome };
}

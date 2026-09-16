/**
 * Navegación de la tabla: pura y testeable.
 *
 * La rejilla se pinta como HTML (`<table>`), así que la posición de cada celda se
 * deduce de índices, no de medidas. Aquí están las funciones que traducen teclas
 * e índices, para que el componente solo se ocupe del DOM.
 */

export type CellPos = { row: number; col: number };

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

/** Siguiente celda según la tecla (null si no hay vecina en esa dirección). */
export function nextCell(
  rows: number,
  cols: number,
  pos: CellPos,
  key: string,
  options: { shift?: boolean; wrap?: boolean } = {},
): CellPos | null {
  const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, value));
  switch (key) {
    case 'Tab': {
      const step = options.shift ? -1 : 1;
      let index = pos.row * cols + pos.col + step;
      if (options.wrap) {
        const total = rows * cols;
        if (total <= 0) return null;
        index = ((index % total) + total) % total;
      }
      if (index < 0 || index >= rows * cols) return null;
      return { row: Math.floor(index / cols), col: index % cols };
    }
    case 'ArrowUp':
      return pos.row - 1 >= 0 ? { row: pos.row - 1, col: pos.col } : null;
    case 'ArrowDown':
      return pos.row + 1 < rows ? { row: pos.row + 1, col: pos.col } : null;
    case 'ArrowLeft':
      return pos.col - 1 >= 0 ? { row: pos.row, col: pos.col - 1 } : null;
    case 'ArrowRight':
      return pos.col + 1 < cols ? { row: pos.row, col: pos.col + 1 } : null;
    case 'Enter':
      return pos.row + 1 < rows ? { row: clamp(pos.row + 1, Math.max(0, rows - 1)), col: pos.col } : null;
    default:
      return null;
  }
}

/** ¿La tecla se puede manejar con la navegación sin pelear con el cursor? */
export function isNavigationKey(key: string, atStart: boolean, atEnd: boolean): boolean {
  if (key === 'Tab' || key === 'Enter' || key === 'ArrowUp' || key === 'ArrowDown') return true;
  if (key === 'ArrowLeft') return atStart;
  if (key === 'ArrowRight') return atEnd;
  return false;
}

export type Span = { start: number; size: number };

/** Índice del tramo que cae en la coordenada dada (para reordenar arrastrando). */
export function indexAtCoordinate(spans: readonly Span[], coordinate: number): number {
  let index = 0;
  for (const span of spans) {
    if (coordinate > span.start + span.size / 2) index += 1;
  }
  return index;
}

/** Suma mostrada al pie de una columna numérica. */
export function sumLabel(value: number | null): string {
  if (value === null) return '';
  return `Σ ${new Intl.NumberFormat('es', { maximumFractionDigits: 3 }).format(value)}`;
}

/** Tamaño en píxeles de la columna (limitado a un mínimo legible). */
export function columnWidth(width: number, min = 60): number {
  return Math.max(min, Math.round(width));
}

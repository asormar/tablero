/**
 * Tablas: operaciones de dominio.
 *
 * El modelo vive en `elements.ts` (`TableData`): columnas con título, ancho y
 * tipo; filas con celdas por id de columna. Acá están las operaciones puras
 * (agregar, mover, borrar, escribir celdas, cambiar el tipo, sumar) y el
 * pegrado desde Excel/Google Sheets, que llega como texto con tabulaciones o
 * comas y también sirve para la importación de CSV.
 */

import { createElementId } from './ids.js';
import type { TableCell, TableColumn, TableData, TodoItem } from './elements.js';
import { createTodoItem } from './todos.js';

export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 900;
export const DEFAULT_COLUMN_WIDTH = 140;

export type TableColumnType = TableColumn['type'];

export function createCell(value = '', init: Partial<TableCell> = {}): TableCell {
  return { value, ...(init.color ? { color: init.color } : {}), ...(init.align ? { align: init.align } : {}) };
}

export function createColumn(init: Partial<TableColumn> = {}): TableColumn {
  return {
    id: init.id ?? createElementId(),
    title: init.title ?? '',
    width: init.width ?? DEFAULT_COLUMN_WIDTH,
    type: init.type ?? 'text',
  };
}

export function createRow(columns: TableColumn[], cells: Record<string, TableCell> = {}): { id: string; cells: Record<string, TableCell> } {
  const filled: Record<string, TableCell> = {};
  for (const column of columns) filled[column.id] = cells[column.id] ?? createCell('');
  return { id: createElementId(), cells: filled };
}

/** Tabla vacía, con cabecera por defecto. */
export function createTableData(rowCount = 3, columnCount = 3, init: Partial<TableData> = {}): TableData {
  const columns = Array.from({ length: Math.max(1, columnCount) }, (_, index) =>
    createColumn({ title: index === 0 ? 'Columna 1' : `Columna ${index + 1}` }),
  );
  const rows = Array.from({ length: Math.max(1, rowCount) }, () => createRow(columns));
  return { columns, rows, hasHeader: init.hasHeader ?? true };
}

function table(columns: TableColumn[], rows: TableData['rows'], hasHeader: boolean): TableData {
  return { columns, rows, hasHeader };
}

export function columnIndex(data: TableData, columnId: string): number {
  return data.columns.findIndex((column) => column.id === columnId);
}

export function rowIndex(data: TableData, rowId: string): number {
  return data.rows.findIndex((row) => row.id === rowId);
}

export function getCell(data: TableData, rowId: string, columnId: string): TableCell {
  return data.rows[rowIndex(data, rowId)]?.cells[columnId] ?? createCell('');
}

/** Inserta una fila; sin `at`, al final. */
export function addRow(data: TableData, at?: number): TableData {
  const row = createRow(data.columns);
  const index = at === undefined ? data.rows.length : Math.max(0, Math.min(at, data.rows.length));
  return table(data.columns, [...data.rows.slice(0, index), row, ...data.rows.slice(index)], data.hasHeader);
}

/** Borra una fila. La tabla siempre conserva al menos una. */
export function removeRow(data: TableData, rowId: string): TableData {
  const index = rowIndex(data, rowId);
  if (index < 0 || data.rows.length <= 1) return data;
  return table(data.columns, [...data.rows.slice(0, index), ...data.rows.slice(index + 1)], data.hasHeader);
}

export function removeRows(data: TableData, rowIds: string[]): TableData {
  const keep = data.rows.filter((row) => !rowIds.includes(row.id));
  return keep.length === 0 ? data : table(data.columns, keep, data.hasHeader);
}

export function moveRow(data: TableData, rowId: string, targetIndex: number): TableData {
  const index = rowIndex(data, rowId);
  if (index < 0) return data;
  const rows = [...data.rows];
  const [row] = rows.splice(index, 1);
  rows.splice(Math.max(0, Math.min(targetIndex, rows.length)), 0, row!);
  return table(data.columns, rows, data.hasHeader);
}

export function addColumn(data: TableData, at?: number, init: Partial<TableColumn> = {}): TableData {
  const column = createColumn({ title: `Columna ${data.columns.length + 1}`, ...init });
  const index = at === undefined ? data.columns.length : Math.max(0, Math.min(at, data.columns.length));
  const columns = [...data.columns.slice(0, index), column, ...data.columns.slice(index)];
  const rows = data.rows.map((row) => ({ id: row.id, cells: { ...row.cells, [column.id]: createCell('') } }));
  return table(columns, rows, data.hasHeader);
}

/** Borra una columna. La tabla siempre conserva al menos una. */
export function removeColumn(data: TableData, columnId: string): TableData {
  if (data.columns.length <= 1) return data;
  const index = columnIndex(data, columnId);
  if (index < 0) return data;
  const columns = data.columns.filter((column) => column.id !== columnId);
  const rows = data.rows.map((row) => {
    const cells = { ...row.cells };
    delete cells[columnId];
    return { id: row.id, cells };
  });
  return table(columns, rows, data.hasHeader);
}

export function moveColumn(data: TableData, columnId: string, targetIndex: number): TableData {
  const index = columnIndex(data, columnId);
  if (index < 0) return data;
  const columns = [...data.columns];
  const [column] = columns.splice(index, 1);
  columns.splice(Math.max(0, Math.min(targetIndex, columns.length)), 0, column!);
  return table(columns, data.rows, data.hasHeader);
}

export function setCell(data: TableData, rowId: string, columnId: string, patch: Partial<TableCell>): TableData {
  const index = rowIndex(data, rowId);
  if (index < 0 || columnIndex(data, columnId) < 0) return data;
  const rows = data.rows.map((row, i) =>
    i === index ? { id: row.id, cells: { ...row.cells, [columnId]: { ...(row.cells[columnId] ?? createCell('')), ...patch } } } : row,
  );
  return table(data.columns, rows, data.hasHeader);
}

export function setCellValue(data: TableData, rowId: string, columnId: string, value: string): TableData {
  return setCell(data, rowId, columnId, { value });
}

/** Casilla: alterna el valor con las formas que escribe la gente. */
export function toggleCell(data: TableData, rowId: string, columnId: string): TableData {
  const cell = getCell(data, rowId, columnId);
  return setCellValue(data, rowId, columnId, isTruthy(cell.value) ? '' : 'true');
}

export function resizeColumn(data: TableData, columnId: string, width: number): TableData {
  const index = columnIndex(data, columnId);
  if (index < 0) return data;
  const clamped = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
  const columns = data.columns.map((column, i) => (i === index ? { ...column, width: clamped } : column));
  return table(columns, data.rows, data.hasHeader);
}

/** Cambia el tipo de columna normalizando lo que ya estaba escrito. */
export function setColumnType(data: TableData, columnId: string, type: TableColumnType): TableData {
  const index = columnIndex(data, columnId);
  if (index < 0) return data;
  const columns = data.columns.map((column, i) => (i === index ? { ...column, type } : column));
  const rows = data.rows.map((row) => {
    const cell = row.cells[columnId] ?? createCell('');
    return { id: row.id, cells: { ...row.cells, [columnId]: { ...cell, value: normalizeCellValue(type, cell.value) } } };
  });
  return table(columns, rows, data.hasHeader);
}

export function setColumnTitle(data: TableData, columnId: string, title: string): TableData {
  const index = columnIndex(data, columnId);
  if (index < 0) return data;
  const columns = data.columns.map((column, i) => (i === index ? { ...column, title } : column));
  return table(columns, data.rows, data.hasHeader);
}

const TRUTHY = ['true', 'si', 'sí', 'yes', 'x', '✓', '1', 'verdadero'];

export function isTruthy(value: string): boolean {
  return TRUTHY.includes(value.trim().toLowerCase());
}

/**
 * Número escrito a mano, con coma o punto decimal y separadores de miles.
 * `1.234,5` y `1,234.5` dan lo mismo; el último separador manda.
 */
export function parseNumberLoose(raw: string): number | null {
  const value = raw.trim().replace(/\s/g, '');
  if (value.length === 0) return null;
  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  let normalized = value;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? value.replace(/\./g, '').replace(/,/g, '.') : value.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = value.replace(/,/g, '.');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Deja el valor en la forma canónica de su tipo. */
export function normalizeCellValue(type: TableColumnType, value: string): string {
  const raw = value.trim();
  if (raw.length === 0) return '';
  switch (type) {
    case 'number': {
      const parsed = parseNumberLoose(raw);
      return parsed === null ? '' : String(parsed);
    }
    case 'checkbox':
      return isTruthy(raw) ? 'true' : '';
    case 'date':
      return toIsoDate(raw) ?? '';
    default:
      return value;
  }
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Fecha escrita a mano (`2026-12-25`, `25/12/2026`, `25-12`) a ISO corto. */
export function toIsoDate(input: string): string | null {
  const value = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isValidIso(value) ? value : null;
  const parts = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(value);
  if (!parts) return null;
  const day = Number(parts[1]);
  const month = Number(parts[2]);
  let year = parts[3] ? Number(parts[3]) : new Date().getFullYear();
  if (parts[3] && parts[3].length === 2) year += 2000;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidIso(iso) ? iso : null;
}

function isValidIso(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
}

/** Cómo se ve la celda en pantalla. */
export function cellDisplay(cell: TableCell, type: TableColumnType): string {
  if (type === 'checkbox') return isTruthy(cell.value) ? '✓' : '';
  if (type === 'date') {
    const iso = toIsoDate(cell.value);
    if (!iso) return cell.value;
    const [, month, day] = iso.split('-');
    return `${Number(day)} ${MONTHS_ES[Number(month) - 1] ?? ''}`.trim();
  }
  return cell.value;
}

/** Suma al pie de una columna numérica. */
export function columnSum(data: TableData, columnId: string): number | null {
  const index = columnIndex(data, columnId);
  if (index < 0 || data.columns[index]!.type !== 'number') return null;
  let sum = 0;
  let seen = false;
  for (const row of data.rows) {
    const parsed = parseNumberLoose(row.cells[columnId]?.value ?? '');
    if (parsed !== null) {
      sum += parsed;
      seen = true;
    }
  }
  return seen ? sum : null;
}

export type ColumnStats = { count: number; checked: number; sum: number | null; min: number | null; max: number | null };

export function columnStats(data: TableData, columnId: string): ColumnStats {
  const index = columnIndex(data, columnId);
  const type = index < 0 ? 'text' : data.columns[index]!.type;
  let count = 0;
  let checked = 0;
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;
  for (const row of data.rows) {
    const value = (row.cells[columnId]?.value ?? '').trim();
    if (value.length === 0) continue;
    count += 1;
    if (type === 'checkbox') {
      if (isTruthy(value)) checked += 1;
    } else if (type === 'number') {
      const parsed = parseNumberLoose(value);
      if (parsed !== null) {
        sum += parsed;
        min = min === null ? parsed : Math.min(min, parsed);
        max = max === null ? parsed : Math.max(max, parsed);
      }
    }
  }
  return {
    count,
    checked,
    sum: type === 'number' && count > 0 ? sum : null,
    min,
    max,
  };
}

/**
 * Detecta el separador de un pegado. La tabulación gana siempre (es lo que
 * copian Excel y Google Sheets), y si no hay se elige entre coma y punto y coma
 * mirando todo el texto, no solo la primera línea.
 */
function detectSeparator(text: string): string {
  const sample = text.split('\n').slice(0, 20).join('\n');
  if (sample.includes('\t')) return '\t';
  const commas = (sample.match(/,/g) ?? []).length;
  const semicolons = (sample.match(/;/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

/**
 * Parte texto pegado de una hoja de cálculo. Detecta el separador (tabulación,
 * coma o punto y coma), respeta las comillas y descarta la última línea vacía.
 */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (clean.length === 0) return [];
  const separator = detectSeparator(clean);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i]!;
    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
      continue;
    }
    if (char === separator) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

/** Construye la tabla a partir de lo pegado (Excel, Sheets, CSV). */
export function tableFromDelimited(text: string, hasHeader = true): TableData {
  const parsed = parseDelimited(text);
  if (parsed.length === 0) return createTableData(1, 1);
  const width = Math.max(...parsed.map((row) => row.length));
  const headers = hasHeader ? parsed[0]! : [];
  const body = hasHeader ? parsed.slice(1) : parsed;
  const columns = Array.from({ length: width }, (_, index) =>
    createColumn({ title: headers[index]?.trim() || `Columna ${index + 1}`, type: detectColumnType(body.map((row) => row[index] ?? '')) }),
  );
  const rows = (body.length > 0 ? body : [Array.from({ length: width }, () => '')]).map((source) => {
    const cells: Record<string, TableCell> = {};
    columns.forEach((column, index) => {
      const raw = source[index] ?? '';
      cells[column.id] = createCell(normalizeCellValue(column.type, raw));
    });
    return { id: createElementId(), cells };
  });
  return table(columns, rows, hasHeader);
}

/** Adivina el tipo de una columna mirando sus valores. */
export function detectColumnType(values: string[]): TableColumnType {
  const filled = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (filled.length === 0) return 'text';
  if (filled.every((value) => parseNumberLoose(value) !== null)) return 'number';
  if (filled.every((value) => isTruthy(value))) return 'checkbox';
  if (filled.every((value) => toIsoDate(value) !== null)) return 'date';
  return 'text';
}

/** La inversa: para copiar la tabla al portapapeles o exportarla. */
export function tableToDelimited(data: TableData, separator = '\t'): string {
  const escape = (value: string) => (value.includes(separator) || value.includes('"') || value.includes('\n') ? `"${value.replace(/"/g, '""')}"` : value);
  const lines: string[] = [];
  if (data.hasHeader) lines.push(data.columns.map((column) => escape(column.title)).join(separator));
  for (const row of data.rows) {
    lines.push(data.columns.map((column) => escape(row.cells[column.id]?.value ?? '')).join(separator));
  }
  return lines.join('\n');
}

/** Texto plano para el índice de búsqueda y la exportación. */
export function tablePlainText(data: TableData): string {
  return [data.columns.map((column) => column.title).join(' | '), tableToDelimited({ ...data, hasHeader: false }, ' | ')].join('\n');
}

/** Filas como objetos (para importar CSV y convertirlo en documentos). */
export function tableToObjects(data: TableData): Record<string, string>[] {
  return data.rows.map((row) =>
    Object.fromEntries(data.columns.map((column) => [column.title || column.id, row.cells[column.id]?.value ?? ''])),
  );
}

/**
 * Convierte el texto pegado en una lista de tareas (una por línea). La última
 * celda, si es un «sí/x/true», se toma como el estado de la tarea y no como
 * texto; el resto de las columnas se agregan al texto separadas por «·».
 */
export function todoItemsFromDelimited(text: string): TodoItem[] {
  return parseDelimited(text)
    .map((row) => row.filter((cell) => cell.trim().length > 0))
    .filter((row) => row.length > 0)
    .map((row) => {
      const [first, ...rest] = row;
      const raw = first!.trim();
      const marked = /^\[[xX]\]/.test(raw);
      const head = raw.replace(/^[-*•]\s*/, '').replace(/^\[[ xX]\]\s*/, '');
      const lastCell = rest.length > 0 ? rest[rest.length - 1]! : '';
      const doneByColumn = rest.length > 0 && isTruthy(lastCell);
      const extra = doneByColumn ? rest.slice(0, -1) : rest;
      const label = extra.length > 0 ? `${head} · ${extra.join(' · ')}` : head;
      return { ...createTodoItem(label), checked: marked || doneByColumn };
    });
}

export function isEmptyCell(cell: TableCell | undefined): boolean {
  return !cell || cell.value.trim().length === 0;
}

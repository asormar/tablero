/**
 * Exportación a PNG (punto 3 de la fase 4): la resuelve el navegador.
 *
 * Decisión técnica: **no** se usa la ruta DOM → SVG → `<img>` → canvas. En
 * Chromium actual cualquier SVG que lleve un `<foreignObject>` mancha el canvas
 * al dibujarlo (`Tainted canvases may not be exported`), así que esa vía falla
 * siempre (comprobado en este navegador). En su lugar se dibuja el tablero con
 * la API 2D del canvas a partir del modelo (`BoardSession`): fondo de cada
 * tarjeta, texto envuelto, imágenes ya cargadas en el DOM, tablas, listas de
 * tareas y muestras de color.
 *
 * Es un render propio —no una captura de pantalla—, así que el resultado es
 * nítido a 2× y no depende de la virtualización ni del zoom.
 */

import type { BoardSession } from '@/collab/BoardSession';
import type { CanvasElement, ColorToken, TableData, TodoItem } from '@tablero/shared';

import { noteSurface } from '@/lib/smartPaste';
import { elementPlainText } from '@/search/searchLocal';
import { useSettingsStore } from '@/settings/settingsStore';
import { useUiStore } from '@/state/uiStore';

export type ExportBox = { x: number; y: number; width: number; height: number; scale: number };

/** Caja de exportación (mundo) para unos límites dados, con relleno y escala. */
export function exportBoxFor(
  bounds: { x: number; y: number; width: number; height: number },
  padding = 48,
  scale = 2,
): ExportBox {
  const width = Math.max(1, Math.round(bounds.width + padding * 2));
  const height = Math.max(1, Math.round(bounds.height + padding * 2));
  return { x: bounds.x - padding, y: bounds.y - padding, width, height, scale };
}

export type PngResult = { blob: Blob; width: number; height: number };

const PADDING = 18;

function cssVar(name: string, fallback: string): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, r);
    return;
  }
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/** Parte un texto en líneas que entren en `maxWidth` (con corte final en «…»). */
function wrapLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) continue;
    let current = '';
    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (current.length === 0 || context.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
    if (current.length > 0) lines.push(current);
  }
  if (lines.length > maxLines) lines.length = maxLines;
  const last = lines[maxLines - 1];
  if (lines.length === maxLines && last !== undefined && context.measureText(last).width > maxWidth) {
    let trimmed = last;
    while (trimmed.length > 1 && context.measureText(`${trimmed}…`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    lines[maxLines - 1] = `${trimmed}…`;
  }
  return lines;
}

type CardStyle = { background: string; color: string; radius: number };

function cardStyle(
  element: CanvasElement,
  fallbackSurface: string,
  fallbackText: string,
  radius: number,
): CardStyle {
  const token = element.color as ColorToken | undefined;
  if (element.hex || (token !== undefined && token !== 'none')) {
    const theme = useSettingsStore.getState().resolvedTheme;
    const surface = noteSurface(token, element.hex, theme);
    return { background: surface.background, color: surface.color, radius };
  }
  return { background: fallbackSurface, color: fallbackText, radius };
}

function todoLines(items: TodoItem[], depth = 0): string[] {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`${'  '.repeat(depth)}${item.checked ? '☑' : '☐'} ${item.text}`);
    if (item.children.length > 0) lines.push(...todoLines(item.children, depth + 1));
  }
  return lines;
}

function tableLines(table: TableData): string[] {
  const lines: string[] = [];
  if (table.hasHeader) lines.push(table.columns.map((column) => column.title).join(' · '));
  for (const row of table.rows) {
    lines.push(table.columns.map((column) => row.cells[column.id]?.value ?? '').join(' · '));
  }
  return lines;
}

/** Texto que se dibuja dentro de una tarjeta (por tipo). */
export function cardText(element: CanvasElement, session: BoardSession): string {
  switch (element.type) {
    case 'note':
    case 'document':
    case 'heading':
      return elementPlainText(element, session.getTextBlocks(element.id));
    case 'todo': {
      const title = element.title ?? '';
      const items = todoLines(element.items ?? []);
      return [title, ...items].filter((line) => line.length > 0).join('\n');
    }
    case 'column':
      return element.title;
    case 'table':
      return tableLines(element.table).join('\n');
    case 'link':
      return element.preview?.title ?? element.url;
    case 'swatch':
      return element.name ?? element.hex;
    case 'image':
    case 'file':
    case 'video':
    case 'audio':
      return element.caption ?? '';
    case 'map':
      return element.map.markers.map((marker) => marker.label).join('\n');
    default:
      return '';
  }
}

function fontSizeFor(type: string): number {
  if (type === 'heading') return 20;
  return 14;
}

/**
 * Renderiza el tablero abierto a PNG. Se dibujan las tarjetas del modelo (no
 * solo las montadas): el resultado no depende de la virtualización.
 */
export async function renderBoardToPng(session: BoardSession, scale = 2): Promise<PngResult> {
  const ui = useUiStore.getState();
  const bounds = session.bounds(ui.measuredHeights);
  if (!bounds) throw new Error('El tablero no tiene tarjetas para exportar');
  const box = exportBoxFor(bounds, 48, scale);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(box.width * scale);
  canvas.height = Math.round(box.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Sin contexto 2D para el PNG');
  context.scale(scale, scale);

  const background = cssVar('--canvas-bg', '#f4f4f2');
  const surface = cssVar('--surface', '#ffffff');
  const textColor = cssVar('--text', '#2b2b28');
  const mutedColor = cssVar('--text-muted', '#6b6b66');
  const borderColor = cssVar('--border', 'rgba(0,0,0,.1)');
  const fontFamily = cssVar('--font-sans', 'system-ui, sans-serif');

  context.fillStyle = background;
  context.fillRect(0, 0, box.width, box.height);
  context.translate(-box.x, -box.y);

  // Las imágenes se toman del DOM montado y se convierten a coordenadas de mundo.
  const world = document.querySelector('.canvas__world');
  const worldRect = world instanceof HTMLElement ? world.getBoundingClientRect() : null;
  const viewScale = ui.viewport.scale || 1;
  const toWorld = (rect: DOMRect): { x: number; y: number; width: number; height: number } => ({
    x: worldRect ? (rect.left - worldRect.left) / viewScale : rect.left,
    y: worldRect ? (rect.top - worldRect.top) / viewScale : rect.top,
    width: rect.width / viewScale,
    height: rect.height / viewScale,
  });

  const layout = new Map(session.getLayout().map((item) => [item.id, item]));

  for (const element of session.getAllElements()) {
    if (element.parentId) continue; // los hijos de columnas se ven dentro de la columna
    const item = layout.get(element.id);
    if (!item) continue;
    const measured = ui.measuredHeights.get(element.id);
    const width = item.width;
    const height = item.autoHeight && measured !== undefined && measured > 0 ? measured : item.height;
    const style = cardStyle(element, surface, textColor, element.type === 'swatch' ? 8 : 5);

    context.save();
    roundRect(context, item.x, item.y, width, height, style.radius);
    context.fillStyle = style.background;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = borderColor;
    context.stroke();
    context.clip();

    // Imagen (o póster del vídeo) desde el DOM, si la tarjeta está montada.
    const isMedia = element.type === 'image' || element.type === 'video';
    if (isMedia) {
      const node = document.querySelector(`[data-element-id="${CSS.escape(element.id)}"]`);
      const image = node?.querySelector('img');
      if (image && image.complete && image.naturalWidth > 0) {
        const rect = toWorld(image.getBoundingClientRect());
        try {
          context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
        } catch {
          // imagen ilegible: queda el fondo de la tarjeta
        }
      }
    }

    if (element.type === 'swatch') {
      context.fillStyle = element.hex;
      roundRect(context, item.x + PADDING / 2, item.y + PADDING / 2, width - PADDING, Math.max(12, height - PADDING * 2 - 16), 6);
      context.fill();
      context.font = `${fontSizeFor(element.type)}px ${fontFamily}`;
      context.fillStyle = textColor;
      context.fillText(element.name ?? element.hex, item.x + PADDING, item.y + height - 8);
      context.restore();
      continue;
    }

    const text = cardText(element, session);
    if (text.length > 0) {
      const fontSize = fontSizeFor(element.type);
      const weight = element.type === 'heading' ? '600 ' : '';
      context.font = `${weight}${fontSize}px ${fontFamily}`;
      const isMuted = element.type === 'column';
      context.fillStyle = isMuted ? mutedColor : style.color;
      const lineHeight = fontSize * 1.35;
      const maxLines = Math.max(1, Math.floor((height - PADDING * 1.2 - fontSize) / lineHeight) + 1);
      const lines = wrapLines(context, text, width - PADDING * 2, maxLines);
      let cursor = item.y + PADDING + fontSize;
      for (const line of lines) {
        context.fillText(line, item.x + PADDING, cursor);
        cursor += lineHeight;
      }
    }
    context.restore();
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('El canvas no pudo generar el PNG');
  return { blob, width: canvas.width, height: canvas.height };
}

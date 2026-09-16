/**
 * Pegado inteligente.
 *
 * Decide qué hacer con el texto del portapapeles antes de crear nada: un color
 * se convierte en una nota con ese color de fondo, una URL en una nota con el
 * enlace y el resto en una nota con el texto.
 */

import {
  type ColorToken,
  type ThemeMode,
  COLOR_TOKENS,
  detectColor,
  normalizeColor,
  shades,
} from '@tablero/shared';

export type PastePlan =
  | { kind: 'empty' }
  | { kind: 'color'; hex: string; token: ColorToken }
  | { kind: 'url'; url: string }
  | { kind: 'text'; text: string; lines: string[] };

const URL_RE = /^(https?:\/\/|www\.)[^\s]+$/i;

export function planPaste(input: string | null | undefined): PastePlan {
  const text = (input ?? '').replace(/\r\n/g, '\n').trim();
  if (text.length === 0) return { kind: 'empty' };

  const hex = detectColor(text);
  if (hex) return { kind: 'color', hex, token: tokenForHex(hex) };

  if (!text.includes('\n') && URL_RE.test(text)) {
    const url = text.startsWith('www.') ? `https://${text}` : text;
    return { kind: 'url', url };
  }

  return { kind: 'text', text, lines: text.split('\n') };
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

function rgbOf(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function distance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

/**
 * Token de color más parecido a un HEX: primero se resuelven los casos sin
 * croma (blanco, negro, grises) por luminancia y saturación; para el resto se
 * busca el tono de acento más cercano en la propia paleta, de modo que añadir un
 * color al paquete compartido no obliga a tocar esta función.
 */
export function tokenForHex(hex: string, mode: ThemeMode = 'light'): ColorToken {
  const normalized = normalizeColor(hex);
  if (!normalized) return 'gray';
  const rgb = rgbOf(normalized);
  const { r, g, b } = rgb;
  const luminance = relativeLuminance(rgb);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = (max - min) / 255;

  if (luminance > 0.93) return 'none';
  if (luminance < 0.12) return 'black';
  if (chroma < 0.08) return 'gray';

  let best: ColorToken = 'gray';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const token of COLOR_TOKENS) {
    if (token === 'none' || token === 'black' || token === 'gray') continue;
    const palette = shades(token, mode);
    // Se compara contra el matiz de fondo y el de acento: un pastel pegado por
    // el usuario suele ser el fondo de la tarjeta, no su acento.
    const candidates = [palette.soft, palette.strong];
    for (const candidate of candidates) {
      const normalizedCandidate = normalizeColor(candidate);
      if (!normalizedCandidate) continue;
      const current = distance(rgb, rgbOf(normalizedCandidate));
      if (current < bestDistance) {
        bestDistance = current;
        best = token;
      }
    }
  }
  return best;
}

/** ¿El token existe en la paleta? (guarda contra datos corruptos) */
export function isKnownToken(value: string): value is ColorToken {
  return (COLOR_TOKENS as readonly string[]).includes(value);
}

/** Fondo y texto de un token, resolviendo el `hex` literal si lo hubiera. */
export function noteSurface(
  token: ColorToken | undefined,
  hex: string | undefined,
  mode: ThemeMode = 'light',
): { background: string; color: string; border: string } {
  if (hex) {
    const normalized = normalizeColor(hex) ?? hex;
    return { background: normalized, color: readableOn(normalized), border: 'rgba(0,0,0,.12)' };
  }
  const palette = shades(token, mode);
  return { background: palette.soft, color: palette.text, border: 'rgba(0,0,0,.12)' };
}

function readableOn(hex: string): string {
  const luminance = relativeLuminance(rgbOf(hex));
  return luminance > 0.6 ? '#1A1A18' : '#FFFFFF';
}

/** JSON de ProseMirror para una nota con texto plano (una línea por párrafo). */
export function noteContentJson(text: string): {
  type: 'doc';
  content: { type: 'paragraph'; content?: { type: 'text'; text: string }[] }[];
} {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return {
    type: 'doc',
    content: lines.map((line) =>
      line.length === 0
        ? { type: 'paragraph' }
        : { type: 'paragraph', content: [{ type: 'text', text: line }] },
    ),
  };
}

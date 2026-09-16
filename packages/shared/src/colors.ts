/**
 * Paleta de colores de tarjeta.
 *
 * Cada token tiene variante clara y oscura, y dos matices: `soft` (fondo de la
 * tarjeta) y `strong` (acento: títulos, iconos, bordes activos).
 */

export const COLOR_TOKENS = [
  'none',
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
  'brown',
  'black',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export type ColorShades = {
  /** Fondo suave de la tarjeta. */
  soft: string;
  /** Color de acento (texto secundario, iconos, bordes). */
  strong: string;
  /** Texto principal sobre `soft`. */
  text: string;
};

export type ColorDefinition = {
  label: string;
  light: ColorShades;
  dark: ColorShades;
};

export const CARD_COLORS: Record<ColorToken, ColorDefinition> = {
  none: {
    label: 'Sin color',
    light: { soft: '#FFFFFF', strong: '#8A8A85', text: '#2B2B28' },
    dark: { soft: '#26262A', strong: '#9A9AA0', text: '#ECECEF' },
  },
  gray: {
    label: 'Gris',
    light: { soft: '#F1F1EF', strong: '#6B6B66', text: '#2B2B28' },
    dark: { soft: '#2E2E33', strong: '#A9A9AF', text: '#ECECEF' },
  },
  red: {
    label: 'Rojo',
    light: { soft: '#FBE4E4', strong: '#C93B3B', text: '#3A1A1A' },
    dark: { soft: '#40272A', strong: '#F08C8C', text: '#F7E4E4' },
  },
  orange: {
    label: 'Naranja',
    light: { soft: '#FDEBD8', strong: '#D2761F', text: '#3B2712' },
    dark: { soft: '#43301F', strong: '#F0A85C', text: '#F9EBDA' },
  },
  yellow: {
    label: 'Amarillo',
    light: { soft: '#FAF2CB', strong: '#B58A00', text: '#39320F' },
    dark: { soft: '#3E381D', strong: '#E2C257', text: '#F7F1D8' },
  },
  green: {
    label: 'Verde',
    light: { soft: '#E1F1DA', strong: '#3E8A2F', text: '#1C3316' },
    dark: { soft: '#2A3A26', strong: '#88C878', text: '#E4F2DE' },
  },
  teal: {
    label: 'Verde azulado',
    light: { soft: '#D8F0EE', strong: '#248C81', text: '#123431' },
    dark: { soft: '#1E3735', strong: '#5FC9BC', text: '#DCF1EE' },
  },
  blue: {
    label: 'Azul',
    light: { soft: '#DEEAFB', strong: '#2F6FC9', text: '#152A44' },
    dark: { soft: '#1F2C40', strong: '#77AEEE', text: '#E0EBFA' },
  },
  indigo: {
    label: 'Índigo',
    light: { soft: '#E2E3FB', strong: '#4A50C9', text: '#1C1D3E' },
    dark: { soft: '#282A43', strong: '#9AA0F0', text: '#E4E5FB' },
  },
  purple: {
    label: 'Morado',
    light: { soft: '#EDE1FA', strong: '#7E4FD0', text: '#2A1A40' },
    dark: { soft: '#322741', strong: '#B694EE', text: '#EFE5FB' },
  },
  pink: {
    label: 'Rosa',
    light: { soft: '#FBDFEE', strong: '#C6428A', text: '#3D1729' },
    dark: { soft: '#3F2534', strong: '#F08CBE', text: '#FBE3EF' },
  },
  brown: {
    label: 'Marrón',
    light: { soft: '#EDE2DA', strong: '#7C563C', text: '#31241B' },
    dark: { soft: '#382D26', strong: '#C0997C', text: '#EFE5DE' },
  },
  black: {
    label: 'Negro',
    light: { soft: '#E7E7E5', strong: '#2B2B28', text: '#1A1A18' },
    dark: { soft: '#2A2A2E', strong: '#C9C9CF', text: '#F2F2F4' },
  },
};

export type ThemeMode = 'light' | 'dark';

/** Devuelve los matices de un token para el tema activo. */
export function shades(token: ColorToken | undefined, mode: ThemeMode = 'light'): ColorShades {
  const def = CARD_COLORS[token ?? 'none'] ?? CARD_COLORS.none;
  return mode === 'dark' ? def.dark : def.light;
}

export function isColorToken(value: unknown): value is ColorToken {
  return typeof value === 'string' && (COLOR_TOKENS as readonly string[]).includes(value);
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*(-?\d{1,3})\s*[, ]\s*(-?\d{1,3})\s*[, ]\s*(-?\d{1,3})\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i;
const HSL_RE = /^hsla?\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i;

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function toHex(...bytes: number[]): string {
  return `#${bytes.map((b) => clampByte(b).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Normaliza un color escrito por el usuario (#RGB, rgb(), hsl()) a HEX de 6 dígitos. */
export function normalizeColor(input: string): string | null {
  const value = input.trim();
  if (HEX_RE.test(value)) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return `#${hex
        .split('')
        .map((c) => c + c)
        .join('')}`.toUpperCase();
    }
    if (hex.length === 8) return `#${hex.slice(0, 6)}`.toUpperCase();
    return `#${hex}`.toUpperCase();
  }
  const rgb = value.match(RGB_RE);
  if (rgb) {
    return toHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  }
  const hsl = value.match(HSL_RE);
  if (hsl) {
    const h = ((Number(hsl[1]) % 360) + 360) % 360;
    const s = Math.max(0, Math.min(100, Number(hsl[2]))) / 100;
    const l = Math.max(0, Math.min(100, Number(hsl[3]))) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] =
      h < 60
        ? [c, x, 0]
        : h < 120
          ? [x, c, 0]
          : h < 180
            ? [0, c, x]
            : h < 240
              ? [0, x, c]
              : h < 300
                ? [x, 0, c]
                : [c, 0, x];
    return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  return null;
}

/** ¿El texto pegado es un color? Se usa en el pegado inteligente. */
export function detectColor(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length > 64 || trimmed.includes('\n')) return null;
  const normalized = normalizeColor(trimmed);
  return normalized;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeColor(hex);
  if (!normalized) return null;
  const n = parseInt(normalized.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function formatHsl(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export function formatRgb(hex: string): string {
  const rgb = hexToRgb(hex);
  return rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : '';
}

/** Contraste AA-ish: devuelve negro o blanco según la luminancia del fondo. */
export function readableTextOn(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#FFFFFF';
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.6 ? '#1A1A18' : '#FFFFFF';
}

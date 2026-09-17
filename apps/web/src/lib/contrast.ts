/**
 * Contraste WCAG (punto 11 de la fase 4: tema oscuro con contraste AA).
 *
 * Funciones puras sobre colores hex para poder comprobar en las pruebas que los
 * pares de texto/fondo del tema oscuro (y del claro) llegan a AA (4.5:1 para
 * texto normal, 3:1 para elementos de interfaz y títulos grandes).
 */

export type Rgb = { r: number; g: number; b: number };

/** Acepta `#RGB`, `#RRGGBB` y `#RRGGBBAA` (ignora el alfa). */
export function parseHex(input: string): Rgb | null {
  const value = input.trim().replace(/^#/, '');
  const expanded =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  if (expanded.length !== 6 && expanded.length !== 8) return null;
  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  if (![r, g, b].every((channel) => Number.isFinite(channel))) return null;
  return { r, g, b };
}

/** Luminancia relativa según WCAG 2.1. */
export function relativeLuminance(color: Rgb | string): number {
  const rgb = typeof color === 'string' ? parseHex(color) : color;
  if (!rgb) return 0;
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Relación de contraste entre dos colores (1 a 21). */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** ¿El par llega al mínimo exigido? */
export function meetsAA(foreground: Rgb | string, background: Rgb | string, minimum = 4.5): boolean {
  return contrastRatio(foreground, background) >= minimum;
}

/** Mezcla un color con otro (0 = `a`, 1 = `b`); sirve para fondos translúcidos. */
export function mix(a: Rgb | string, b: Rgb | string, weight: number): Rgb {
  const ca = typeof a === 'string' ? parseHex(a) : a;
  const cb = typeof b === 'string' ? parseHex(b) : b;
  if (!ca || !cb) return { r: 0, g: 0, b: 0 };
  const clamped = Math.min(1, Math.max(0, weight));
  return {
    r: Math.round(ca.r + (cb.r - ca.r) * clamped),
    g: Math.round(ca.g + (cb.g - ca.g) * clamped),
    b: Math.round(ca.b + (cb.b - ca.b) * clamped),
  };
}

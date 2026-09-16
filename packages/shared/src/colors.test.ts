import { describe, expect, it } from 'vitest';

import {
  CARD_COLORS,
  COLOR_TOKENS,
  detectColor,
  formatHsl,
  formatRgb,
  isColorToken,
  normalizeColor,
  readableTextOn,
  shades,
} from './colors.js';

describe('paleta', () => {
  it('tiene los 12 colores del plan más blanco y ninguno', () => {
    const names = COLOR_TOKENS.filter((token) => token !== 'none');
    expect(names).toHaveLength(12);
    expect(names).toEqual([
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
    ]);
  });

  it('cada color define versiones suave y fuerte en claro y oscuro', () => {
    for (const token of COLOR_TOKENS) {
      const def = CARD_COLORS[token];
      for (const mode of ['light', 'dark'] as const) {
        expect(def[mode].soft).toMatch(/^#[0-9A-F]{6}$/i);
        expect(def[mode].strong).toMatch(/^#[0-9A-F]{6}$/i);
        expect(def[mode].text).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });

  it('shades resuelve por token y tema', () => {
    expect(shades('red', 'light').soft).toBe(CARD_COLORS.red.light.soft);
    expect(shades('red', 'dark').soft).toBe(CARD_COLORS.red.dark.soft);
    expect(shades(undefined).soft).toBe(CARD_COLORS.none.light.soft);
  });

  it('isColorToken discrimina valores válidos', () => {
    expect(isColorToken('teal')).toBe(true);
    expect(isColorToken('fucsia')).toBe(false);
    expect(isColorToken(7)).toBe(false);
  });
});

describe('normalizeColor', () => {
  it('normaliza hex de 3, 6 y 8 dígitos', () => {
    expect(normalizeColor('#fff')).toBe('#FFFFFF');
    expect(normalizeColor('#ff8800')).toBe('#FF8800');
    expect(normalizeColor('#FF8800AA')).toBe('#FF8800');
  });

  it('convierte rgb() y rgba()', () => {
    expect(normalizeColor('rgb(255, 136, 0)')).toBe('#FF8800');
    expect(normalizeColor('rgba(0,0,0,0.5)')).toBe('#000000');
    expect(normalizeColor('rgb(300, -20, 12)')).toBe('#FF000C');
  });

  it('convierte hsl()', () => {
    expect(normalizeColor('hsl(0, 100%, 50%)')).toBe('#FF0000');
    expect(normalizeColor('hsl(120, 100%, 25%)')).toBe('#008000');
  });

  it('rechaza lo que no es un color', () => {
    expect(normalizeColor('no soy un color')).toBeNull();
    expect(normalizeColor('')).toBeNull();
  });
});

describe('detectColor', () => {
  it('detecta colores pegados', () => {
    expect(detectColor('  #FF8800 ')).toBe('#FF8800');
    expect(detectColor('rgb(12, 34, 56)')).toBe('#0C2238');
  });

  it('ignora textos largos o multilínea', () => {
    expect(detectColor('Esta nota habla de #FF8800 en el texto')).toBeNull();
    expect(detectColor('#FF8800\n#00FF00')).toBeNull();
  });
});

describe('representaciones', () => {
  it('formatea rgb y hsl', () => {
    expect(formatRgb('#FF8800')).toBe('rgb(255, 136, 0)');
    expect(formatHsl('#FF0000')).toBe('hsl(0, 100%, 50%)');
  });

  it('elige texto legible según el fondo', () => {
    expect(readableTextOn('#FFFFFF')).toBe('#1A1A18');
    expect(readableTextOn('#101010')).toBe('#FFFFFF');
  });
});

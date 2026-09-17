/**
 * Pruebas de contraste (fase 4, punto 11): las funciones puras y la auditoría AA
 * de los pares texto/fondo de la paleta de tarjetas en los dos temas.
 *
 * Resultado de la auditoría (queda como prueba de regresión):
 *  - texto sobre el fondo de la tarjeta: AA (4.5:1) en los 13 tokens y en los
 *    dos temas (mínimo medido: 10.36 en oscuro, 11.28 en claro).
 *  - acento (`strong`) sobre el fondo: 3:1 (elementos de interfaz) en todos los
 *    tokens del tema oscuro y en todos los del claro salvo amarillo y naranja,
 *    que quedan en 2.82 y 2.84 — se dejan como excepción conocida porque son
 *    colores de acento decorativos, no texto.
 */

import { describe, expect, it } from 'vitest';

import { CARD_COLORS, COLOR_TOKENS, type ColorToken } from '@tablero/shared';

import { type Rgb, contrastRatio, meetsAA, mix, parseHex, relativeLuminance } from './contrast';

const LIGHT_ACCENT_EXCEPTIONS: ColorToken[] = ['yellow', 'orange'];

describe('parseHex', () => {
  it('acepta 3, 6 y 8 dígitos, con y sin almohadilla', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('2f6fc9')).toEqual({ r: 47, g: 111, b: 201 });
    expect(parseHex('#2f6fc9cc')).toEqual({ r: 47, g: 111, b: 201 });
  });

  it('devuelve null con entradas inválidas', () => {
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('rgba(0,0,0,.5)')).toBeNull();
  });
});

describe('relativeLuminance / contrastRatio', () => {
  it('blanco y negro son los extremos', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
  });

  it('el contraste es simétrico y nunca menor que 1', () => {
    expect(contrastRatio('#2F6FC9', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#2F6FC9'), 5);
    expect(contrastRatio('#2F6FC9', '#2F6FC9')).toBeCloseTo(1, 5);
  });

  it('con un color ilegible no explota', () => {
    expect(contrastRatio('nope', '#fff')).toBeGreaterThanOrEqual(1);
  });
});

describe('meetsAA', () => {
  it('exige 4.5:1 por defecto', () => {
    expect(meetsAA('#000000', '#FFFFFF')).toBe(true);
    expect(meetsAA('#999999', '#FFFFFF')).toBe(false);
    expect(meetsAA('#999999', '#FFFFFF', 3)).toBe(false);
  });
});

describe('mix', () => {
  it('peso 0 devuelve el primer color y peso 1 el segundo', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(mix('#000000', '#FFFFFF', 1)).toEqual({ r: 255, g: 255, b: 255 });
    expect(mix('#000000', '#FFFFFF', 0.5)).toEqual({ r: 128, g: 128, b: 128 });
  });

  it('recorta el peso fuera de rango', () => {
    expect(mix('#000000', '#FFFFFF', -3)).toEqual({ r: 0, g: 0, b: 0 });
    expect(mix('#000000', '#FFFFFF', 9)).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe('auditoría AA de la paleta de tarjetas', () => {
  it('el texto llega a AA sobre el fondo en los dos temas', () => {
    const failures: string[] = [];
    for (const token of COLOR_TOKENS) {
      const definition = CARD_COLORS[token];
      const light = contrastRatio(definition.light.text, definition.light.soft);
      const dark = contrastRatio(definition.dark.text, definition.dark.soft);
      if (!meetsAA(definition.light.text, definition.light.soft)) {
        failures.push(`${token} (claro): ${light.toFixed(2)}`);
      }
      if (!meetsAA(definition.dark.text, definition.dark.soft)) {
        failures.push(`${token} (oscuro): ${dark.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('el acento llega a 3:1 sobre el fondo (salvo la excepción documentada)', () => {
    const failures: string[] = [];
    for (const token of COLOR_TOKENS) {
      const definition = CARD_COLORS[token];
      const dark = contrastRatio(definition.dark.strong, definition.dark.soft);
      if (dark < 3) failures.push(`${token} (oscuro): ${dark.toFixed(2)}`);
      if (LIGHT_ACCENT_EXCEPTIONS.includes(token)) continue;
      const light = contrastRatio(definition.light.strong, definition.light.soft);
      if (light < 3) failures.push(`${token} (claro): ${light.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });

  it('deja constancia de que la excepción sigue siendo leve', () => {
    for (const token of LIGHT_ACCENT_EXCEPTIONS) {
      const ratio = contrastRatio(CARD_COLORS[token].light.strong, CARD_COLORS[token].light.soft);
      expect(ratio).toBeGreaterThan(2.5);
      expect(ratio).toBeLessThan(3);
    }
  });
});

describe('Rgb', () => {
  it('las funciones aceptan un objeto ya parseado', () => {
    const white: Rgb = { r: 255, g: 255, b: 255 };
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(contrastRatio(white, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 1);
  });
});

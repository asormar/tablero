/**
 * Pruebas de los tokens de diseño de las hojas de estilo: curvas, escala de
 * apilado y colores de comentario (con contraste AA en los dos temas).
 *
 * Se leen del CSS real para que fallen si alguien cambia un valor o vuelve a
 * escribir un número suelto donde ya hay un token.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio } from './contrast';

const STYLES = join(__dirname, '..', 'styles');
const SHEETS = ['global.css', 'phase2.css', 'phase3.css', 'phase4.css', 'phase5.css', 'print.css'];

function read(sheet: string): string {
  return readFileSync(join(STYLES, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

const GLOBAL = read('global.css');

type Tokens = Record<string, string>;

/** Tokens `--x: valor;` de los bloques `{…}` cuyo selector coincide. */
function tokensOf(css: string, selectorPattern: RegExp): Tokens {
  const tokens: Tokens = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorPattern.test(match[1]!.trim())) continue;
    for (const declaration of match[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      tokens[declaration[1]!] = declaration[2]!.trim();
    }
  }
  return tokens;
}

const light = tokensOf(GLOBAL, /^:root$/);
const darkMedia = tokensOf(GLOBAL, /^:root:not\(\[data-theme\]\)$/);
const darkSwitch = tokensOf(GLOBAL, /^:root\[data-theme='dark'\]$/);
const dark: Tokens = { ...light, ...darkMedia, ...darkSwitch };

function token(tokens: Tokens, name: string): string {
  const value = tokens[name];
  expect(value, `token ${name} presente`).toBeDefined();
  return value!;
}

describe('curvas de animación', () => {
  it('define las tres curvas fuertes y deja --ease como alias de --ease-out', () => {
    expect(token(light, '--ease-out')).toBe('cubic-bezier(0.23, 1, 0.32, 1)');
    expect(token(light, '--ease-in-out')).toBe('cubic-bezier(0.77, 0, 0.175, 1)');
    expect(token(light, '--ease-drawer')).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
    expect(token(light, '--ease')).toBe('var(--ease-out)');
  });

  it('unifica los giros en un solo token lineal', () => {
    expect(token(light, '--dur-spin')).toBe('800ms');
    for (const sheet of SHEETS) {
      for (const match of read(sheet).matchAll(/animation:\s*spin\s+([^;]+);/g)) {
        expect(match[1], `${sheet}: giro`).toBe('var(--dur-spin) linear infinite');
      }
    }
  });

  it('no usa ease-in en ninguna hoja', () => {
    for (const sheet of SHEETS) {
      expect(read(sheet), sheet).not.toMatch(/\bease-in(?![-\w])/);
    }
  });
});

describe('escala de apilado', () => {
  const z = (name: string): number => Number.parseInt(token(light, name), 10);

  it('respeta el orden: presentación > aviso > modal > popover > panel > capa > interfaz del lienzo', () => {
    const order = ['--z-presentation', '--z-toast', '--z-modal', '--z-fullscreen', '--z-popover', '--z-panel', '--z-overlay', '--z-canvas-ui'];
    const values = order.map(z);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(new Set(values).size).toBe(values.length);
  });

  it('no deja números sueltos de z-index por encima de 10 fuera de los modales y avisos', () => {
    // `.modal`, `.notice` y `.modal-backdrop` pasan a `var(--z-modal)` y
    // `var(--z-toast)` en su propia tarea; hasta entonces se toleran.
    const tolerated = new Set(['.modal', '.notice', '.modal-backdrop']);
    const offenders: string[] = [];
    for (const sheet of SHEETS) {
      for (const match of read(sheet).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1]!.trim();
        for (const declaration of match[2]!.matchAll(/z-index:\s*(-?\d+)\s*;/g)) {
          if (Number(declaration[1]) <= 10) continue;
          if (tolerated.has(selector)) continue;
          offenders.push(`${sheet}: ${selector} { z-index: ${declaration[1]} }`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('colores de comentario', () => {
  const NAMES = ['--comment', '--comment-soft', '--comment-ink', '--comment-text'];

  it('los dos bloques oscuros los definen y con los mismos valores', () => {
    for (const name of NAMES) {
      expect(token(light, name), `claro ${name}`).toBeTruthy();
      expect(token(darkMedia, name), `oscuro (media) ${name}`).toBeTruthy();
      expect(token(darkSwitch, name), `oscuro (interruptor) ${name}`).toBe(token(darkMedia, name));
    }
  });

  it('la tinta llega a 4.5:1 sobre el fondo suave, en los dos temas', () => {
    for (const [theme, tokens] of Object.entries({ claro: light, oscuro: dark })) {
      const ratio = contrastRatio(token(tokens, '--comment-ink'), token(tokens, '--comment-soft'));
      expect(ratio, `${theme}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el ámbar como texto llega a 4.5:1 sobre las superficies, en los dos temas', () => {
    const failures: string[] = [];
    for (const [theme, tokens] of Object.entries({ claro: light, oscuro: dark })) {
      for (const surface of ['--surface', '--surface-2', '--surface-3']) {
        const ratio = contrastRatio(token(tokens, '--comment-text'), token(tokens, surface));
        if (ratio < 4.5) failures.push(`${theme}: --comment-text sobre ${surface} = ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('el borde llega a 3:1 sobre el lienzo y las superficies, en los dos temas', () => {
    const failures: string[] = [];
    for (const [theme, tokens] of Object.entries({ claro: light, oscuro: dark })) {
      for (const surface of ['--canvas-bg', '--surface']) {
        const ratio = contrastRatio(token(tokens, '--comment'), token(tokens, surface));
        if (ratio < 3) failures.push(`${theme}: --comment sobre ${surface} = ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('las hojas ya no llevan los ámbares sueltos del pin de comentario', () => {
    const phase5 = read('phase5.css').toLowerCase();
    for (const raw of ['#fdebd8', '#3b2712', '#b35d0c']) {
      expect(phase5, raw).not.toContain(raw);
    }
  });
});

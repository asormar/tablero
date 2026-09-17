/**
 * Auditoría de contraste de los tokens de tema (fase 6, accesibilidad).
 *
 * La fase 4 dejó probada la paleta de las tarjetas; esto cubre lo que la
 * auditoría de la fase 6 encontró flojo en la interfaz: el texto secundario
 * (`--text-faint`), el verde del estado de guardado, el acento como texto sobre
 * su propio fondo suave y la tinta sobre el acento relleno.
 *
 * Los tokens se leen del CSS real (`styles/global.css`) para que la prueba falle
 * si alguien los cambia sin volver a medir.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio, meetsAA, mix } from './contrast';

const CSS = readFileSync(join(__dirname, '..', 'styles', 'global.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Tokens = Record<string, string>;

/** Extrae los tokens `--x: valor;` de los bloques cuyo selector coincide. */
function tokensOf(selectorPattern: RegExp): Tokens {
  const tokens: Tokens = {};
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.trim();
    if (!selectorPattern.test(selector)) continue;
    for (const declaration of match[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      tokens[declaration[1]!] = declaration[2]!.trim();
    }
  }
  return tokens;
}

const light = tokensOf(/^:root$/);
const darkOverrides = tokensOf(/^:root:not\(\[data-theme\]\)$|^:root\[data-theme='dark'\]$/);
const dark: Tokens = { ...light, ...tokensOf(/^:root:not\(\[data-theme\]\)$/), ...tokensOf(/^:root\[data-theme='dark'\]$/) };

function token(tokens: Tokens, name: string): string {
  const value = tokens[name];
  expect(value, `token ${name} presente en el CSS`).toBeDefined();
  return value!;
}

/** Contraste de `fg` sobre `bg` con `alpha` de opacidad en `fg`. */
function ratioOn(fg: string, bg: string, alpha = 1): number {
  const blended = alpha >= 1 ? fg : mix(bg, fg, 1 - alpha);
  return contrastRatio(typeof blended === 'string' ? blended : fg, bg);
}

describe('tokens de tema: contraste AA', () => {
  it('el bloque claro y los oscuros definen los tokens nuevos', () => {
    for (const name of ['--text-faint', '--accent-ink', '--accent-strong', '--sync-ok']) {
      expect(token(light, name), `claro ${name}`).toBeTruthy();
      expect(token(darkOverrides, name), `oscuro ${name}`).toBeTruthy();
    }
  });

  it('--text-faint llega a 4.5:1 sobre las tres superficies, en los dos temas', () => {
    const failures: string[] = [];
    for (const [theme, tokens] of Object.entries({ claro: light, oscuro: dark })) {
      const faint = token(tokens, '--text-faint');
      for (const surface of ['--surface', '--surface-2', '--surface-3', '--canvas-bg']) {
        const background = token(tokens, surface);
        if (!meetsAA(faint, background)) {
          failures.push(`${theme}: ${faint} sobre ${surface} ${background} = ${ratioOn(faint, background).toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('el texto sobre el acento relleno llega a 4.5:1', () => {
    for (const tokens of [light, dark]) {
      expect(meetsAA(token(tokens, '--accent-ink'), token(tokens, '--accent'))).toBe(true);
    }
  });

  it('el acento como texto sobre el fondo suave llega a 4.5:1', () => {
    for (const tokens of [light, dark]) {
      const ratio = ratioOn(token(tokens, '--accent-strong'), token(tokens, '--accent-soft'));
      expect(ratio, `acento suave: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el estado de guardado llega a 4.5:1 sobre su propio fondo translúcido', () => {
    for (const tokens of [light, dark]) {
      const ok = token(tokens, '--sync-ok');
      const ratio = ratioOn(ok, token(tokens, '--surface'), 0.12);
      expect(ratio, `guardado: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      const warn = token(tokens, '--sync-warn');
      const warnRatio = ratioOn(warn, token(tokens, '--surface'), 0.14);
      expect(warnRatio, `sin conexión: ${warnRatio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/**
 * Pruebas del andamiaje de i18n (fase 4, punto 10).
 *
 * Además de la paridad entre diccionarios, se recorre el código fuente y se
 * comprueba que **toda clave literal** usada con `t('…')` exista en los dos
 * diccionarios: así un texto nuevo no puede quedar como hueco en pantalla.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEV_SHORTCUT_GROUP, SHORTCUT_GROUPS } from '@/settings/shortcuts';

import { dictionaryKeys, getLanguage, setLanguage, t } from './index';

const SRC = join(__dirname, '..');

/** Quita comentarios de bloque y de línea para no leer claves de la prosa. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    result.push(full);
  }
  return result;
}

describe('diccionarios', () => {
  it('es y en tienen exactamente las mismas claves', () => {
    expect(dictionaryKeys('en')).toEqual(dictionaryKeys('es'));
  });

  it('no hay valores vacíos', () => {
    for (const language of ['es', 'en'] as const) {
      for (const key of dictionaryKeys(language)) {
        expect(t(key).length, `${language}:${key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('t()', () => {
  it('traduce según el idioma activo', () => {
    const original = getLanguage();
    try {
      setLanguage('es');
      expect(t('common.close')).toBe('Cerrar');
      setLanguage('en');
      expect(t('common.close')).toBe('Close');
    } finally {
      setLanguage(original);
    }
  });

  it('interpola parámetros y deja los desconocidos como están', () => {
    expect(t('boardSearch.count', { current: 2, total: 7 })).toBe('2 de 7');
    expect(t('history.elements', { count: 4 })).toContain('4');
    expect(t('import.failed', { message: 'sin red' })).toContain('sin red');
  });

  it('con una clave que no existe devuelve la clave (nunca vacío)', () => {
    expect(t('clave.que.no.existe')).toBe('clave.que.no.existe');
  });
});

describe('claves usadas en el código', () => {
  it('todas las claves literales de `t(\'…\')` existen en los diccionarios', () => {
    const esKeys = new Set(dictionaryKeys('es'));
    const enKeys = new Set(dictionaryKeys('en'));
    const missing = new Map<string, string[]>();
    const pattern = /\bt\(\s*'([A-Za-z0-9_.]+)'/g;

    for (const file of sourceFiles(SRC)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(pattern)) {
        const key = match[1]!;
        if (esKeys.has(key) && enKeys.has(key)) continue;
        const list = missing.get(key) ?? [];
        list.push(relative(SRC, file));
        missing.set(key, list);
      }
    }

    expect([...missing.entries()]).toEqual([]);
  });

  it('las claves de la lista de atajos existen', () => {
    const keys = new Set(dictionaryKeys('es'));
    for (const group of [...SHORTCUT_GROUPS, DEV_SHORTCUT_GROUP]) {
      expect(keys.has(group.titleKey)).toBe(true);
      for (const item of group.items) expect(keys.has(item.labelKey)).toBe(true);
    }
  });
});

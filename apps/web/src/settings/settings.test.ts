/**
 * Pruebas de los ajustes (fase 4, puntos 5 y 11): normalización, resolución del
 * tema y empuje a la API.
 *
 * El módulo de ajustes toca `localStorage` y el DOM dentro de `try/catch`, así
 * que se puede importar en un entorno sin navegador.
 */

import { describe, expect, it } from 'vitest';

import { extractSettings, formatBytes } from './api';
import { DEFAULT_SETTINGS, normalizeSettings, resolveTheme } from './settingsStore';

describe('normalizeSettings', () => {
  it('devuelve los valores por defecto con entradas inválidas', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('texto')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ theme: 'arcoiris', language: 'fr' })).toEqual(DEFAULT_SETTINGS);
  });

  it('conserva lo válido y descarta lo inválido', () => {
    const settings = normalizeSettings({
      theme: 'dark',
      language: 'en',
      canvasBackground: 'grid',
      showGuides: false,
      snapToGrid: false,
      otra: 'cosa',
    });
    expect(settings).toEqual({
      theme: 'dark',
      language: 'en',
      canvasBackground: 'grid',
      showGuides: false,
      snapToGrid: false,
    });
  });

  it('parte de una base cuando se la pasan', () => {
    const settings = normalizeSettings({ theme: 'light' }, { ...DEFAULT_SETTINGS, language: 'en' });
    expect(settings.language).toBe('en');
    expect(settings.theme).toBe('light');
  });
});

describe('resolveTheme', () => {
  it('resuelve «sistema» con la preferencia del sistema', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('deja pasar las preferencias explícitas', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('extractSettings', () => {
  it('acepta { settings }', () => {
    expect(extractSettings({ settings: { theme: 'dark' } })?.theme).toBe('dark');
  });

  it('acepta { user: { settings } }', () => {
    expect(extractSettings({ user: { settings: { language: 'en' } } })?.language).toBe('en');
  });

  it('acepta el objeto pelado', () => {
    expect(extractSettings({ theme: 'light' })?.theme).toBe('light');
  });

  it('devuelve null si no hay nada', () => {
    expect(extractSettings(null)).toBeNull();
    expect(extractSettings('hola')).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formatea bytes, kilobytes, megabytes y gigabytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 kB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });

  it('con valores inválidos devuelve un guion', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-5)).toBe('—');
  });
});

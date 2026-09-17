/**
 * Pruebas de nombres de archivo y caja de exportación PNG (fase 4, punto 3).
 */

import { describe, expect, it } from 'vitest';

import { fileNameFor, slugify } from './naming';
import { exportBoxFor } from './exportPng';

describe('slugify', () => {
  it('quita acentos, espacios y signos', () => {
    expect(slugify('Guion de vídeo — 2026')).toBe('guion-de-video-2026');
    expect(slugify('  ¿Qué tal?  ')).toBe('que-tal');
  });

  it('cae al valor por defecto si no queda nada', () => {
    expect(slugify('…')).toBe('tablero');
    expect(slugify('', 'respaldo')).toBe('respaldo');
  });

  it('recorta a 60 caracteres', () => {
    expect(slugify('a'.repeat(120)).length).toBe(60);
  });
});

describe('fileNameFor', () => {
  it('usa la extensión del formato', () => {
    expect(fileNameFor('Mi tablero', 'markdown')).toBe('mi-tablero.md');
    expect(fileNameFor('Mi tablero', 'text')).toBe('mi-tablero.txt');
    expect(fileNameFor('Mi tablero', 'png')).toBe('mi-tablero.png');
    expect(fileNameFor('Mi tablero', 'zip')).toBe('mi-tablero.zip');
  });

  it('con sello agrega la fecha', () => {
    const name = fileNameFor('Mi tablero', 'zip', true);
    expect(name).toMatch(/^mi-tablero-\d{4}-\d{2}-\d{2}\.zip$/);
  });
});

describe('exportBoxFor', () => {
  it('suma el relleno por los cuatro lados', () => {
    expect(exportBoxFor({ x: 10, y: 20, width: 100, height: 50 }, 5, 2)).toEqual({
      x: 5,
      y: 15,
      width: 110,
      height: 60,
      scale: 2,
    });
  });

  it('nunca devuelve un lado menor que 1', () => {
    const box = exportBoxFor({ x: 0, y: 0, width: 0, height: 0 }, 0, 1);
    expect(box.width).toBe(1);
    expect(box.height).toBe(1);
  });
});

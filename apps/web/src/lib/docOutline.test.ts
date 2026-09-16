/**
 * Documento: índice automático, recuento y extracto de la tarjeta.
 */

import { describe, expect, it } from 'vitest';

import type { TextBlock } from './textBlocks';
import { outlineOf, previewOf, wordCountOf } from './docOutline';

function heading(level: number, text: string): TextBlock {
  return {
    kind: 'heading',
    level,
    ordered: false,
    runs: [{ text, bold: false, italic: false, strike: false, code: false, link: null }],
  };
}

function paragraph(text: string): TextBlock {
  return {
    kind: 'paragraph',
    level: 0,
    ordered: false,
    runs: [{ text, bold: false, italic: false, strike: false, code: false, link: null }],
  };
}

const blocks: TextBlock[] = [
  heading(1, 'Plan del trimestre'),
  paragraph('Primera línea del cuerpo.'),
  heading(2, 'Objetivos'),
  paragraph('Vender más.'),
  heading(2, 'Riesgos'),
];

describe('outlineOf', () => {
  it('lista los encabezados en orden con su nivel', () => {
    expect(outlineOf(blocks)).toEqual([
      { level: 1, text: 'Plan del trimestre', index: 0 },
      { level: 2, text: 'Objetivos', index: 2 },
      { level: 2, text: 'Riesgos', index: 4 },
    ]);
  });

  it('ignora los encabezados vacíos y el texto normal', () => {
    const withEmpty: TextBlock[] = [heading(2, '   '), paragraph('cuerpo'), heading(2, 'Válido')];
    expect(outlineOf(withEmpty).map((entry) => entry.text)).toEqual(['Válido']);
  });

  it('un documento sin encabezados no tiene índice', () => {
    expect(outlineOf([paragraph('solo texto')])).toEqual([]);
  });
});

describe('wordCountOf', () => {
  it('cuenta todas las palabras del documento', () => {
    expect(wordCountOf(blocks)).toBe(3 + 4 + 1 + 2 + 1);
  });

  it('un documento vacío tiene 0', () => {
    expect(wordCountOf([])).toBe(0);
  });
});

describe('previewOf', () => {
  it('el título es el primer encabezado y el extracto lo que sigue', () => {
    const preview = previewOf(blocks);
    expect(preview.title).toBe('Plan del trimestre');
    expect(preview.excerpt).toContain('Primera línea del cuerpo.');
    expect(preview.wordCount).toBeGreaterThan(0);
  });

  it('sin encabezado, el título es la primera línea', () => {
    const preview = previewOf([paragraph('Título de la nota'), paragraph('Cuerpo')]);
    expect(preview.title).toBe('Título de la nota');
    expect(preview.excerpt).toBe('Cuerpo');
  });

  it('si la primera línea es un encabezado corto, se usa como título', () => {
    const preview = previewOf([heading(1, 'Informe'), paragraph('Resumen')]);
    expect(preview.title).toBe('Informe');
  });

  it('recorta el extracto', () => {
    const long = previewOf([paragraph('t'), paragraph('x'.repeat(600))]);
    expect(long.excerpt.length).toBeLessThanOrEqual(320);
  });

  it('un documento vacío no inventa título', () => {
    expect(previewOf([])).toEqual({ title: '', excerpt: '', wordCount: 0 });
  });
});

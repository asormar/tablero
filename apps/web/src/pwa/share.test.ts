/**
 * Pruebas del Share Target de la PWA (fase 4, punto 7).
 */

import { describe, expect, it } from 'vitest';

import { composeShareNote, parseShareParams } from './share';

describe('parseShareParams', () => {
  it('lee título, texto y URL', () => {
    expect(parseShareParams('?share=1&title=Un%20título&text=Hola&url=https%3A%2F%2Fejemplo.com')).toEqual({
      title: 'Un título',
      text: 'Hola',
      url: 'https://ejemplo.com',
    });
  });

  it('acepta la cadena sin el signo de interrogación', () => {
    expect(parseShareParams('share=1&text=Hola')?.text).toBe('Hola');
  });

  it('con solo texto alcanza', () => {
    expect(parseShareParams('?text=Solo%20texto')).toEqual({ title: '', text: 'Solo texto', url: '' });
  });

  it('devuelve null si no hay nada que compartir', () => {
    expect(parseShareParams('')).toBeNull();
    expect(parseShareParams('?share=1')).toBeNull();
    expect(parseShareParams('?otra=cosa')).toBeNull();
  });
});

describe('composeShareNote', () => {
  it('junta título, texto y URL en líneas', () => {
    expect(composeShareNote({ title: 'Título', text: 'Texto', url: 'https://ejemplo.com' })).toBe(
      'Título\nTexto\nhttps://ejemplo.com',
    );
  });

  it('no repite la URL si ya viene en el texto', () => {
    expect(
      composeShareNote({ title: '', text: 'Mirá https://ejemplo.com', url: 'https://ejemplo.com' }),
    ).toBe('Mirá https://ejemplo.com');
  });

  it('ignora los campos vacíos', () => {
    expect(composeShareNote({ title: '  ', text: 'Texto', url: '' })).toBe('Texto');
  });

  it('sin nada devuelve cadena vacía', () => {
    expect(composeShareNote({ title: '', text: '', url: '' })).toBe('');
  });
});

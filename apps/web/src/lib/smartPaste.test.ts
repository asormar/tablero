/** Pegado inteligente: qué se crea a partir del texto del portapapeles. */

import { describe, expect, it } from 'vitest';

import { noteContentJson, planPaste, tokenForHex } from './smartPaste';

describe('planPaste', () => {
  it('texto vacío no crea nada', () => {
    expect(planPaste('')).toEqual({ kind: 'empty' });
    expect(planPaste('   \n  ')).toEqual({ kind: 'empty' });
    expect(planPaste(null)).toEqual({ kind: 'empty' });
  });

  it('un hex se convierte en color de tarjeta', () => {
    const plan = planPaste('#DEEAFB');
    expect(plan).toMatchObject({ kind: 'color', hex: '#DEEAFB', token: 'blue' });
  });

  it('un rgb() también es color', () => {
    expect(planPaste('rgb(201, 59, 59)')).toMatchObject({ kind: 'color', hex: '#C93B3B' });
  });

  it('una URL suelta se reconoce como enlace', () => {
    expect(planPaste('https://example.com/a?b=1')).toMatchObject({
      kind: 'url',
      url: 'https://example.com/a?b=1',
    });
    expect(planPaste('www.milanote.com')).toMatchObject({ kind: 'url', url: 'https://www.milanote.com' });
  });

  it('un párrafo con URL no es un enlace (es texto)', () => {
    expect(planPaste('mirá esto https://example.com')).toMatchObject({ kind: 'text' });
  });

  it('un texto con varias líneas se conserva y se parte en líneas', () => {
    const plan = planPaste('primera\nsegunda\n\ncuarta');
    expect(plan.kind).toBe('text');
    if (plan.kind !== 'text') return;
    expect(plan.lines).toEqual(['primera', 'segunda', '', 'cuarta']);
  });
});

describe('tokenForHex', () => {
  it('blanco y negro caen en los tokens extremos', () => {
    expect(tokenForHex('#FFFFFF')).toBe('none');
    expect(tokenForHex('#0B0B0B')).toBe('black');
  });

  it('grises sin croma van a gris', () => {
    expect(tokenForHex('#8A8A85')).toBe('gray');
  });

  it('reconoce las familias de la paleta', () => {
    expect(tokenForHex('#C93B3B')).toBe('red');
    expect(tokenForHex('#3E8A2F')).toBe('green');
    expect(tokenForHex('#2F6FC9')).toBe('blue');
    expect(tokenForHex('#4A50C9')).toBe('indigo');
    expect(tokenForHex('#7E4FD0')).toBe('purple');
    expect(tokenForHex('#C6428A')).toBe('pink');
    expect(tokenForHex('#D2761F')).toBe('orange');
    expect(tokenForHex('#B58A00')).toBe('yellow');
  });

  it('un color parecido cae en el token más cercano', () => {
    expect(tokenForHex('#3A82D2')).toBe('blue');
    expect(tokenForHex('#C74AB0')).toBe('pink');
  });

  it('un hex inválido no rompe', () => {
    expect(tokenForHex('no-es-un-color')).toBe('gray');
  });
});

describe('noteContentJson', () => {
  it('un párrafo por línea, sin nodos de texto vacíos', () => {
    const json = noteContentJson('uno\n\ndos');
    expect(json.type).toBe('doc');
    expect(json.content).toHaveLength(3);
    expect(json.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'uno' }] });
    expect(json.content[1]).toEqual({ type: 'paragraph' });
    expect(json.content[2]?.content?.[0]?.text).toBe('dos');
  });
});

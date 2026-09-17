/**
 * Pruebas del resaltado de fragmentos (fase 4, punto 1).
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_TERMS,
  containsAny,
  countMatches,
  highlightSegments,
  mergeRanges,
  snippetAround,
  tokenizeQuery,
} from './highlight';

describe('tokenizeQuery', () => {
  it('normaliza a minúsculas, sin vacíos ni repetidos', () => {
    expect(tokenizeQuery('  Tablero   NOTA tablero ')).toEqual(['tablero', 'nota']);
  });

  it('corta en el máximo de términos', () => {
    const terms = tokenizeQuery('a b c d e f g h i j k l');
    expect(terms).toHaveLength(MAX_TERMS);
    expect(terms[0]).toBe('a');
  });

  it('devuelve una lista vacía sin texto', () => {
    expect(tokenizeQuery('   ')).toEqual([]);
  });
});

describe('mergeRanges', () => {
  it('une rangos solapados', () => {
    expect(
      mergeRanges([
        { start: 6, end: 9 },
        { start: 0, end: 3 },
        { start: 2, end: 5 },
      ]),
    ).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 9 },
    ]);
  });

  it('une los rangos que se tocan por el borde', () => {
    expect(
      mergeRanges([
        { start: 0, end: 3 },
        { start: 3, end: 6 },
      ]),
    ).toEqual([{ start: 0, end: 6 }]);
  });

  it('mantiene separados los rangos que no se tocan', () => {
    expect(
      mergeRanges([
        { start: 0, end: 2 },
        { start: 5, end: 7 },
      ]),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ]);
  });

  it('sin rangos devuelve vacío', () => {
    expect(mergeRanges([])).toEqual([]);
  });
});

describe('highlightSegments', () => {
  it('marca todas las apariciones, sin importar mayúsculas', () => {
    expect(highlightSegments('Nota de nota', ['nota'])).toEqual([
      { text: 'Nota', match: true },
      { text: ' de ', match: false },
      { text: 'nota', match: true },
    ]);
  });

  it('marca varios términos y une lo que se solapa', () => {
    const segments = highlightSegments('plan de planta', ['plan', 'plan de']);
    expect(segments.filter((segment) => segment.match).map((segment) => segment.text)).toEqual([
      'plan de',
      'plan',
    ]);
  });

  it('sin términos devuelve el texto entero sin marcar', () => {
    expect(highlightSegments('texto', [])).toEqual([{ text: 'texto', match: false }]);
  });

  it('sin coincidencias devuelve el texto entero sin marcar', () => {
    expect(highlightSegments('texto', ['zzz'])).toEqual([{ text: 'texto', match: false }]);
  });

  it('con texto vacío devuelve un tramo vacío', () => {
    expect(highlightSegments('', ['nota'])).toEqual([{ text: '', match: false }]);
  });
});

describe('containsAny', () => {
  it('encuentra coincidencias parciales sin distinguir mayúsculas', () => {
    expect(containsAny('Un Tablero grande', ['tabl'])).toBe(true);
    expect(containsAny('Un Tablero grande', ['chico'])).toBe(false);
  });

  it('ignora términos vacíos', () => {
    expect(containsAny('texto', [''])).toBe(false);
  });
});

describe('snippetAround', () => {
  it('recorta alrededor de la coincidencia con puntos suspensivos', () => {
    const text = `${'a'.repeat(100)} aguja ${'b'.repeat(100)}`;
    const snippet = snippetAround(text, ['aguja'], 10);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('aguja');
  });

  it('sin coincidencia devuelve el principio del texto', () => {
    expect(snippetAround('hola mundo', ['zzz'], 4)).toBe('hola mun');
  });

  it('colapsa los espacios y recorta los extremos', () => {
    expect(snippetAround('  hola    mundo  ', ['mundo'])).toBe('hola mundo');
  });

  it('con texto vacío devuelve vacío', () => {
    expect(snippetAround('   ', ['x'])).toBe('');
  });
});

describe('countMatches', () => {
  it('cuenta todas las apariciones de todos los términos', () => {
    expect(countMatches('nota nota NOTA', ['nota'])).toBe(3);
    expect(countMatches('nota tarea', ['nota', 'tarea'])).toBe(2);
  });
});

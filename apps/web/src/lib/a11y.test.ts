/**
 * Pruebas de los nombres accesibles de las tarjetas (fase 6, accesibilidad).
 */

import { describe, expect, it } from 'vitest';

import { CARD_LABEL_MAX, cardAriaLabel, cardSnippet } from './a11y';

describe('cardSnippet', () => {
  it('aplana espacios y saltos de línea', () => {
    expect(cardSnippet('  Hola\n\n  mundo  ')).toBe('Hola mundo');
  });

  it('recorta con puntos suspensivos cuando pasa del máximo', () => {
    const long = 'a'.repeat(CARD_LABEL_MAX + 20);
    const cut = cardSnippet(long);
    expect(cut.length).toBeLessThanOrEqual(CARD_LABEL_MAX);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('sin texto devuelve cadena vacía', () => {
    expect(cardSnippet(null)).toBe('');
    expect(cardSnippet('   ')).toBe('');
  });
});

describe('cardAriaLabel', () => {
  it('junta el tipo con el texto de la tarjeta', () => {
    expect(cardAriaLabel('Nota', 'Comprar café')).toBe('Nota: Comprar café');
  });

  it('avisa cuando la tarjeta está vacía', () => {
    expect(cardAriaLabel('Nota', '')).toBe('Nota (vacía)');
  });

  it('suma el estado de bloqueo', () => {
    expect(cardAriaLabel('Imagen', 'foto.png', { locked: true })).toBe(
      'Imagen: foto.png, posición bloqueada',
    );
  });

  it('respeta un máximo propio cuando se pide', () => {
    expect(cardAriaLabel('Nota', 'una nota larga', {}, 8)).toBe('Nota: una not…');
  });
});

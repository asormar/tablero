/**
 * Pruebas de las etiquetas de tipo (fase 4): cobertura completa de `ElementType`
 * y traducción con reserva al propio tipo.
 */

import { describe, expect, it } from 'vitest';

import { ELEMENT_TYPES, type ElementType } from '@tablero/shared';

import { dictionaryKeys, t } from '@/i18n';

import { ELEMENT_TYPE_LABELS, TYPE_KEYS, elementTypeLabel } from './typeLabels';

describe('TYPE_KEYS', () => {
  it('cubre todos los tipos de elemento', () => {
    expect([...ELEMENT_TYPE_LABELS].sort()).toEqual([...ELEMENT_TYPES].sort());
  });

  it('cada tipo tiene una clave del diccionario', () => {
    const keys = dictionaryKeys('es');
    for (const type of ELEMENT_TYPES) {
      expect(keys).toContain(TYPE_KEYS[type]);
    }
  });
});

describe('elementTypeLabel', () => {
  it('traduce con el diccionario activo', () => {
    expect(elementTypeLabel('note', t)).toBe('Nota');
    expect(elementTypeLabel('comment-pin', t)).toBe('Comentario');
  });

  it('con un tipo desconocido devuelve el propio valor', () => {
    expect(elementTypeLabel('inventado' as ElementType, t)).toBe('inventado');
  });
});

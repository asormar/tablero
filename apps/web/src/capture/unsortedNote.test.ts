/**
 * Pruebas de la colocación de la captura rápida (fase 4, punto 6).
 *
 * `capturePlacement` es la parte pura del módulo: el resto habla con la API y
 * con Yjs y se verifica en el navegador.
 */

import { describe, expect, it } from 'vitest';

import { capturePlacement } from './unsortedNote';

describe('capturePlacement', () => {
  it('con el tablero vacío coloca la nota en el origen', () => {
    expect(capturePlacement([])).toEqual({ x: 0, y: 0 });
  });

  it('coloca la nota por encima de lo que ya hay, sin pisarlo', () => {
    const point = capturePlacement([
      { x: 0, y: 0, width: 240 },
      { x: 300, y: 120, width: 240 },
    ]);
    expect(point.x).toBe(0);
    expect(point.y).toBeLessThan(0);
  });

  it('usa el borde superior, no el inferior', () => {
    const arriba = capturePlacement([{ x: 0, y: -500, width: 240 }]);
    const abajo = capturePlacement([{ x: 0, y: 0, width: 240 }]);
    expect(arriba.y).toBeLessThan(abajo.y);
  });
});

/**
 * Puntas de los conectores: la flecha apunta hacia donde llega el trazo y el
 * punto queda centrado, con el tamaño creciendo con el grosor.
 */

import { describe, expect, it } from 'vitest';

import { arrowPath, arrowSize } from './connectorArrows';

describe('arrowSize', () => {
  it('crece con el grosor', () => {
    expect(arrowSize('arrow', 4)).toBeGreaterThan(arrowSize('arrow', 1));
    expect(arrowSize('arrow', 1)).toBeGreaterThanOrEqual(9);
  });

  it('el punto es más chico que la flecha', () => {
    expect(arrowSize('dot', 4)).toBeLessThan(arrowSize('arrow', 4));
  });
});

describe('arrowPath', () => {
  it('sin punta no hay camino', () => {
    expect(arrowPath('none', { x: 0, y: 0 }, { x: 1, y: 0 }, 2)).toBe('');
  });

  it('la flecha termina en la punta', () => {
    const path = arrowPath('arrow', { x: 10, y: 20 }, { x: 1, y: 0 }, 2);
    expect(path.startsWith('M 10 20')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('girando la dirección, la base gira con ella', () => {
    const right = arrowPath('arrow', { x: 0, y: 0 }, { x: 1, y: 0 }, 2);
    const down = arrowPath('arrow', { x: 0, y: 0 }, { x: 0, y: 1 }, 2);
    expect(right).not.toBe(down);
    // Hacia abajo la base queda por encima de la punta (y negativa).
    expect(down).toContain('M 0 0');
  });

  it('el punto es un círculo cerrado alrededor del centro retrasado', () => {
    const path = arrowPath('dot', { x: 100, y: 100 }, { x: 1, y: 0 }, 2);
    expect(path).toContain('a ');
    expect(path.endsWith('Z')).toBe(true);
    // El círculo arranca en centro - radio = 100 - 3 - 3 = 94.
    expect(path).toContain('M 94 100');
  });

  it('con dirección nula no explota (usa una dirección por defecto)', () => {
    const path = arrowPath('arrow', { x: 0, y: 0 }, { x: 0, y: 0 }, 2);
    expect(path.startsWith('M 0 0')).toBe(true);
  });
});

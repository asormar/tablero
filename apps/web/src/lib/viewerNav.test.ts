/**
 * Visor a pantalla completa: qué imágenes recorre, en qué orden y con qué zoom
 * (navegación con las flechas entre las imágenes del tablero).
 */

import { describe, expect, it } from 'vitest';

import { fitZoom, stepViewer, stepZoom, viewerIndex, viewerSequence } from './viewerNav';

const layout = [
  { id: 'n1', type: 'note' as const },
  { id: 'i1', type: 'image' as const },
  { id: 'i2', type: 'image' as const },
  { id: 'v1', type: 'video' as const },
  { id: 'i3', type: 'image' as const },
];

describe('viewerSequence', () => {
  it('recorre las imágenes en el orden del apilado', () => {
    expect(viewerSequence(layout)).toEqual(['i1', 'i2', 'i3']);
  });

  it('sin imágenes no hay secuencia', () => {
    expect(viewerSequence([{ id: 'n1', type: 'note' }])).toEqual([]);
  });
});

describe('stepViewer', () => {
  const ids = ['i1', 'i2', 'i3'];

  it('avanza y retrocede', () => {
    expect(stepViewer(ids, 'i1', 1)).toBe('i2');
    expect(stepViewer(ids, 'i2', -1)).toBe('i1');
  });

  it('da la vuelta en los extremos', () => {
    expect(stepViewer(ids, 'i3', 1)).toBe('i1');
    expect(stepViewer(ids, 'i1', -1)).toBe('i3');
  });

  it('con una sola imagen se queda en ella', () => {
    expect(stepViewer(['i1'], 'i1', 1)).toBe('i1');
  });

  it('si el id actual ya no está, empieza por la primera', () => {
    expect(stepViewer(ids, 'borrada', 1)).toBe('i1');
    expect(viewerIndex(ids, 'borrada')).toBe(-1);
  });

  it('sin imágenes devuelve null', () => {
    expect(stepViewer([], 'i1', 1)).toBeNull();
  });
});

describe('zoom del visor', () => {
  it('sube y baja por los pasos, sin salirse del rango', () => {
    expect(stepZoom(1, 1)).toBeGreaterThan(1);
    expect(stepZoom(1, -1)).toBeLessThan(1);
    expect(stepZoom(0.05, -1)).toBeGreaterThanOrEqual(0.1);
    expect(stepZoom(20, 1)).toBeLessThanOrEqual(8);
  });

  it('el encaje nunca amplía por encima del tamaño real', () => {
    expect(fitZoom({ width: 4000, height: 3000 }, { width: 800, height: 600 })).toBeCloseTo(0.2, 3);
    expect(fitZoom({ width: 400, height: 300 }, { width: 800, height: 600 })).toBe(1);
  });
});

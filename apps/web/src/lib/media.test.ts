/**
 * Paleta de una imagen (cuantización de píxeles) y forma de onda del audio
 * (picos por tramo): las dos partes sin DOM de los cálculos de la fase 2.
 */

import { describe, expect, it } from 'vitest';

import { paletteFromPixels, safePaletteHex } from './palette';
import { computePeaks, mixChannels, peaksToPath } from './waveform';

function pixels(colors: [number, number, number][], repeat: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * repeat * 4);
  let offset = 0;
  for (let round = 0; round < repeat; round += 1) {
    for (const [r, g, b] of colors) {
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
      offset += 4;
    }
  }
  return data;
}

describe('paletteFromPixels', () => {
  it('ordena los colores dominantes por frecuencia', () => {
    // 60 % rojo, 30 % azul, 10 % verde.
    const data = pixels(
      [
        [255, 0, 0],
        [255, 0, 0],
        [255, 0, 0],
        [255, 0, 0],
        [255, 0, 0],
        [255, 0, 0],
        [0, 0, 255],
        [0, 0, 255],
        [0, 0, 255],
        [0, 255, 0],
      ],
      1,
    );
    const palette = paletteFromPixels(data, { count: 3 });
    expect(palette).toHaveLength(3);
    expect(palette[0]?.hex).toBe('#FF0000');
    expect(palette[1]?.hex).toBe('#0000FF');
    expect(palette[2]?.hex).toBe('#00FF00');
    expect(palette[0]?.ratio).toBeCloseTo(0.6, 2);
  });

  it('descarta los píxeles casi transparentes', () => {
    const data = new Uint8ClampedArray(8);
    // Primer píxel: rojo opaco. Segundo: verde transparente.
    data[0] = 255;
    data[3] = 255;
    data[4] = 0;
    data[5] = 255;
    data[6] = 0;
    data[7] = 0;
    const palette = paletteFromPixels(data, { count: 5 });
    expect(palette.map((entry) => entry.hex)).toEqual(['#FF0000']);
  });

  it('agrupa tonos parecidos en un solo color medio', () => {
    const data = pixels(
      [
        [120, 120, 120],
        [122, 121, 119],
        [118, 119, 121],
      ],
      4,
    );
    const palette = paletteFromPixels(data, { count: 5 });
    expect(palette).toHaveLength(1);
    expect(palette[0]?.hex.startsWith('#7')).toBe(true);
  });

  it('sin píxeles devuelve una paleta vacía', () => {
    expect(paletteFromPixels(new Uint8ClampedArray(0))).toEqual([]);
  });

  it('normaliza un hex raro del canvas', () => {
    expect(safePaletteHex('#abcdef')).toBe('#ABCDEF');
    expect(safePaletteHex('no-es-un-color')).toBe('#000000');
  });
});

describe('computePeaks', () => {
  it('devuelve un pico por tramo y normaliza el máximo a 1', () => {
    const samples = new Float32Array([0, 0, 0.5, -0.5, 0, 0, 1, -1]);
    const peaks = computePeaks(samples, 4);
    expect(peaks).toHaveLength(4);
    expect(Math.max(...peaks)).toBeCloseTo(1, 5);
    expect(peaks[0]).toBe(0);
  });

  it('sin muestras no hay picos', () => {
    expect(computePeaks(new Float32Array(0), 10)).toEqual([]);
    expect(computePeaks(new Float32Array([1, 2, 3]), 0)).toEqual([]);
  });

  it('mezcla los canales a mono', () => {
    const mixed = mixChannels([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(mixed)).toEqual([0.5, 0.5]);
  });

  it('el trazo de la onda tiene una barra por pico', () => {
    const path = peaksToPath([0.5, 1], 100, 40);
    expect(path.split('M')).toHaveLength(3);
  });
});

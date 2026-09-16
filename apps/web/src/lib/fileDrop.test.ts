/**
 * Clasificación y colocación en bloque de los archivos que se sueltan en el
 * lienzo: el criterio de la fase es que veinte imágenes caigan en cascada sin
 * solaparse.
 */

import { describe, expect, it } from 'vitest';

import { type Rect, rectsIntersect } from '@tablero/shared';

import {
  CARD_CHROME,
  batchPlacement,
  cardSizeFor,
  classifyDroppedFiles,
  fallbackSizeFor,
} from './fileDrop';

const png = (name: string, size = 1024) => ({ name, type: 'image/png', size });
const mp4 = (name: string) => ({ name, type: 'video/mp4', size: 2048 });
const mp3 = (name: string) => ({ name, type: 'audio/mpeg', size: 512 });
const pdf = (name: string) => ({ name, type: 'application/pdf', size: 4096 });

describe('classifyDroppedFiles', () => {
  it('clasifica imagen, vídeo, audio, PDF y desconocidos', () => {
    const result = classifyDroppedFiles([png('a.png'), mp4('b.mp4'), mp3('c.mp3'), pdf('d.pdf'), { name: 'x', type: '', size: 1 }]);
    expect(result.map((item) => item.kind)).toEqual(['image', 'video', 'audio', 'file', 'file']);
    expect(result.map((item) => item.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result[3]?.isPdf).toBe(true);
    expect(result[0]?.isPdf).toBe(false);
    expect(result[3]?.extension).toBe('pdf');
  });

  it('conserva el orden de llegada y el nombre original', () => {
    const result = classifyDroppedFiles([mp4('z.mp4'), png('a.png')]);
    expect(result.map((item) => item.name)).toEqual(['z.mp4', 'a.png']);
  });

  it('usa un nombre de reserva si el archivo no trae uno', () => {
    const result = classifyDroppedFiles([{ name: '', type: 'image/png', size: 10 }]);
    expect(result[0]?.title).toBe('archivo-1');
  });
});

describe('batchPlacement', () => {
  const sizes = Array.from({ length: 20 }, () => ({ width: 320, height: 240 }));

  it('coloca veinte imágenes en una rejilla sin solaparse', () => {
    const plan = batchPlacement({ sizes, origin: { x: 0, y: 0 } });
    expect(plan.positions).toHaveLength(20);
    expect(plan.columns).toBe(5);
    expect(plan.rows).toBe(4);

    const rects: Rect[] = plan.positions.map((position) => ({
      x: position.x,
      y: position.y,
      width: 320,
      height: 240,
    }));
    for (let a = 0; a < rects.length; a += 1) {
      for (let b = a + 1; b < rects.length; b += 1) {
        expect(rectsIntersect(rects[a] as Rect, rects[b] as Rect)).toBe(false);
      }
    }
  });

  it('respeta el orden de lectura (izquierda a derecha, arriba abajo)', () => {
    const plan = batchPlacement({ sizes: sizes.slice(0, 6), origin: { x: 0, y: 0 } });
    expect(plan.positions[0]).toEqual({ x: 0, y: 0 });
    expect(plan.positions[1]?.y).toBe(0);
    expect(plan.positions[3]?.y).toBeGreaterThan(0);
    expect(plan.positions[3]?.x).toBe(plan.positions[0]?.x);
  });

  it('usa alturas reales: una fila con una imagen alta no la pisa la siguiente', () => {
    const mixed = [
      { width: 320, height: 240 },
      { width: 320, height: 600 },
      { width: 320, height: 160 },
      { width: 320, height: 160 },
    ];
    const plan = batchPlacement({ sizes: mixed, origin: { x: 0, y: 0 } });
    const rects: Rect[] = plan.positions.map((position, index) => ({
      x: position.x,
      y: position.y,
      width: mixed[index]?.width ?? 0,
      height: mixed[index]?.height ?? 0,
    }));
    for (let a = 0; a < rects.length; a += 1) {
      for (let b = a + 1; b < rects.length; b += 1) {
        expect(rectsIntersect(rects[a] as Rect, rects[b] as Rect)).toBe(false);
      }
    }
  });

  it('aparta el bloque entero si el punto de suelta ya está ocupado', () => {
    const existing: Rect[] = [{ x: 0, y: 0, width: 900, height: 700 }];
    const plan = batchPlacement({ sizes: sizes.slice(0, 4), origin: { x: 0, y: 0 }, existing });
    const first = plan.positions[0];
    expect(first?.y).toBeGreaterThanOrEqual(700);
  });

  it('un solo archivo ocupa una sola casilla', () => {
    const plan = batchPlacement({ sizes: [sizes[0] as { width: number; height: number }], origin: { x: 24, y: 48 } });
    expect(plan.columns).toBe(1);
    expect(plan.rows).toBe(1);
    expect(plan.positions[0]).toEqual({ x: 24, y: 48 });
  });
});

describe('cardSizeFor', () => {
  it('respeta el ancho base y calcula el alto por el aspecto, más el marco', () => {
    // 304 px de ancho interior a 4:3 son 228 px, más 40 del relleno y el pie.
    expect(cardSizeFor('image', { width: 640, height: 480 })).toEqual({ width: 320, height: 268 });
  });

  it('el alto de la tarjeta de audio es solo el marco (no tiene recuadro)', () => {
    expect(cardSizeFor('audio', { width: 800, height: 200 })).toEqual({ width: 280, height: CARD_CHROME.audio });
  });

  it('no agranda una imagen más pequeña que la tarjeta', () => {
    // 184 px de ancho interior a 1:2 son 92 px, más 40 del marco.
    expect(cardSizeFor('image', { width: 200, height: 100 })).toEqual({ width: 200, height: 132 });
  });

  it('sin medidas usa el tamaño por defecto del tipo, con su marco', () => {
    const size = cardSizeFor('video', null);
    expect(size.width).toBe(fallbackSizeFor('video').width);
    expect(size.height).toBe(fallbackSizeFor('video').height + CARD_CHROME.video);
  });
});

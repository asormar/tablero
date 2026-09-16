import { describe, expect, it } from 'vitest';

import {
  alignRects,
  boundsOf,
  computeAlignment,
  expandRect,
  GRID_SIZE,
  nextPlacement,
  rectContainsRect,
  rectFromPoints,
  rectsIntersect,
  snapToGrid,
  unionRect,
  type Rect,
} from './geometry.js';

const rect = (x: number, y: number, width = 200, height = 100): Rect => ({ x, y, width, height });

describe('rectFromPoints', () => {
  it('normaliza un lazo dibujado en cualquier dirección', () => {
    expect(rectFromPoints({ x: 300, y: 200 }, { x: 100, y: 50 })).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 150,
    });
  });
});

describe('rectsIntersect', () => {
  it('detecta solapamiento parcial', () => {
    expect(rectsIntersect(rect(0, 0), rect(150, 50))).toBe(true);
  });

  it('no marca como solapados dos rectángulos que solo se tocan por el borde', () => {
    expect(rectsIntersect(rect(0, 0), rect(200, 0))).toBe(false);
  });

  it('detecta contención total', () => {
    expect(rectsIntersect(rect(0, 0, 400, 400), rect(100, 100, 50, 50))).toBe(true);
  });
});

describe('boundsOf', () => {
  it('devuelve null sin rectángulos', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('envuelve un conjunto disperso', () => {
    expect(boundsOf([rect(0, 0), rect(500, 300, 100, 50)])).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 350,
    });
  });
});

describe('unionRect / expandRect / rectContainsRect', () => {
  it('une dos rectángulos', () => {
    expect(unionRect(rect(0, 0, 10, 10), rect(20, 20, 10, 10))).toEqual({
      x: 0,
      y: 0,
      width: 30,
      height: 30,
    });
  });

  it('expande en todas las direcciones', () => {
    expect(expandRect(rect(10, 10, 10, 10), 5)).toEqual({ x: 5, y: 5, width: 20, height: 20 });
  });

  it('comprueba contención estricta', () => {
    expect(rectContainsRect(rect(0, 0, 100, 100), rect(10, 10, 10, 10))).toBe(true);
    expect(rectContainsRect(rect(0, 0, 100, 100), rect(95, 95, 10, 10))).toBe(false);
  });
});

describe('snapToGrid', () => {
  it('ajusta al múltiplo de 8 más cercano', () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(3)).toBe(0);
    expect(snapToGrid(5)).toBe(8);
    expect(snapToGrid(-3)).toBe(0);
    expect(snapToGrid(13, 8)).toBe(16);
    expect(GRID_SIZE).toBe(8);
  });
});

describe('computeAlignment', () => {
  const target = rect(200, 100, 200, 100); // bordes: 200..400 / 100..200

  it('imanta el borde izquierdo con el de otra tarjeta', () => {
    const moving = rect(204, 400, 150); // borde 204 vs 200; los centros no coinciden
    const result = computeAlignment([moving], [target], { grid: 8, gridSnap: false });
    expect(result.dx).toBe(-4);
    expect(result.guides.some((g) => g.axis === 'x' && g.position === 200)).toBe(true);
  });

  it('con empate entre guía de borde y de centro, gana la de centro', () => {
    const moving = rect(204, 400); // mismo ancho que el destino: 3 empates a 4 px
    const result = computeAlignment([moving], [target], { grid: 8, gridSnap: false });
    expect(result.dx).toBe(-4);
    const guide = result.guides.find((g) => g.axis === 'x');
    expect(guide?.position).toBe(300);
    expect(guide?.kind).toBe('center');
  });

  it('imanta los centros verticales', () => {
    const moving = rect(600, 98); // centro y = 148; destino centro y = 150
    const result = computeAlignment([moving], [target], { grid: 8, gridSnap: false });
    expect(result.dy).toBe(2);
    expect(result.guides.some((g) => g.axis === 'y' && g.position === 150)).toBe(true);
  });

  it('no imanta fuera del umbral', () => {
    const moving = rect(283, 407);
    const result = computeAlignment([moving], [target], { threshold: 6, gridSnap: false });
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.guides).toHaveLength(0);
  });

  it('cae a la rejilla de 8 px cuando no hay guías y el ajuste está activo', () => {
    const moving = rect(303, 407);
    const result = computeAlignment([moving], [], { grid: 8, gridSnap: true });
    expect(result.dx).toBe(1); // 303 → 304
    expect(result.dy).toBe(1); // 407 → 408
  });

  it('respeta guides:false', () => {
    const moving = rect(204, 400);
    const result = computeAlignment([moving], [target], { grid: 8, guides: false, gridSnap: true });
    expect(result.guides).toHaveLength(0);
    expect(result.dx).toBe(4); // 204 → 208 por rejilla, sin imantar al borde 200
  });

  it('sin desplazamiento cuando el elemento ya está alineado', () => {
    const result = computeAlignment([rect(200, 100)], [target], { grid: 8 });
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
  });

  it('con varios elementos usa la caja envolvente del grupo', () => {
    const group = [rect(204, 100), rect(204, 300)];
    const result = computeAlignment(group, [target], { grid: 8, gridSnap: false });
    expect(result.dx).toBe(-4);
    expect(result.guides.find((g) => g.axis === 'x')?.start).toBeLessThanOrEqual(100);
    expect(result.guides.find((g) => g.axis === 'x')?.end).toBeGreaterThanOrEqual(400);
  });
});

describe('alignRects', () => {
  const a = rect(0, 0, 100, 50);
  const b = rect(300, 200, 100, 50);
  const c = rect(600, 400, 100, 50);

  it('alinea a la izquierda', () => {
    expect(alignRects([a, b, c], 'left').map((p) => p.x)).toEqual([0, 0, 0]);
  });

  it('alinea al centro', () => {
    const xs = alignRects([a, b], 'center-x').map((p) => p.x);
    expect(xs[0]).toBe(150);
    expect(xs[1]).toBe(150);
  });

  it('alinea abajo (la caja envolvente acaba en y=250, alto 50 → y=200)', () => {
    expect(alignRects([a, b], 'bottom').map((p) => p.y)).toEqual([200, 200]);
  });

  it('distribuye horizontalmente con separación uniforme', () => {
    // Devuelve las posiciones en el orden de entrada ([a, c, b] → [0, 600, 300]).
    expect(alignRects([a, c, b], 'distribute-x').map((p) => p.x)).toEqual([0, 600, 300]);
    // Y ordenado por posición queda a=0, b=300, c=600.
    const byId = new Map([
      [a, alignRects([a, c, b], 'distribute-x')[0]!],
      [b, alignRects([a, c, b], 'distribute-x')[2]!],
      [c, alignRects([a, c, b], 'distribute-x')[1]!],
    ]);
    expect([a, b, c].map((r) => byId.get(r)!.x)).toEqual([0, 300, 600]);
  });

  it('necesita tres elementos para distribuir', () => {
    expect(alignRects([a, b], 'distribute-x')).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 200 },
    ]);
  });
});

describe('nextPlacement', () => {
  it('coloca debajo de la primera colisión', () => {
    const existing = [rect(0, 0, 240, 100)];
    const point = nextPlacement(existing, { width: 240, height: 100 }, { x: 0, y: 0 }, 16);
    expect(point.y).toBe(116);
    expect(point.x).toBe(0);
  });

  it('usa el origen cuando el hueco está libre', () => {
    expect(nextPlacement([], { width: 240, height: 100 }, { x: 40, y: 56 }, 16)).toEqual({ x: 40, y: 56 });
  });
});

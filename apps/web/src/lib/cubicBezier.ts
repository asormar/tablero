/**
 * Curva `cubic-bezier(x1, y1, x2, y2)` de CSS, evaluada en JavaScript.
 *
 * Las animaciones que corren con `requestAnimationFrame` (la cámara del lienzo)
 * no pueden delegar la curva en CSS; aquí se resuelve igual que lo hace el
 * navegador: dado el tiempo `x` (0..1) se busca el parámetro `t` de la curva con
 * Newton-Raphson y, si la derivada es casi plana, con bisección.
 */

const NEWTON_ITERATIONS = 8;
const NEWTON_MIN_SLOPE = 1e-6;
const BISECTION_ITERATIONS = 24;
const PRECISION = 1e-6;

export type EasingFn = (progress: number) => number;

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1)) {
    throw new RangeError('cubicBezier: x1 y x2 deben estar entre 0 y 1');
  }
  if (x1 === y1 && x2 === y2) return (progress) => clamp01(progress);

  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;

  const solveT = (x: number): number => {
    let t = x;
    for (let index = 0; index < NEWTON_ITERATIONS; index += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < PRECISION) return t;
      const slope = slopeX(t);
      if (Math.abs(slope) < NEWTON_MIN_SLOPE) break;
      t -= error / slope;
    }
    let low = 0;
    let high = 1;
    t = x;
    for (let index = 0; index < BISECTION_ITERATIONS; index += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < PRECISION) return t;
      if (error > 0) high = t;
      else low = t;
      t = (low + high) / 2;
    }
    return t;
  };

  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return sampleY(solveT(progress));
  };
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

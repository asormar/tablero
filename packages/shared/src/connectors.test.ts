import { describe, expect, it } from 'vitest';

import {
  anchorPoint,
  autoSides,
  connectorBounds,
  connectorGeometry,
  createConnector,
  createEndpoint,
  dashArray,
  DEFAULT_CONNECTOR_STYLE,
  distanceToPath,
  hitsPath,
  isAttached,
  pointOnPath,
  resolveEndpoint,
  sideNormal,
} from './connectors.js';
import type { Rect } from './geometry.js';

const rect = (x: number, y: number, width = 200, height = 100): Rect => ({ x, y, width, height });

describe('anclajes', () => {
  const r = rect(100, 50, 200, 100); // 100..300 × 50..150

  it('punto de anclaje en cada lado', () => {
    expect(anchorPoint(r, 'left')).toEqual({ x: 100, y: 100 });
    expect(anchorPoint(r, 'right')).toEqual({ x: 300, y: 100 });
    expect(anchorPoint(r, 'top')).toEqual({ x: 200, y: 50 });
    expect(anchorPoint(r, 'bottom')).toEqual({ x: 200, y: 150 });
  });

  it('el desplazamiento recorre el lado y se recorta a 0..1', () => {
    expect(anchorPoint(r, 'left', 0)).toEqual({ x: 100, y: 50 });
    expect(anchorPoint(r, 'left', 1)).toEqual({ x: 100, y: 150 });
    expect(anchorPoint(r, 'top', 2)).toEqual({ x: 300, y: 50 });
    expect(anchorPoint(r, 'top', -1)).toEqual({ x: 100, y: 50 });
  });

  it('la normal apunta hacia fuera', () => {
    expect(sideNormal('left')).toEqual({ x: -1, y: 0 });
    expect(sideNormal('bottom')).toEqual({ x: 0, y: 1 });
  });
});

describe('autoSides', () => {
  it('usa los lados que se miran cuando el destino está al lado', () => {
    expect(autoSides(rect(0, 0), rect(500, 0))).toEqual({ from: 'right', to: 'left' });
    expect(autoSides(rect(500, 0), rect(0, 0))).toEqual({ from: 'left', to: 'right' });
  });

  it('usa los lados verticales cuando el destino está arriba o abajo', () => {
    expect(autoSides(rect(0, 0), rect(0, 400))).toEqual({ from: 'bottom', to: 'top' });
    expect(autoSides(rect(0, 400), rect(0, 0))).toEqual({ from: 'top', to: 'bottom' });
  });

  it('en diagonal manda el eje más grande', () => {
    expect(autoSides(rect(0, 0), rect(400, 120)).from).toBe('right');
    expect(autoSides(rect(0, 0), rect(120, 400)).from).toBe('bottom');
  });
});

describe('resolveEndpoint', () => {
  it('respeta el lado fijado a mano', () => {
    expect(resolveEndpoint(createEndpoint({ side: 'top' }), rect(10, 20, 100, 50))).toEqual({
      point: { x: 60, y: 20 },
      side: 'top',
    });
  });

  it('resuelve `auto` mirando al otro rectángulo', () => {
    const from = resolveEndpoint(createEndpoint({ side: 'auto' }), rect(0, 0, 100, 100), rect(400, 0, 100, 100));
    expect(from.side).toBe('right');
    expect(from.point).toEqual({ x: 100, y: 50 });
  });

  it('sin rectángulo devuelve el punto libre', () => {
    const endpoint = createEndpoint({ point: { x: 33, y: 44 } });
    expect(resolveEndpoint(endpoint, null)).toEqual({ point: { x: 33, y: 44 }, side: null });
  });

  it('sin lado ni referencia cae a la derecha', () => {
    expect(resolveEndpoint(createEndpoint(), rect(0, 0, 100, 100)).side).toBe('right');
  });
});

describe('connectorGeometry', () => {
  const from = resolveEndpoint(createEndpoint({ side: 'right' }), rect(0, 0, 200, 100));
  const to = resolveEndpoint(createEndpoint({ side: 'left' }), rect(500, 0, 200, 100));

  it('la línea recta es M…L con los mismos extremos', () => {
    const geo = connectorGeometry(from, to, { ...DEFAULT_CONNECTOR_STYLE, curve: 'straight' });
    expect(geo.path).toBe('M 200 50 L 500 50');
    expect(geo.start).toEqual({ x: 200, y: 50 });
    expect(geo.end).toEqual({ x: 500, y: 50 });
  });

  it('la curva sale del borde en la dirección de su lado', () => {
    const geo = connectorGeometry(from, to, { ...DEFAULT_CONNECTOR_STYLE, curve: 'curved', tension: 0.5 });
    expect(geo.path.startsWith('M 200 50 C ')).toBe(true);
    // El primer control está a la derecha del inicio y a la misma altura.
    expect(geo.control1.y).toBeCloseTo(50);
    expect(geo.control1.x).toBeGreaterThan(200);
    // El segundo, a la izquierda del final.
    expect(geo.control2.x).toBeLessThan(500);
    expect(geo.control2.x).toBeGreaterThan(200);
  });

  it('la etiqueta va en el punto medio de la curva', () => {
    const geo = connectorGeometry(from, to, { ...DEFAULT_CONNECTOR_STYLE, curve: 'straight' });
    expect(geo.labelPoint).toEqual({ x: 350, y: 50 });
    expect(pointOnPath(geo, 0.5)).toEqual(geo.labelPoint);
    expect(pointOnPath(geo, 0)).toEqual(geo.start);
    expect(pointOnPath(geo, 1)).toEqual(geo.end);
  });

  it('las puntas apuntan hacia fuera de cada extremo', () => {
    const geo = connectorGeometry(from, to, { ...DEFAULT_CONNECTOR_STYLE, curve: 'straight' });
    expect(geo.startDirection.x).toBeCloseTo(1);
    expect(geo.endDirection.x).toBeCloseTo(1);
  });

  it('la tensión separa la curva de la recta', () => {
    const poca = connectorGeometry(from, to, { ...DEFAULT_CONNECTOR_STYLE, tension: 0.05 });
    const mucha = connectorGeometry(from, to, { ...DEFAULT_CONNECTOR_STYLE, tension: 1 });
    expect(mucha.control1.x).toBeGreaterThan(poca.control1.x);
  });
});

describe('aciertos y medidas', () => {
  const geo = connectorGeometry(
    resolveEndpoint(createEndpoint({ side: 'right' }), rect(0, 0, 200, 100)),
    resolveEndpoint(createEndpoint({ side: 'left' }), rect(500, 0, 200, 100)),
    { ...DEFAULT_CONNECTOR_STYLE, curve: 'straight' },
  );

  it('un punto sobre la línea acierta y uno lejano no', () => {
    expect(distanceToPath(geo, { x: 350, y: 50 })).toBeCloseTo(0, 1);
    expect(hitsPath(geo, { x: 350, y: 52 })).toBe(true);
    expect(hitsPath(geo, { x: 350, y: 90 })).toBe(false);
  });

  it('el grosor del trazo amplía la tolerancia', () => {
    const fino = { ...DEFAULT_CONNECTOR_STYLE, width: 1 };
    const grueso = { ...DEFAULT_CONNECTOR_STYLE, width: 20 };
    const punto = { x: 350, y: 62 }; // 12 px por debajo de la línea
    expect(hitsPath(geo, punto, 6, fino)).toBe(false); // 6 + 1 < 12
    expect(hitsPath(geo, punto, 6, grueso)).toBe(true); // 6 + 20 >= 12
  });

  it('la caja envolvente contiene los extremos', () => {
    const bounds = connectorBounds(geo);
    expect(bounds.x).toBeLessThanOrEqual(200);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(500);
    expect(bounds.y).toBeCloseTo(50);
    expect(bounds.height).toBeCloseTo(0);
  });
});

describe('estilo', () => {
  it('el patrón de guiones depende del trazo', () => {
    expect(dashArray(DEFAULT_CONNECTOR_STYLE)).toBeUndefined();
    expect(dashArray({ ...DEFAULT_CONNECTOR_STYLE, dash: 'dashed', width: 2 })).toBe('6 4');
    expect(dashArray({ ...DEFAULT_CONNECTOR_STYLE, dash: 'dotted', width: 2 })).toBe('0 4.4');
  });
});

describe('createConnector', () => {
  it('crea con estilo por defecto y lo sobrescribe', () => {
    const connector = createConnector('c1', { elementId: 'el_1' }, { elementId: 'el_2' }, { now: 1000 });
    expect(connector.style).toEqual(DEFAULT_CONNECTOR_STYLE);
    expect(connector.createdAt).toBe(1000);
    expect(isAttached(connector.from)).toBe(true);
    expect(isAttached(connector.to)).toBe(true);

    const libre = createConnector('c2', {}, { point: { x: 10, y: 10 } }, { style: { color: 'red' }, now: 5 });
    expect(isAttached(libre.from)).toBe(false);
    expect(isAttached(libre.to)).toBe(false);
    expect(libre.style.color).toBe('red');
    expect(libre.style.curve).toBe('curved');
  });

  it('acepta estilo parcial', () => {
    const connector = createConnector('c3', {}, {}, { style: { color: 'red', endArrow: 'none' } });
    expect(connector.style.color).toBe('red');
    expect(connector.style.endArrow).toBe('none');
    expect(connector.style.curve).toBe('curved');
  });

  it('un extremo libre guarda su punto', () => {
    const endpoint = createEndpoint({ point: { x: 7, y: 8 } });
    expect(endpoint).toEqual({ elementId: null, point: { x: 7, y: 8 }, side: 'auto', offset: 0.5 });
  });
});

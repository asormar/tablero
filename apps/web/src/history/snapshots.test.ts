/**
 * Pruebas del historial de versiones (fase 4, punto 4): normalización de la
 * respuesta del servidor y fechas legibles.
 */

import { describe, expect, it } from 'vitest';

import { describeSnapshot, normalizeVersions, toTimestamp, versionDelta } from './snapshots';

describe('toTimestamp', () => {
  it('acepta milisegundos', () => {
    expect(toTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('pasa segundos de Unix a milisegundos', () => {
    expect(toTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
  });

  it('acepta ISO-8601 y números en texto', () => {
    expect(toTimestamp('2026-09-17T10:00:00.000Z')).toBe(Date.parse('2026-09-17T10:00:00.000Z'));
    expect(toTimestamp('1700000000')).toBe(1_700_000_000_000);
  });

  it('devuelve null con basura', () => {
    expect(toTimestamp('ayer')).toBeNull();
    expect(toTimestamp(null)).toBeNull();
    expect(toTimestamp({})).toBeNull();
  });
});

describe('normalizeVersions', () => {
  it('acepta { versions } y ordena de más nueva a más vieja', () => {
    const versions = normalizeVersions({
      versions: [
        { id: 'v1', createdAt: 1_700_000_000_000, title: 'A', elementCount: 3 },
        { id: 'v2', createdAt: 1_700_000_600_000, title: 'A', elementCount: 5 },
      ],
    });
    expect(versions.map((version) => version.id)).toEqual(['v2', 'v1']);
    expect(versions[0]?.elementCount).toBe(5);
  });

  it('acepta { snapshots } con `elements` y `size`', () => {
    const versions = normalizeVersions({
      snapshots: [{ id: 's1', snapshotAt: 1_700_000_000, elements: 7, size: 2048 }],
    });
    expect(versions[0]).toMatchObject({ id: 's1', elementCount: 7, sizeBytes: 2048 });
  });

  it('usa el título de la previsualización si el principal falta', () => {
    const versions = normalizeVersions({ versions: [{ id: 'v1', preview: { title: 'Vista', elementCount: 2 } }] });
    expect(versions[0]?.title).toBe('Vista');
    expect(versions[0]?.elementCount).toBe(2);
  });

  it('descarta filas sin id', () => {
    expect(normalizeVersions({ versions: [{ title: 'sin id' }, null, 4] })).toEqual([]);
  });

  it('devuelve vacío con formas inesperadas', () => {
    expect(normalizeVersions(null)).toEqual([]);
    expect(normalizeVersions({})).toEqual([]);
  });
});

describe('describeSnapshot', () => {
  const now = Date.parse('2026-09-17T18:00:00.000Z');

  it('usa «hoy» con la hora', () => {
    const value = describeSnapshot(Date.parse('2026-09-17T12:30:00.000Z'), 'es', now);
    expect(value.startsWith('hoy,')).toBe(true);
  });

  it('usa «ayer»', () => {
    const value = describeSnapshot(Date.parse('2026-09-16T09:05:00.000Z'), 'es', now);
    expect(value.startsWith('ayer,')).toBe(true);
  });

  it('con más de una semana muestra la fecha corta', () => {
    const value = describeSnapshot(Date.parse('2026-08-01T09:05:00.000Z'), 'es', now);
    expect(value).not.toContain('hoy');
    expect(value).not.toContain('ayer');
    expect(value).toMatch(/2026/);
  });

  it('en inglés usa today / yesterday', () => {
    expect(describeSnapshot(Date.parse('2026-09-17T12:30:00.000Z'), 'en', now).startsWith('today,')).toBe(true);
    expect(describeSnapshot(Date.parse('2026-09-16T12:30:00.000Z'), 'en', now).startsWith('yesterday,')).toBe(true);
  });

  it('con una fecha inválida devuelve un guion', () => {
    expect(describeSnapshot(Number.NaN, 'es', now)).toBe('—');
  });
});

describe('versionDelta', () => {
  const versions = [
    { id: 'v2', createdAt: 2, title: '', elementCount: 8, sizeBytes: null },
    { id: 'v1', createdAt: 1, title: '', elementCount: 5, sizeBytes: null },
  ];

  it('compara con la versión anterior', () => {
    expect(versionDelta(versions, 0)).toBe(3);
    expect(versionDelta(versions, 1)).toBeNull();
  });
});

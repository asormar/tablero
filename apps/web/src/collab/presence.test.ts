/**
 * Presencia: color de cursor por usuario y lectura del estado de awareness.
 *
 * El color tiene que ser **estable y repartido**: dos usuarios distintos no
 * pueden coincidir siempre en el mismo token, y el mismo usuario tiene que ver
 * el mismo color en cada sesión.
 */

import { describe, expect, it } from 'vitest';

import {
  CURSOR_TOKENS,
  PRESENCE_TTL_MS,
  cursorColorFor,
  cursorScreenPoint,
  cursorTokenFor,
  cursorVisible,
  hashUserId,
  livePresence,
  presenceInitials,
  readRemotePresence,
  uniqueByUser,
  watchersLabel,
} from './presence';

describe('presencia · color del cursor', () => {
  it('el mismo usuario siempre tiene el mismo color', () => {
    const first = cursorTokenFor('user-ana-123');
    expect(cursorTokenFor('user-ana-123')).toBe(first);
    expect(cursorColorFor('user-ana-123')).toBe(cursorColorFor('user-ana-123'));
  });

  it('reparte los ocho tokens de la paleta', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) seen.add(cursorTokenFor(`user-${index}`));
    expect(seen.size).toBe(CURSOR_TOKENS.length);
  });

  it('usuarios distintos no comparten color siempre', () => {
    expect(cursorTokenFor('ana')).not.toBe(cursorTokenFor('bruno'));
  });

  it('el hash es estable y no negativo', () => {
    expect(hashUserId('abc')).toBe(hashUserId('abc'));
    expect(hashUserId('abc')).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hashUserId('abc'))).toBe(true);
  });

  it('devuelve un color del tema pedido', () => {
    expect(cursorColorFor('ana', 'light')).toMatch(/^#/);
    expect(cursorColorFor('ana', 'dark')).toMatch(/^#/);
  });
});

describe('presencia · lectura de awareness', () => {
  const states = new Map<number, unknown>([
    [
      11,
      {
        user: { id: 'u1', name: 'Ana', color: '#2F6FC9' },
        cursor: { x: 120, y: 80 },
        selection: ['el1', 'el2'],
        editingId: 'el2',
        at: 1_000,
      },
    ],
    [
      22,
      {
        user: { id: 'u2', name: 'Bruno', color: null },
        cursor: null,
        selection: [],
        editingId: null,
        at: 1_000,
      },
    ],
  ]);

  it('lee los estados ajenos y descarta el propio', () => {
    const all = readRemotePresence(states, 99, 1_000);
    expect(all).toHaveLength(2);
    const withoutSelf = readRemotePresence(states, 11, 1_000);
    expect(withoutSelf.map((entry) => entry.userId)).toEqual(['u2']);
  });

  it('normaliza los campos presentes', () => {
    const [ana] = readRemotePresence(states, 99, 1_000);
    expect(ana).toMatchObject({
      clientId: 11,
      userId: 'u1',
      name: 'Ana',
      color: '#2F6FC9',
      cursor: { x: 120, y: 80 },
      selection: ['el1', 'el2'],
      editingId: 'el2',
    });
  });

  it('un estado con forma rara no rompe la lectura', () => {
    const weird = new Map<number, unknown>([
      [1, null],
      [2, { user: {} }],
      [3, { user: { id: 'u3' }, cursor: { x: 'a', y: 2 }, selection: 'no' }],
      [4, 'texto'],
    ]);
    const result = readRemotePresence(weird, null, 5_000);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ userId: 'u3', cursor: null, selection: [], name: 'Alguien' });
  });

  it('descarta cursores con NaN o infinito', () => {
    const bad = new Map<number, unknown>([
      [7, { user: { id: 'u' }, cursor: { x: Number.NaN, y: 3 } }],
    ]);
    expect(readRemotePresence(bad, null, 0)[0]?.cursor).toBeNull();
  });
});

describe('presencia · vigencia y agrupación', () => {
  it('descarta latidos vencidos', () => {
    const now = 1_000_000;
    const entries = [
      { clientId: 1, userId: 'a', name: 'A', color: null, cursor: null, selection: [], editingId: null, at: now - 10 },
      { clientId: 2, userId: 'b', name: 'B', color: null, cursor: null, selection: [], editingId: null, at: now - PRESENCE_TTL_MS - 1 },
    ];
    expect(livePresence(entries, now).map((entry) => entry.userId)).toEqual(['a']);
  });

  it('deja una entrada por usuario (la más reciente)', () => {
    const entries = [
      { clientId: 1, userId: 'a', name: 'A', color: null, cursor: null, selection: [], editingId: null, at: 10 },
      { clientId: 2, userId: 'a', name: 'A', color: null, cursor: null, selection: [], editingId: null, at: 30 },
      { clientId: 3, userId: 'b', name: 'B', color: null, cursor: null, selection: [], editingId: null, at: 20 },
    ];
    const unique = uniqueByUser(entries);
    expect(unique).toHaveLength(2);
    expect(unique.find((entry) => entry.userId === 'a')?.clientId).toBe(2);
  });
});

describe('presencia · geometría y etiquetas', () => {
  const viewport = { x: 100, y: 50, scale: 2 };

  it('convierte el punto de mundo a pantalla', () => {
    expect(cursorScreenPoint({ x: 60, y: 40 }, viewport)).toEqual({ x: -80, y: -20 });
  });

  it('marca fuera de vista un cursor lejano', () => {
    expect(cursorVisible({ x: 1_000, y: 1_000 }, viewport, { width: 800, height: 600 })).toBe(false);
    expect(cursorVisible({ x: 60, y: 40 }, viewport, { width: 800, height: 600 })).toBe(true);
  });

  it('iniciales de un nombre', () => {
    expect(presenceInitials('Ana')).toBe('AN');
    expect(presenceInitials('Ana Pérez')).toBe('AP');
    expect(presenceInitials('  ')).toBe('?');
  });

  it('etiqueta de quién está mirando', () => {
    expect(watchersLabel([])).toBe('');
    expect(watchersLabel(['Ana'])).toBe('Ana');
    expect(watchersLabel(['Ana', 'Bruno'])).toBe('Ana y Bruno');
    expect(watchersLabel(['Ana', 'Bruno', 'Carla'])).toBe('Ana y 2 más');
    expect(watchersLabel(['Ana', 'Ana'])).toBe('Ana');
  });
});

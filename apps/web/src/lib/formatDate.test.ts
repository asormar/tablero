import { describe, expect, it } from 'vitest';

import { daysUntil, formatDate, formatDateTime, formatExpiry, formatRelativeDays } from './formatDate';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe('daysUntil', () => {
  it('redondea a días enteros', () => {
    expect(daysUntil(NOW + 3 * DAY, NOW)).toBe(3);
    expect(daysUntil(NOW + 2.6 * DAY, NOW)).toBe(3);
    expect(daysUntil(NOW - DAY, NOW)).toBe(-1);
  });
});

describe('formatRelativeDays', () => {
  it('usa Intl.RelativeTimeFormat con el idioma activo', () => {
    expect(formatRelativeDays(0, 'es')).toBe('hoy');
    expect(formatRelativeDays(1, 'es')).toBe('mañana');
    expect(formatRelativeDays(3, 'es')).toMatch(/3 días/);
    expect(formatRelativeDays(1, 'en')).toBe('tomorrow');
    expect(formatRelativeDays(3, 'en')).toBe('in 3 days');
  });
});

describe('formatExpiry', () => {
  it('sin fecha, sin caducidad', () => {
    expect(formatExpiry(null, NOW, 'es')).toBe('sin caducidad');
    expect(formatExpiry(null, NOW, 'en')).toBe('no expiry');
  });

  it('una fecha pasada está caducada', () => {
    expect(formatExpiry(NOW - 1000, NOW, 'es')).toBe('caducada');
    expect(formatExpiry(NOW, NOW, 'en')).toBe('expired');
  });

  it('hoy, mañana y dentro de N días', () => {
    expect(formatExpiry(NOW + 2 * 60 * 60 * 1000, NOW, 'es')).toBe('vence hoy');
    expect(formatExpiry(NOW + DAY, NOW, 'es')).toBe('vence mañana');
    expect(formatExpiry(NOW + 7 * DAY, NOW, 'es')).toMatch(/^vence .*7 días$/);
    expect(formatExpiry(NOW + 7 * DAY, NOW, 'en')).toBe('expires in 7 days');
  });

  it('cae al español con un idioma desconocido', () => {
    expect(formatExpiry(null, NOW, 'fr')).toBe('sin caducidad');
  });
});

describe('formatDate y formatDateTime', () => {
  it('formatean con Intl y el idioma pedido', () => {
    const at = Date.UTC(2026, 9, 27, 12, 0, 0);
    expect(formatDate(at, 'en')).toMatch(/Oct/);
    expect(formatDate(at, 'es')).toMatch(/oct/i);
    expect(formatDate(at, 'es')).toMatch(/2026/);
    expect(formatDateTime(at, 'en')).toMatch(/2026/);
  });

  it('una fecha inválida da cadena vacía', () => {
    expect(formatDate('no es una fecha', 'es')).toBe('');
    expect(formatDateTime(Number.NaN, 'es')).toBe('');
  });
});

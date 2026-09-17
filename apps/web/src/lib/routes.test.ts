/**
 * Rutas de la fase 5: `/p/:slug` (vista pública) y `/invite/:token`.
 *
 * Lo que importa: que la ruta se reconozca con barra final o sin ella, que un
 * segmento con caracteres raros no rompa el parseo y que **cualquier otra URL
 * caiga en la aplicación** (nunca pantalla en blanco).
 */

import { describe, expect, it } from 'vitest';

import { appUrl, inviteUrl, parseRoute, publicBoardUrl } from './routes';

describe('rutas · vista pública', () => {
  it('reconoce /p/:slug', () => {
    expect(parseRoute('/p/abc123')).toEqual({ kind: 'public', slug: 'abc123' });
  });

  it('tolera la barra final y el query', () => {
    expect(parseRoute('/p/abc123/')).toEqual({ kind: 'public', slug: 'abc123' });
    expect(parseRoute('/p/abc123?x=1')).toEqual({ kind: 'public', slug: 'abc123' });
  });

  it('decodifica el slug', () => {
    expect(parseRoute('/p/a%20b')).toEqual({ kind: 'public', slug: 'a b' });
  });

  it('sin slug cae en la aplicación', () => {
    expect(parseRoute('/p/')).toEqual({ kind: 'app' });
    expect(parseRoute('/p')).toEqual({ kind: 'app' });
  });

  it('arma la URL pública', () => {
    expect(publicBoardUrl('abc', 'http://localhost:5185')).toBe('http://localhost:5185/p/abc');
    expect(publicBoardUrl('a b', 'http://localhost:5185/')).toBe('http://localhost:5185/p/a%20b');
  });
});

describe('rutas · invitación', () => {
  it('reconoce /invite/:token', () => {
    expect(parseRoute('/invite/tok_123')).toEqual({ kind: 'invite', token: 'tok_123' });
    expect(parseRoute('/invite/tok_123/')).toEqual({ kind: 'invite', token: 'tok_123' });
  });

  it('sin token cae en la aplicación', () => {
    expect(parseRoute('/invite')).toEqual({ kind: 'app' });
    expect(parseRoute('/invite/')).toEqual({ kind: 'app' });
  });

  it('arma la URL de invitación', () => {
    expect(inviteUrl('tok', 'http://localhost:5185')).toBe('http://localhost:5185/invite/tok');
  });
});

describe('rutas · aplicación', () => {
  it('cualquier otra ruta es la aplicación', () => {
    expect(parseRoute('/')).toEqual({ kind: 'app' });
    expect(parseRoute('/algo/desconocido')).toEqual({ kind: 'app' });
    expect(parseRoute('')).toEqual({ kind: 'app' });
  });

  it('la vuelta a la aplicación conserva el tablero', () => {
    expect(appUrl(null, 'http://localhost:5185')).toBe('http://localhost:5185/');
    expect(appUrl('bd_1', 'http://localhost:5185')).toBe('http://localhost:5185/?board=bd_1');
  });
});

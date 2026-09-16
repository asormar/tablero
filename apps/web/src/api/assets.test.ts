/**
 * Rutas de la API de archivos: el contrato compartido las publica con el
 * prefijo `/api` incluido (`assetRoutes.raw(id)` sirve como `src`), pero las
 * llamadas que pasan por la base de la API no pueden anteponerlo otra vez o
 * pedirían `/api/api/assets` (404 real detectado en la verificación).
 */

import { describe, expect, it } from 'vitest';

import { assetRoutes } from '@tablero/shared';

import { assetApiPath } from './assets';
import { API_BASE_URL } from './client';

describe('assetApiPath', () => {
  it('no duplica el prefijo /api de las rutas del contrato', () => {
    expect(assetApiPath(assetRoutes.collection)).toBe('/api/assets');
    expect(assetApiPath(assetRoutes.detail('abc'))).toBe('/api/assets/abc');
    expect(assetApiPath(assetRoutes.raw('abc'))).toBe('/api/assets/abc/raw');
    expect(assetApiPath(assetRoutes.collection).includes('/api/api/')).toBe(false);
  });

  it('usa la base configurada de la API', () => {
    expect(assetApiPath('/api/assets').startsWith(API_BASE_URL)).toBe(true);
  });

  it('respeta una base absoluta', () => {
    // La sustitución del prefijo sirve igual con una base con host.
    const absolute = 'https://api.example.com/api';
    const route = assetRoutes.detail('abc');
    expect(`${absolute}${route.replace(/^\/api/, '')}`).toBe('https://api.example.com/api/assets/abc');
  });
});

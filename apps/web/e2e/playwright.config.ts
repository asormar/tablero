import { defineConfig, devices } from '@playwright/test';

import { API_ORIGIN, API_PORT, E2E_DATABASE_URL, WEB_ORIGIN, WEB_PORT } from './env';

/**
 * Configuración propia de la batería de punta a punta (fase 6, «Agente B»).
 *
 * Arranca las dos piezas que necesita —el API en el 8950 con la base `f6e2e` y la
 * web de prueba (build + preview) en el 5190— y las apaga al terminar. La web de
 * prueba proxea `/api` y `/collab` al API de prueba (`API_PROXY_TARGET`), así que
 * el navegador solo habla con `http://localhost:5190`.
 *
 * Las esperas son siempre por elemento o por estado (`expect`, `waitFor*`): no
 * hay `waitForTimeout` en ninguna prueba.
 */
export default defineConfig({
  // `testDir` por defecto: el directorio de este archivo (`apps/web/e2e`).
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS ?? 1),
  retries: Number(process.env.E2E_RETRIES ?? 0),
  reporter: [
    ['list'],
    ['html', { outputFolder: 'report', open: 'never' }],
  ],
  globalTeardown: './global-teardown.ts',

  use: {
    baseURL: WEB_ORIGIN,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    // El build de la web registra un service worker (PWA): en las pruebas se
    // bloquea para que nunca sirva una cáscara cacheada entre corridas.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // Migraciones + plantillas del sistema + API. Idempotente: se puede correr
      // las veces que haga falta sobre la misma base.
      command:
        'pnpm --filter @tablero/api exec prisma migrate deploy && ' +
        'pnpm --filter @tablero/api seed:templates && ' +
        'pnpm --filter @tablero/api start',
      url: `${API_ORIGIN}/api/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        DATABASE_URL: E2E_DATABASE_URL,
        APP_ORIGIN: WEB_ORIGIN,
        ALLOWED_ORIGINS: WEB_ORIGIN,
        LOG_LEVEL: process.env.E2E_API_LOG_LEVEL ?? 'warn',
      },
    },
    {
      // Build propio (`dist-e2e`) y preview en el 5190: así la suite no depende
      // del dev server ni pisa el `dist/` que usan el resto de las verificaciones.
      // `VITE_COLLAB_URL` apunta al WebSocket de **esta** instancia del API (el
      // valor por defecto es el 8787 del desarrollo): sin esto el documento nunca
      // sincronizaría con el servidor de prueba.
      command: 'pnpm run build:e2e && pnpm run preview:e2e',
      url: WEB_ORIGIN,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        PREVIEW_PORT: String(WEB_PORT),
        API_PROXY_TARGET: API_ORIGIN,
        VITE_COLLAB_URL: `${API_ORIGIN.replace(/^http/, 'ws')}/collab`,
      },
    },
  ],
});

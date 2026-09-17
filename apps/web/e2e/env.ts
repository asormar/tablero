/**
 * Entorno de la batería de punta a punta (fase 6).
 *
 * La suite corre contra una instancia **propia**, nunca contra el API del 8787
 * ni el Vite del 5173 del desarrollo:
 *
 *   - API de prueba:  http://localhost:8950  (base `f6e2e`)
 *   - web de prueba:  http://localhost:5190  (build + preview, no el dev server)
 *
 * Los valores se pueden pisar por variable de entorno para reproducir la corrida
 * en otra máquina (por ejemplo otra base o el contenedor de Postgres con otro
 * nombre).
 */

export const API_PORT = Number(process.env.E2E_API_PORT ?? 8950);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5190);

export const API_ORIGIN = `http://localhost:${API_PORT}`;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

/** Base de datos propia de la suite (se migra y se siembra al arrancar). */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://tablero:tablero@localhost:5433/f6e2e';

/** Nombre de la base dentro del contenedor (para la limpieza final). */
export const E2E_DATABASE_NAME = new URL(E2E_DATABASE_URL).pathname.replace(/^\//, '') || 'f6e2e';

/** Contenedor de Postgres de desarrollo (`docker/docker-compose.yml`). */
export const POSTGRES_CONTAINER = process.env.E2E_POSTGRES_CONTAINER ?? 'tablero-postgres';

/**
 * Primera parte de todas las cuentas de prueba: la limpieza final borra usuarios
 * por este prefijo (el API no expone un «borrar cuenta»).
 */
export const TEST_EMAIL_PREFIX = 'e2e-';

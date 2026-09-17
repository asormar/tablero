import { execFileSync } from 'node:child_process';

import { E2E_DATABASE_NAME, POSTGRES_CONTAINER, TEST_EMAIL_PREFIX } from './env';

/**
 * Limpieza final de la corrida (fase 6, «Agente B»).
 *
 * Los tableros, archivos y elementos que crea cada prueba se borran al terminar
 * esa prueba por la propia API. Lo único que no se puede borrar por API son las
 * **cuentas** (no hay `DELETE /api/account`), así que el cierre las borra de la
 * base de prueba: la cascada de Postgres se lleva sesiones, tableros, documentos,
 * versiones, índice de búsqueda, tarjetas y notificaciones.
 *
 * Nunca falla la corrida: si Docker no está disponible, avisa y sigue.
 */
export default async function globalTeardown(): Promise<void> {
  const sql = `DELETE FROM "User" WHERE email LIKE '${TEST_EMAIL_PREFIX}%';`;
  try {
    const output = execFileSync(
      'docker',
      [
        'exec',
        POSTGRES_CONTAINER,
        'psql',
        '-U',
        'tablero',
        '-d',
        E2E_DATABASE_NAME,
        '-v',
        'ON_ERROR_STOP=1',
        '-t',
        '-c',
        sql,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const result = output.trim().split('\n').pop() ?? '';
    console.log(`[e2e] limpieza final en ${E2E_DATABASE_NAME}: ${result || 'sin cuentas de prueba'}`);
  } catch (error) {
    console.warn(
      `[e2e] no se pudo borrar las cuentas de prueba (¿está ${POSTGRES_CONTAINER} corriendo?): ${
        error instanceof Error ? error.message.split('\n')[0] : String(error)
      }`,
    );
  }
}

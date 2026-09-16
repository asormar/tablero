/**
 * Semilla de desarrollo: crea (si no existe) una cuenta demo con su tablero
 * raíz. Idempotente: se puede correr varias veces.
 *
 *   pnpm --filter @tablero/api seed
 */

import { prisma } from './db.js';
import { assertRuntimeEnv } from './env.js';
import { createUserWithRootBoard } from './lib/users.js';

const DEMO = {
  email: 'demo@tablero.test',
  name: 'Cuenta demo',
  password: 'demo-tablero-2026',
};

async function main(): Promise<void> {
  assertRuntimeEnv();
  const existing = await prisma.user.findUnique({ where: { email: DEMO.email }, select: { id: true } });
  if (existing) {
    console.log(`La cuenta ${DEMO.email} ya existe (${existing.id}); no se toca.`);
    return;
  }
  const { user, rootBoard } = await createUserWithRootBoard(DEMO);
  console.log(`Cuenta demo creada: ${user.email} (${user.id})`);
  console.log(`Tablero raíz: ${rootBoard.id} — "${rootBoard.title}"`);
  console.log(`Contraseña: ${DEMO.password}`);
}

main()
  .catch((error: unknown) => {
    console.error('La semilla falló:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

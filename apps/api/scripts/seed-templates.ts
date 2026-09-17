/**
 * Semilla de las plantillas del sistema (§7.1 del plan).
 *
 *   pnpm --filter @tablero/api seed:templates
 *
 * Crea (si faltan) las doce plantillas del sistema con su tablero y su
 * documento Yjs de verdad: tarjetas, notas de instrucciones, tablas, columnas,
 * mapas y subtableros. Idempotente: las que ya existen se dejan como están.
 *
 * Las plantillas del sistema cuelgan de un usuario de sistema (contraseña
 * aleatoria que no se imprime ni se guarda), así que nadie puede entrar a su
 * cuenta: se usan solo a través de `POST /api/templates/:id/instantiate`.
 */

import { prisma } from '../src/db.js';
import { assertRuntimeEnv } from '../src/env.js';
import { seedSystemTemplates } from '../src/lib/templates.js';

async function main(): Promise<void> {
  assertRuntimeEnv();
  const result = await seedSystemTemplates();
  console.log(`Plantillas del sistema (usuario ${result.systemUserId}):`);
  for (const name of result.created) console.log(`  + ${name}`);
  for (const name of result.skipped) console.log(`  = ${name} (ya existía)`);
  const total = await prisma.template.count({ where: { ownerId: null } });
  console.log(`${total} plantillas del sistema en la base.`);
}

main()
  .catch((error: unknown) => {
    console.error('La semilla de plantillas falló:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

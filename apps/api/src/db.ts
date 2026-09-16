/** Cliente Prisma compartido por toda la API. */

import { PrismaClient } from '@prisma/client';

import { env } from './env.js';

export const prisma = new PrismaClient({
  log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

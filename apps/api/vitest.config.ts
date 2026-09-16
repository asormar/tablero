import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Los tests no tocan la base ni la red real: `vi.mock('../db.js')` dobla
    // Prisma y el transporte HTTP se inyecta donde hace falta.
    testTimeout: 20_000,
  },
});

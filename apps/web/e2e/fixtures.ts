/**
 * Fixtures de la batería: una cuenta nueva por prueba, su cliente de API y la
 * página con la sesión ya inyectada.
 *
 * La sesión se inyecta como cookie (la misma que deja el registro) en vez de
 * pasar por el formulario en cada prueba: los flujos que sí prueban el formulario
 * están en `auth.spec.ts`. Cada prueba trabaja con una cuenta distinta, así que
 * las pruebas no se pisan entre sí aunque corran en paralelo.
 */

import {
  test as base,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

import { cleanupAccountData, createTestAccount, type TestAccount } from './helpers/api';

type Fixtures = {
  /** Sesión interna: cuenta + cliente autenticado (registro por API). */
  session: { account: TestAccount; api: APIRequestContext };
  /** Cuenta nueva de esta prueba, con su tablero raíz. */
  account: TestAccount;
  /** Cliente HTTP autenticado contra el API de prueba. */
  api: APIRequestContext;
  /** Página con la cookie de sesión de la cuenta inyectada. */
  app: Page;
};

export const test = base.extend<Fixtures>({
  session: async ({}, use) => {
    const created = await createTestAccount();
    try {
      await use(created);
    } finally {
      try {
        await cleanupAccountData(created.api);
      } catch (error) {
        console.warn(
          `[e2e] limpieza de la prueba incompleta: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await created.api.dispose();
    }
  },

  account: async ({ session }, use) => {
    await use(session.account);
  },

  api: async ({ session }, use) => {
    await use(session.api);
  },

  app: async ({ account, context, page }, use) => {
    await context.addCookies(account.cookies);
    await use(page);
  },
});

export { expect } from '@playwright/test';
export type { TestAccount } from './helpers/api';

/**
 * Registro e ingreso (fase 6, «Agente B»).
 *
 * El panel de acceso aparece cuando la API está viva y no hay sesión. Se prueban
 * los dos caminos **por la interfaz** (el resto de las pruebas usa la cookie que
 * deja el registro por API) y se comprueba contra la API que la sesión es real.
 */

import { createTestAccount } from './helpers/api';
import { expect, test } from './fixtures';
import { waitForWorkspace } from './helpers/app';
import { uniqueEmail } from './helpers/api';

test.describe('registro e ingreso', () => {
  test('el registro desde la interfaz crea la cuenta y abre el tablero raíz', async ({ page }) => {
    const email = uniqueEmail('registro');
    const password = 'prueba-e2e-1234';

    await page.goto('/');
    await expect(page.getByRole('tab', { name: 'Crear cuenta' })).toBeVisible();
    await page.getByRole('tab', { name: 'Crear cuenta' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Nombre').fill('Persona De Prueba');
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();

    // El panel de acceso desaparece y entra el espacio de trabajo.
    await waitForWorkspace(page);
    await expect(page.getByLabel('Título del tablero')).toHaveValue('Inicio');

    // La sesión es real: la API responde con este usuario y su tablero raíz.
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    const session = (await me.json()) as {
      user: { email: string; name: string };
      boards: { id: string; parentBoardId: string | null; title: string }[];
    };
    expect(session.user.email).toBe(email);
    expect(session.user.name).toBe('Persona De Prueba');
    const root = session.boards.find((board) => board.parentBoardId === null);
    expect(root?.title).toBe('Inicio');
  });

  test('el ingreso rechaza la contraseña incorrecta y entra con la correcta', async ({ page }) => {
    const { account } = await createTestAccount('ingreso');

    await page.goto('/');
    await expect(page.getByRole('tab', { name: 'Entrar' })).toHaveAttribute('aria-selected', 'true');

    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Contraseña').fill('contraseña-equivocada');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toHaveText('Email o contraseña incorrectos.');

    await page.getByLabel('Contraseña').fill(account.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await waitForWorkspace(page);

    // Entra al tablero raíz de *su* cuenta.
    const boardId = new URL(page.url()).searchParams.get('board');
    expect(boardId).toBe(account.rootBoardId);
  });
});

/**
 * Búsqueda global con `Ctrl+K` (fase 6, «Agente B»).
 *
 * La nota vive en un tablero **distinto** del que está abierto: así el resultado
 * solo puede venir del índice del servidor (los aciertos locales son siempre del
 * tablero abierto). Al elegir el resultado se abre su tablero y el elemento queda
 * resaltado.
 */

import { expect, test } from './fixtures';
import { boardIdFromUrl, createNote, openApp } from './helpers/app';
import { waitForPersisted } from './helpers/api';

test.describe('búsqueda global', () => {
  test('Ctrl+K encuentra la nota de otro tablero, lo abre y la resalta', async ({ app, api, account }) => {
    const marker = `Zarzamora${Date.now().toString(36)}`;
    const noteText = `Nota buscable ${marker}`;

    // Un tablero nuevo dentro de la raíz, con la nota dentro.
    const created = await api.post('/api/boards', {
      data: { parentBoardId: account.rootBoardId, title: 'Búsqueda e2e' },
    });
    expect(created.status()).toBe(201);
    const searchBoardId = ((await created.json()) as { board: { id: string } }).board.id;

    await openApp(app, searchBoardId);
    const note = await createNote(app, noteText);
    const elementId = (await note.getAttribute('data-element-id'))!;
    await waitForPersisted(api, searchBoardId, (board) => board.elements.some((item) => item.id === elementId));

    // El índice del servidor se escribe al persistir el documento: se espera a
    // que la búsqueda por API ya devuelva el acierto antes de usar la paleta.
    await expect
      .poll(
        async () => {
          const response = await api.get(`/api/search?q=${encodeURIComponent(marker)}&limit=20`);
          if (!response.ok()) return -1;
          const body = (await response.text()).includes(elementId);
          return body ? 1 : 0;
        },
        { timeout: 30_000 },
      )
      .toBe(1);

    // Vuelvo a la raíz: la nota ahora está en otro tablero.
    await openApp(app, account.rootBoardId);
    await expect(app.locator('[data-element-id]')).toHaveCount(0);

    await app.keyboard.press('Control+k');
    const palette = app.getByRole('dialog', { name: 'Paleta de comandos' });
    await expect(palette).toBeVisible();
    await palette.getByLabel('Buscar').fill(marker);

    const hit = palette.locator(`[data-palette-hit="${elementId}"]`);
    await expect(hit).toBeVisible({ timeout: 20_000 });
    await expect(hit).toContainText(marker);
    await hit.click();

    // La paleta se cierra, se abre el tablero del resultado…
    await expect(palette).toBeHidden();
    await expect(app.getByLabel('Título del tablero')).toHaveValue('Búsqueda e2e');
    expect(boardIdFromUrl(app)).toBe(searchBoardId);

    // …y el elemento queda resaltado (clase `is-flash` que pone FlashEffect).
    const landed = app.locator(`[data-element-id="${elementId}"]`);
    await expect(landed).toBeVisible({ timeout: 20_000 });
    await expect(landed).toHaveClass(/is-flash/, { timeout: 10_000 });
    await expect(landed).toContainText(marker);
  });
});

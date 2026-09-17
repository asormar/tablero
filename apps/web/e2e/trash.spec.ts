/**
 * Papelera (fase 6, «Agente B»).
 *
 * Borrar una nota con el teclado la manda a la papelera del panel lateral, desde
 * donde se restaura. Se comprueba el DOM antes y después, y el documento
 * persistido (la marca de borrado se va y el elemento vuelve a estar vivo).
 */

import { expect, test } from './fixtures';
import { cardById, createNote, openApp } from './helpers/app';
import { waitForPersisted } from './helpers/api';

test.describe('papelera', () => {
  test('borrar una nota y restaurarla desde el panel', async ({ app, api, account }) => {
    await openApp(app, account.rootBoardId);

    const text = `Nota a la papelera ${Date.now().toString(36)}`;
    const note = await createNote(app, text);
    const elementId = (await note.getAttribute('data-element-id'))!;

    // Borrar: la tarjeta sale del lienzo.
    await note.click();
    await expect(note).toHaveClass(/is-selected/);
    await app.keyboard.press('Delete');
    await expect(cardById(app, elementId)).toHaveCount(0);

    // El elemento está en la papelera de este tablero, con su título.
    await app.locator('.topbar').getByTitle('Papelera', { exact: true }).click();
    const row = app.locator(`[data-trash-element="${elementId}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(text);

    // Restaurar: vuelve al lienzo…
    await row.getByRole('button', { name: 'Restaurar' }).click();
    await expect(row).toHaveCount(0);
    await expect(cardById(app, elementId)).toBeVisible();

    // …y el servidor ya no la tiene marcada como borrada.
    const persisted = await waitForPersisted(
      api,
      account.rootBoardId,
      (board) => board.elements.find((element) => element.id === elementId)?.deletedAt === null,
    );
    expect(persisted.elements.find((element) => element.id === elementId)?.text).toContain(text);
  });
});

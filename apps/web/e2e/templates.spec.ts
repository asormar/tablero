/**
 * Tablero a partir de una plantilla del sistema (fase 6, «Agente B»).
 *
 * La galería (`apps/web/src/templates/TemplateGallery.tsx`) instancia la plantilla
 * por API: el servidor copia el documento Yjs completo. Se comprueba en el DOM
 * (el tablero se abre con sus tarjetas) y en el servidor (el documento persistido
 * tiene los elementos de la plantilla).
 */

import { expect, test } from './fixtures';
import { boardIdFromUrl, openApp } from './helpers/app';
import { readJson, waitForPersisted, type BoardSummaryJson } from './helpers/api';

const TEMPLATE_NAME = 'Lluvia de ideas';

test.describe('tablero desde plantilla', () => {
  test('crear un tablero desde una plantilla trae las tarjetas a la cuenta', async ({
    app,
    api,
    account,
  }) => {
    await openApp(app, account.rootBoardId);

    await app.locator('[data-topbar-templates]').click();
    const gallery = app.getByRole('dialog', { name: 'Nuevo desde plantilla' });
    await expect(gallery).toBeVisible();

    const card = gallery.locator('.template-card').filter({ hasText: TEMPLATE_NAME });
    await expect(card).toBeVisible();
    await card.click();

    // Se cierra la galería y el espacio de trabajo pasa al tablero nuevo.
    await expect(gallery).toBeHidden();
    await expect(app.getByLabel('Título del tablero')).toHaveValue(TEMPLATE_NAME);

    const boardId = boardIdFromUrl(app);
    expect(boardId).not.toBe(account.rootBoardId);

    // Las tarjetas de la plantilla están en el lienzo…
    await expect
      .poll(() => app.locator('[data-element-id]').count(), { timeout: 20_000 })
      .toBeGreaterThan(4);

    // …y en el documento que el servidor tiene persistido.
    const persisted = await waitForPersisted(api, boardId, (board) => board.elements.length >= 5);
    expect(persisted.elements.filter((element) => element.deletedAt === null).length).toBeGreaterThanOrEqual(5);
    expect(persisted.elements.map((element) => element.type)).toContain('note');

    // El tablero cuelga de la raíz de la cuenta.
    const boards = await readJson<{ boards: BoardSummaryJson[] }>(api, '/api/boards');
    const created = boards.boards.find((board) => board.id === boardId);
    expect(created?.title).toBe(TEMPLATE_NAME);
    expect(created?.parentBoardId).toBe(account.rootBoardId);
  });
});

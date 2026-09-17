/**
 * Historial de versiones (fase 6, «Agente B»).
 *
 * Secuencia real: se crean dos notas, se toma una instantánea (**por API**: la
 * interfaz no tiene botón de «guardar versión», solo lista y restaura), se borra
 * una nota con el teclado y se restaura la instantánea desde el panel. Al
 * restaurar, el panel recarga la página para rearmar el documento desde el estado
 * restaurado, así que las comprobaciones van después de esa recarga.
 */

import { expect, test } from './fixtures';
import { cardById, createNote, openApp, waitForWorkspace } from './helpers/app';
import { readJson, waitForPersisted } from './helpers/api';

type VersionJson = { id: string; origin: string; elementCount: number };

test.describe('historial', () => {
  test('restaurar una versión devuelve el estado anterior del tablero', async ({ app, api, account }) => {
    await openApp(app, account.rootBoardId);

    const stamp = Date.now().toString(36);
    const kept = `Nota que se queda ${stamp}`;
    const removed = `Nota que se borra ${stamp}`;
    await createNote(app, kept);
    const removedCard = await createNote(app, removed);
    const removedId = (await removedCard.getAttribute('data-element-id'))!;

    // La instantánea se toma del documento persistido: hay que esperarlo.
    await waitForPersisted(
      api,
      account.rootBoardId,
      (board) => board.elements.filter((element) => element.deletedAt === null).length >= 2,
    );
    const snapshotResponse = await api.post(`/api/boards/${account.rootBoardId}/versions`);
    expect(snapshotResponse.status()).toBe(201);
    const snapshot = ((await snapshotResponse.json()) as { version: VersionJson }).version;
    expect(snapshot.elementCount).toBeGreaterThanOrEqual(2);

    // Borrar una de las notas (queda en la papelera del documento).
    await removedCard.click();
    await expect(removedCard).toHaveClass(/is-selected/);
    await app.keyboard.press('Delete');
    await expect(removedCard).toHaveCount(0);

    // El historial lista la instantánea y la restaura con confirmación.
    await app.locator('[data-topbar-history]').click();
    const panel = app.getByRole('dialog', { name: 'Historial de versiones' });
    await expect(panel).toBeVisible();
    const versionItem = panel.locator(`[data-version="${snapshot.id}"]`);
    await expect(versionItem).toBeVisible();
    await versionItem.click();
    await panel.locator(`[data-restore="${snapshot.id}"]`).click();
    await panel.locator(`[data-restore-confirm="${snapshot.id}"]`).click();

    // La restauración recarga la página y avisa con el cartel de estado.
    await waitForWorkspace(app);
    await expect(app.locator('.notice')).toContainText('Versión restaurada');

    // Las dos notas volvieron (la borrada, incluida).
    await expect(cardById(app, removedId)).toBeVisible({ timeout: 20_000 });
    await expect(app.locator('[data-element-id]').filter({ hasText: kept })).toBeVisible();

    // API: el servidor guardó el estado actual como `pre-restore` y el documento
    // persistido volvió a tener las dos notas vivas.
    const versions = await readJson<{ versions: VersionJson[] }>(api, `/api/boards/${account.rootBoardId}/versions`);
    expect(versions.versions.some((version) => version.origin === 'pre-restore')).toBe(true);
    const restored = await waitForPersisted(
      api,
      account.rootBoardId,
      (board) => board.elements.filter((element) => element.deletedAt === null).length >= 2,
    );
    expect(restored.elements.find((element) => element.id === removedId)?.deletedAt).toBeNull();
  });
});

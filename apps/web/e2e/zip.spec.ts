/**
 * Copia de seguridad en ZIP: exportar e importar (fase 6, «Agente B»).
 *
 * El ZIP lo arma el servidor (documento, tarjetas y archivos reales) y la
 * importación lo vuelve a subir como un tablero nuevo. La prueba hace el viaje
 * completo con los archivos reales: descarga el ZIP del menú, lo elige en el
 * diálogo de importación y comprueba que el tablero importado tiene el contenido.
 */

import { expect, test } from './fixtures';
import { boardIdFromUrl, createNote, openApp } from './helpers/app';
import { waitForPersisted } from './helpers/api';

test.describe('copia de seguridad', () => {
  test('exportar el ZIP del tablero y volver a importarlo como tablero nuevo', async ({
    app,
    api,
    account,
  }, testInfo) => {
    await openApp(app, account.rootBoardId);
    const marker = `Nota del respaldo ${Date.now().toString(36)}`;
    await createNote(app, marker);
    await waitForPersisted(api, account.rootBoardId, (board) =>
      board.elements.some((element) => element.text.includes(marker)),
    );

    // Exportar la copia desde el menú (descarga real del navegador).
    await app.locator('[data-topbar-export]').click();
    const exportDialog = app.getByRole('dialog', { name: 'Exportar tablero' });
    await expect(exportDialog).toBeVisible();
    const downloadPromise = app.waitForEvent('download');
    await exportDialog.locator('[data-export="zip"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/i);
    const zipPath = testInfo.outputPath('respaldo.zip');
    await download.saveAs(zipPath);

    // El diálogo de exportar sigue abierto a propósito (se pueden bajar varios
    // formatos seguidos): se cierra con Esc antes de ir a importar.
    await app.keyboard.press('Escape');
    await expect(exportDialog).toBeHidden();

    // Importarlo: crea un tablero nuevo y navega a él.
    await app.locator('[data-topbar-import]').click();
    const importDialog = app.getByRole('dialog', { name: 'Importar' });
    await expect(importDialog).toBeVisible();
    await importDialog.locator('[data-import-input]').setInputFiles(zipPath);
    await expect(importDialog).toBeHidden({ timeout: 30_000 });

    const importedBoardId = boardIdFromUrl(app);
    expect(importedBoardId).not.toBe(account.rootBoardId);
    // Los avisos se apilan (el de la exportación puede seguir visible).
    await expect(app.locator('.toast').filter({ hasText: 'Importado:' })).toBeVisible();
    await expect(app.locator('[data-element-id]').filter({ hasText: marker })).toBeVisible({ timeout: 20_000 });

    // El tablero importado está en el servidor con el contenido del respaldo.
    const persisted = await waitForPersisted(api, importedBoardId, (board) =>
      board.elements.some((element) => element.text.includes(marker)),
    );
    expect(persisted.elements.length).toBeGreaterThan(0);
  });
});

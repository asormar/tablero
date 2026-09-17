/**
 * Exportar a Markdown (fase 6, «Agente B»).
 *
 * El Markdown lo arma el servidor a partir del documento persistido. La prueba
 * abre el menú, dispara la descarga real del navegador, lee el archivo descargado
 * y comprueba que lleva el contenido del tablero (y contrasta con la misma
 * exportación pedida por API).
 */

import { readFileSync } from 'node:fs';

import { expect, test } from './fixtures';
import { createNote, openApp } from './helpers/app';
import { waitForPersisted } from './helpers/api';

test.describe('exportar', () => {
  test('la descarga en Markdown lleva el contenido del tablero', async ({ app, api, account }) => {
    await openApp(app, account.rootBoardId);
    const marker = `Contenido exportable ${Date.now().toString(36)}`;
    await createNote(app, marker);
    await waitForPersisted(api, account.rootBoardId, (board) =>
      board.elements.some((element) => element.text.includes(marker)),
    );

    await app.locator('[data-topbar-export]').click();
    const dialog = app.getByRole('dialog', { name: 'Exportar tablero' });
    await expect(dialog).toBeVisible();

    const downloadPromise = app.waitForEvent('download');
    await dialog.locator('[data-export="markdown"]').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.md$/i);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const markdown = readFileSync(filePath!, 'utf8');

    expect(markdown.length).toBeGreaterThan(0);
    expect(markdown).toContain(marker);
    expect(markdown).toContain('Inicio');

    // La misma exportación pedida por API sirve el mismo contenido (salvo la
    // marca de tiempo del encabezado, que es el momento de cada exportación).
    const response = await api.post(
      `/api/boards/${account.rootBoardId}/export?format=markdown&includeAssets=false`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-disposition']).toContain('.md');
    const serverMarkdown = await response.text();
    expect(serverMarkdown).toContain(marker);
    const withoutTimestamp = (text: string): string => text.replace(/^>.*exportado el.*$/gm, '> (fecha)');
    expect(withoutTimestamp(serverMarkdown)).toBe(withoutTimestamp(markdown));
  });
});

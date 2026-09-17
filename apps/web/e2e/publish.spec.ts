/**
 * Publicar el tablero y abrirlo sin sesión (fase 6, «Agente B»).
 *
 * Se publica desde el panel (interfaz), se lee el enlace que devuelve el servidor
 * y se abre `/p/:slug` en un contexto **sin cookies**: solo lectura, sin barra de
 * herramientas y con el contenido real del tablero.
 */

import { request as playwrightRequest } from '@playwright/test';

import { expect, test } from './fixtures';
import { createNote, openApp } from './helpers/app';
import { readJson, waitForPersisted } from './helpers/api';
import { API_ORIGIN, WEB_ORIGIN } from './env';

test.describe('publicar', () => {
  test('el tablero publicado se ve sin sesión en /p/:slug', async ({ app, api, account, browser }) => {
    await openApp(app, account.rootBoardId);
    const text = `Nota pública ${Date.now().toString(36)}`;
    await createNote(app, text);

    // La vista pública lee el documento persistido: se espera a que llegue.
    await waitForPersisted(api, account.rootBoardId, (board) =>
      board.elements.some((element) => element.text.includes(text)),
    );

    await app.locator('[data-topbar-publish]').click();
    const panel = app.locator('[data-publish-panel]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-publish-state', 'draft');

    await panel.locator('[data-publish-submit]').click();
    await expect(panel).toHaveAttribute('data-publish-state', 'published');

    const shown = await panel.locator('[data-publish-slug]').inputValue();
    expect(shown).toContain('/p/');
    const slug = shown.split('/p/')[1]!;
    expect(slug.length).toBeGreaterThan(0);

    // El servidor confirma la publicación con el mismo slug.
    const publication = await readJson<{ published: boolean; slug: string; hasPassword: boolean }>(
      api,
      `/api/boards/${account.rootBoardId}/publish`,
    );
    expect(publication.published).toBe(true);
    expect(publication.slug).toBe(slug);
    expect(publication.hasPassword).toBe(false);

    // Sin sesión: contexto nuevo, sin cookies.
    const anonymous = await browser.newContext();
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto(`${WEB_ORIGIN}/p/${slug}`);

    await expect(anonymousPage.locator(`[data-public-board="${slug}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(anonymousPage.locator('.public-topbar__title')).toContainText('Inicio');
    await expect(anonymousPage.locator('[data-public-readonly]')).toBeVisible();
    await expect(anonymousPage.locator('[data-public-canvas] [data-element-id]').filter({ hasText: text })).toBeVisible({
      timeout: 20_000,
    });

    // Sin herramientas ni barra de la aplicación: es la vista pública.
    await expect(anonymousPage.locator('[data-toolbar-editable]')).toHaveCount(0);
    await expect(anonymousPage.locator('[data-topbar-export]')).toHaveCount(0);
    await anonymous.close();

    // Y el API público responde sin credenciales.
    const anonymousApi = await playwrightRequest.newContext({ baseURL: API_ORIGIN });
    try {
      const response = await anonymousApi.get(`/api/public/boards/${slug}`);
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { board: { title: string; slug: string } };
      expect(body.board.slug).toBe(slug);
      expect(body.board.title).toBe('Inicio');
    } finally {
      await anonymousApi.dispose();
    }
  });
});

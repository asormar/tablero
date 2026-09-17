/**
 * Subida de una imagen real (fase 6, «Agente B»).
 *
 * La imagen la **genera** la prueba (PNG válido, ver `helpers/image.ts`): el
 * servidor la procesa de verdad (mide, guarda en MinIO y responde la ruta del
 * archivo). Se comprueba en el DOM (la tarjeta con su `<img>` cargada) y en la API
 * (metadatos del archivo y bytes del original).
 */

import { writeFileSync } from 'node:fs';

import { expect, test } from './fixtures';
import { openApp, toolButton } from './helpers/app';
import { readJson, waitForPersisted } from './helpers/api';
import { createPng } from './helpers/image';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type AssetJson = {
  asset: { id: string; type: string; mime: string; size: number; width: number | null; height: number | null };
};

test.describe('archivos', () => {
  test('subir una imagen real: la tarjeta la muestra y el archivo queda en el servidor', async ({
    app,
    api,
    account,
  }, testInfo) => {
    await openApp(app, account.rootBoardId);

    const png = createPng(24, 16, [180, 40, 90]);
    const filePath = testInfo.outputPath('e2e-image.png');
    writeFileSync(filePath, png);

    const chooserPromise = app.waitForEvent('filechooser');
    await toolButton(app, 'Imagen').click();
    const chooser = await chooserPromise;
    expect(chooser.isMultiple()).toBe(true);
    await chooser.setFiles({ name: 'e2e-image.png', mimeType: 'image/png', buffer: png });

    // La tarjeta aparece enseguida (con su estado de subida) y, al terminar, la
    // imagen se sirve por la API.
    const card = app.locator('[data-element-id][data-type="image"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    const image = card.locator('img');
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect(image).toHaveAttribute('src', /\/api\/assets\/[^/]+\/raw/);
    await expect
      .poll(async () => image.evaluate((node) => (node as HTMLImageElement).naturalWidth), { timeout: 30_000 })
      .toBe(24);
    expect(await image.evaluate((node) => (node as HTMLImageElement).naturalHeight)).toBe(16);

    // La tarjeta quedó ligada al archivo también en el documento persistido.
    const elementId = (await card.getAttribute('data-element-id'))!;
    const persisted = await waitForPersisted(api, account.rootBoardId, (board) =>
      board.elements.some((element) => element.id === elementId && typeof element.fields['assetId'] === 'string'),
    );
    const assetId = String(persisted.elements.find((element) => element.id === elementId)?.fields['assetId']);
    expect(assetId.length).toBeGreaterThan(0);

    // Metadatos reales del archivo en el servidor.
    const detail = await readJson<AssetJson>(api, `/api/assets/${assetId}`);
    expect(detail.asset.type).toBe('image');
    expect(detail.asset.mime).toBe('image/png');
    expect(detail.asset.width).toBe(24);
    expect(detail.asset.height).toBe(16);
    expect(detail.asset.size).toBe(png.length);

    // Y los bytes del original son los del PNG generado.
    const raw = await api.get(`/api/assets/${assetId}/raw`);
    expect(raw.status()).toBe(200);
    expect(raw.headers()['content-type']).toContain('image/png');
    const bytes = await raw.body();
    expect(bytes.length).toBe(png.length);
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });
});

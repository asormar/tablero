/**
 * Ayudas de interfaz: las acciones que se repiten en casi todos los flujos.
 *
 * Los selectores son los atributos `data-*` que ya expone la aplicación
 * (`data-element-id`, `data-toolbar-*`, `data-panel-tab`, `data-palette-*`…):
 * estables y ajenos al texto de la interfaz.
 */

import { expect, type Locator, type Page } from '@playwright/test';

/** Espera al espacio de trabajo con el lienzo editable montado. */
export async function waitForWorkspace(page: Page): Promise<void> {
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-toolbar-editable="yes"]')).toBeVisible({ timeout: 30_000 });
}

/** Abre la aplicación (la sesión ya está en la cookie del contexto). */
export async function openApp(page: Page, boardId?: string): Promise<void> {
  await page.goto(boardId ? `/?board=${encodeURIComponent(boardId)}` : '/');
  await waitForWorkspace(page);
}

/** Barra de herramientas (solo existe si el rol permite editar). */
export function toolbar(page: Page): Locator {
  return page.locator('[data-toolbar-editable="yes"]');
}

export function toolButton(page: Page, name: string): Locator {
  return toolbar(page).getByRole('button', { name, exact: true });
}

export function cardById(page: Page, elementId: string): Locator {
  return page.locator(`[data-element-id="${elementId}"]`);
}

export function cardByText(page: Page, text: string): Locator {
  return page.locator('[data-element-id]').filter({ hasText: text });
}

export function boardIdFromUrl(page: Page): string {
  const url = new URL(page.url());
  const boardId = url.searchParams.get('board');
  if (!boardId) throw new Error(`La URL no tiene tablero: ${page.url()}`);
  return boardId;
}

/** Crea una nota con la barra de herramientas y le escribe el texto. */
export async function createNote(page: Page, text: string): Promise<Locator> {
  await toolButton(page, 'Nota').click();
  const editor = page.locator('.el.is-editing .rt-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  const card = cardByText(page, text);
  await expect(card).toBeVisible();
  return card;
}

/** Crea una tarjeta de un tipo concreto desde la barra de herramientas. */
export async function createCard(page: Page, tool: string): Promise<Locator> {
  const before = await page.locator('[data-element-id]').count();
  await toolButton(page, tool).click();
  await expect.poll(() => page.locator('[data-element-id]').count()).toBeGreaterThan(before);
  return page.locator('[data-element-id]').last();
}

/**
 * Une dos tarjetas con un conector: el gesto real (puntero) desde el ancla de una
 * hasta el centro de la otra.
 */
export async function connectCards(page: Page, from: Locator, to: Locator): Promise<void> {
  await from.hover();
  const anchor = from.locator('[data-anchor="right"]');
  await expect(anchor).toBeVisible();
  const start = await anchor.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('No se pudo medir alguna de las dos tarjetas');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  // Un par de pasos intermedios: el lienzo sigue el puntero y decide el destino
  // al soltar (`elementsFromPoint`), no hace falta un gesto lento.
  await page.mouse.move((start.x + end.x + end.width / 2) / 2, (start.y + end.y + end.height / 2) / 2, { steps: 6 });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 6 });
  await page.mouse.up();
}

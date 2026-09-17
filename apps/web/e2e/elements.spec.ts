/**
 * Elementos del lienzo: nota, tarea con fecha, columna y conector
 * (fase 6, «Agente B»).
 *
 * Cada prueba usa su propia cuenta y su propio tablero raíz, crea el elemento con
 * la interfaz real (barra de herramientas y gestos de puntero) y comprueba el DOM
 * más el documento que el servidor tiene persistido.
 */

import { expect, test } from './fixtures';
import { connectCards, createCard, createNote, openApp } from './helpers/app';
import { waitForPersisted } from './helpers/api';

test.describe('elementos del lienzo', () => {
  test('crear una nota y escribir su texto', async ({ app, api, account }) => {
    await openApp(app, account.rootBoardId);

    const text = `Nota e2e ${Date.now().toString(36)}`;
    const note = await createNote(app, text);
    const elementId = await note.getAttribute('data-element-id');
    expect(elementId).toBeTruthy();

    // El texto se ve en la tarjeta (bloques de texto, ya fuera del editor).
    await expect(note.locator('.rt')).toContainText(text);
    await expect(app.locator('[data-element-id].is-editing')).toHaveCount(0);

    // Y llegó al servidor: tipo y texto en el documento persistido.
    const persisted = await waitForPersisted(
      api,
      account.rootBoardId,
      (board) => board.elements.some((element) => element.id === elementId),
    );
    const stored = persisted.elements.find((element) => element.id === elementId);
    expect(stored?.type).toBe('note');
    expect(stored?.text).toContain(text);
    expect(stored?.deletedAt).toBeNull();
  });

  test('crear una lista de tareas con una tarea que tiene fecha', async ({ app, api, account }) => {
    await openApp(app, account.rootBoardId);

    const list = await createCard(app, 'Tareas');
    await expect(list).toHaveAttribute('data-type', 'todo');

    const todoId = await list.getAttribute('data-element-id');
    const text = `Tarea con fecha ${Date.now().toString(36)}`;

    await list.getByRole('button', { name: 'Añadir tarea' }).click();
    const taskInput = list.locator('input[data-task-input]').first();
    await expect(taskInput).toBeFocused();
    await app.keyboard.type(text);
    // El texto se confirma al salir del campo (una transacción).
    await app.locator('.canvas').click({ position: { x: 40, y: 40 } });
    await expect(list.locator('input[data-task-input]').first()).toHaveValue(text);

    // Fecha de vencimiento: el editor de fecha ofrece atajos («+7» = dentro de una semana).
    const row = list.locator('[data-task-row]').first();
    await row.getByTitle('Añadir fecha de vencimiento').click();
    await expect(row.locator('input[aria-label="Fecha de vencimiento"]')).toBeVisible();
    await row.locator('.todo__due-editor').getByRole('button', { name: '+7', exact: true }).click();

    const due = row.locator('.todo__due').first();
    await expect(due).toHaveAttribute('title', /^Vence el \d{4}-\d{2}-\d{2}$/);
    const iso = (await due.getAttribute('title'))!.replace('Vence el ', '');

    // La fecha esperada es «hoy + 7 días» en la zona del navegador.
    const expectedIso = await app.evaluate(() => {
      const date = new Date();
      date.setDate(date.getDate() + 7);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${date.getFullYear()}-${month}-${day}`;
    });
    expect(iso).toBe(expectedIso);

    // El servidor guarda la tarea con su fecha.
    const persisted = await waitForPersisted(api, account.rootBoardId, (board) =>
      board.elements.some((element) => element.id === todoId),
    );
    const todo = persisted.elements.find((element) => element.id === todoId);
    const items = (todo?.fields['items'] ?? []) as { text: string; dueDate: string | null }[];
    expect(items.map((item) => item.text)).toContain(text);
    expect(items.find((item) => item.text === text)?.dueDate).toBe(iso);
  });

  test('crear una columna', async ({ app, api, account }) => {
    await openApp(app, account.rootBoardId);

    const column = await createCard(app, 'Columna');
    await expect(column).toHaveAttribute('data-type', 'column');
    await expect(column).toBeVisible();

    const columnId = await column.getAttribute('data-element-id');
    await waitForPersisted(api, account.rootBoardId, (board) =>
      board.elements.some((element) => element.id === columnId && element.type === 'column'),
    );
  });

  test('conectar dos tarjetas con un conector', async ({ app, api, account }) => {
    await openApp(app, account.rootBoardId);

    const left = await createNote(app, `Origen ${Date.now().toString(36)}`);
    const right = await createNote(app, `Destino ${Date.now().toString(36)}`);

    await connectCards(app, left, right);

    // El conector existe en el lienzo y une las dos tarjetas.
    const connector = app.locator('[data-connector-id]').first();
    await expect(connector).toBeVisible();

    const persisted = await waitForPersisted(api, account.rootBoardId, (board) => board.connectors.length >= 1);
    expect(persisted.connectors).toHaveLength(1);
    const ends = JSON.stringify(persisted.connectors[0]);
    expect(ends).toContain((await left.getAttribute('data-element-id'))!);
    expect(ends).toContain((await right.getAttribute('data-element-id'))!);
  });
});

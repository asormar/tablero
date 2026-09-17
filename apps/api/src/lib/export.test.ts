/**
 * Exportación: proyecciones a Markdown y texto plano, JSON con el estado Yjs y
 * el manifiesto de archivos (los nombres del ZIP).
 */

import type { Asset } from '@prisma/client';
import {
  addElement,
  createBoardDoc,
  createMapData,
  createMarker,
  createTodoItem,
  ensureTextFragment,
  getOrderedElements,
  writeTextParagraphs,
  type CanvasElement,
  type TableData,
} from '@tablero/shared';
import { createCell, createColumn, createRow } from '@tablero/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { boardExportData, buildAssetManifest, collectAssetIds, renderBoardJson, renderMarkdown, renderPlainText, textsOf } from './export.js';

function demoDoc(): { doc: ReturnType<typeof createBoardDoc>; ids: Record<string, string> } {
  const doc = createBoardDoc();
  const ids: Record<string, string> = {};

  ids.heading = addElement(doc, 'heading', { createdBy: 'ana', x: 0, y: 0, width: 320, size: 'XL' }, 'test');
  ids.note = addElement(doc, 'note', { createdBy: 'ana', x: 0, y: 100, width: 300, color: 'yellow' }, 'test');
  ids.todo = addElement(
    doc,
    'todo',
    {
      createdBy: 'ana',
      x: 0,
      y: 200,
      width: 300,
      title: 'Pendientes',
      items: [
        createTodoItem('Con acento: reunión', { checked: true, dueDate: '2026-09-20', priority: 'high' }),
        createTodoItem('Con subtarea', { children: [createTodoItem('Subtarea hecha', { checked: true })] }),
      ],
    },
    'test',
  );
  ids.link = addElement(
    doc,
    'link',
    {
      createdBy: 'ana',
      x: 0,
      y: 300,
      width: 300,
      url: 'https://example.com/nota',
      preview: { url: 'https://example.com/nota', title: 'Ejemplo', description: null, imageUrl: null, faviconUrl: null, siteName: null, embedType: 'generic', fetchedAt: 0 },
    },
    'test',
  );
  ids.image = addElement(
    doc,
    'image',
    { createdBy: 'ana', x: 0, y: 400, width: 320, assetId: 'asset_uno', caption: 'Foto del tablero' },
    'test',
  );

  const columns = [createColumn({ title: 'Columna A' }), createColumn({ title: 'Columna B' })];
  const table: TableData = {
    columns,
    rows: [createRow(columns, { [columns[0]!.id]: createCell('uno'), [columns[1]!.id]: createCell('dos') })],
    hasHeader: true,
  };
  ids.table = addElement(doc, 'table', { createdBy: 'ana', x: 0, y: 500, width: 640, table }, 'test');
  ids.map = addElement(
    doc,
    'map',
    {
      createdBy: 'ana',
      x: 0,
      y: 600,
      width: 320,
      map: createMapData({ lat: 41.3874, lng: 2.1686, zoom: 12, markers: [createMarker(41.4036, 2.1744, 'Sagrada Família')] }),
    },
    'test',
  );
  ids.board = addElement(doc, 'board', { createdBy: 'ana', x: 0, y: 700, width: 280, boardId: 'board_hijo' }, 'test');

  const texts: Record<string, string> = {
    heading: 'Título del tablero',
    note: 'Una nota con acentos: ñandú y murciélago',
    board: 'Tablero hijo',
  };
  for (const [key, text] of Object.entries(texts)) {
    const fragment = ensureTextFragment(doc, ids[key]!, 'test');
    if (fragment) writeTextParagraphs(fragment, text, 'test');
  }
  return { doc, ids };
}

const assetRows: Asset[] = [
  {
    id: 'asset_uno',
    ownerId: 'user_ana',
    type: 'image',
    mime: 'image/png',
    size: 1234,
    sha256: null,
    boardId: null,
    storageKey: 'assets/ana/asset_uno.png',
    width: 800,
    height: 600,
    duration: null,
    thumbnailKey: 'thumbs/ana/asset_uno.webp',
    originalName: 'foto del tablero.png',
    createdAt: new Date('2026-09-16T10:00:00Z'),
  },
  {
    id: 'asset_dos',
    ownerId: 'user_ana',
    type: 'image',
    mime: 'image/png',
    size: 20,
    sha256: null,
    boardId: null,
    storageKey: 'assets/ana/asset_dos.png',
    width: 1,
    height: 1,
    duration: null,
    thumbnailKey: null,
    originalName: 'foto del tablero.png',
    createdAt: new Date('2026-09-16T11:00:00Z'),
  },
];

describe('manifiesto de archivos', () => {
  it('nombra los archivos sin pisarse y sin separadores', () => {
    const manifest = buildAssetManifest(assetRows);
    expect(manifest.map((entry) => entry.file)).toEqual(['assets/1-foto del tablero.png', 'assets/2-foto del tablero.png']);
    expect(manifest[0]!.assetId).toBe('asset_uno');
  });

  it('desambigua dos archivos con el mismo nombre', () => {
    const manifest = buildAssetManifest([assetRows[0]!, { ...assetRows[1]!, originalName: 'foto del tablero.png' }]);
    // Índice distinto en el prefijo: nunca se pisan.
    expect(new Set(manifest.map((entry) => entry.file)).size).toBe(2);
  });

  it('junta los ids de asset referenciados (incluida la portada de una tarjeta)', () => {
    const { doc } = demoDoc();
    const elements = getOrderedElements(doc);
    const ids = collectAssetIds([
      ...elements,
      { id: 'x', type: 'board', boardId: 'b', coverAssetId: 'asset_portada' } as unknown as CanvasElement,
    ]);
    expect(ids.sort()).toEqual(['asset_portada', 'asset_uno']);
  });
});

describe('Markdown y texto plano', () => {
  const { doc } = demoDoc();
  const data = boardExportData({
    doc,
    info: { id: 'board_uno', title: 'Tablero de prueba', icon: '📋', color: null, path: ['Inicio', 'Tablero de prueba'] },
    stateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
    assets: buildAssetManifest(assetRows),
  });

  it('incluye encabezado, ruta, notas, tareas con estado, tabla, enlace, archivo y mapa', () => {
    const markdown = renderMarkdown(data);
    expect(markdown).toContain('# 📋 Tablero de prueba');
    expect(markdown).toContain('> Ruta: Inicio › Tablero de prueba');
    expect(markdown).toContain('Una nota con acentos: ñandú y murciélago');
    expect(markdown).toContain('- [x] Con acento: reunión _(vence 2026-09-20, prioridad high)_');
    expect(markdown).toContain('  - [x] Subtarea hecha');
    expect(markdown).toContain('[Ejemplo](https://example.com/nota)');
    expect(markdown).toContain('![Foto del tablero](assets/1-foto del tablero.png)');
    expect(markdown).toContain('| Columna A | Columna B |');
    expect(markdown).toContain('| uno | dos |');
    expect(markdown).toContain('(41.40360, 2.17440) Sagrada Família');
    expect(markdown).toContain('### 📄 Tablero: Tablero hijo');
  });

  it('el texto plano pierde la sintaxis pero conserva el contenido y los metadatos de las tareas', () => {
    const plain = renderPlainText(data);
    expect(plain).toContain('TABLERO DE PRUEBA');
    // Misma información que el Markdown: fecha y prioridad de la tarea.
    expect(plain).toContain('[x] Con acento: reunión (vence 2026-09-20, prioridad high)');
    // Las subtareas siguen sangradas y sin metadatos propios.
    expect(plain).toContain('    [x] Subtarea hecha');
    expect(plain).not.toContain('Subtarea hecha (');
    expect(plain).toContain('uno\tdos');
    expect(plain).not.toContain('<mark>');
  });

  it('el texto plano de las tareas lleva lo mismo que el Markdown (fecha y prioridad)', () => {
    const markdown = renderMarkdown(data);
    const plain = renderPlainText(data);
    for (const fragment of ['vence 2026-09-20', 'prioridad high']) {
      expect(markdown).toContain(fragment);
      expect(plain).toContain(fragment);
    }
  });

  it('el texto indexable por elemento sale del fragmento enriquecido', () => {
    const texts = textsOf(doc);
    expect(texts.get('el_inexistente' as string)).toBeUndefined();
    expect([...texts.values()].join(' ')).toContain('murciélago');
  });
});

describe('JSON de exportación', () => {
  it('lleva el estado Yjs en base64, la proyección y el manifiesto', () => {
    const { doc } = demoDoc();
    const state = Y.encodeStateAsUpdate(doc);
    const data = boardExportData({
      doc,
      info: { id: 'board_uno', title: 'Tablero de prueba', icon: null, color: null, path: ['Inicio'] },
      stateBase64: Buffer.from(state).toString('base64'),
      assets: buildAssetManifest(assetRows),
    });
    const json = renderBoardJson(data, doc);
    expect(json.format).toBe('tablero.board');
    expect(json.board.elementCount).toBe(getOrderedElements(doc).length);
    expect(json.document.state).toBe(Buffer.from(state).toString('base64'));
    expect(json.document.elements.length).toBe(json.board.elementCount);
    expect(json.document.order.length).toBeGreaterThan(0);
    expect(json.document.texts['el_inexistente' as string]).toBeUndefined();
    expect(json.assets[0]).toMatchObject({ assetId: 'asset_uno', file: 'assets/1-foto del tablero.png' });
  });
});

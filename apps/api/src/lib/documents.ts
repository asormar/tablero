/**
 * Documentos Yjs (`BoardDocument`): lectura/escritura de bytes y proyección a
 * texto plano para el índice de búsqueda.
 */

import { createBoardDoc, elementPlainText, fragmentToPlainText, getOrderedElements, getTextFragment } from '@tablero/shared';
import type { CanvasElement } from '@tablero/shared';
import * as Y from 'yjs';

import { prisma } from '../db.js';

/** Update Yjs de un documento vacío (mismos tipos que verá el cliente). */
export function emptyDocumentUpdate(): Uint8Array {
  return Y.encodeStateAsUpdate(createBoardDoc());
}

export function encodeStateBase64(state: Uint8Array): string {
  return Buffer.from(state).toString('base64');
}

export function decodeStateBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Devuelve la fila del documento, creándola vacía si no existe.
 * Es idempotente y lo usan tanto la ruta REST de respaldo como Hocuspocus.
 */
export async function ensureBoardDocument(boardId: string): Promise<{ boardId: string; yjsState: Uint8Array; updatedAt: Date }> {
  const existing = await prisma.boardDocument.findUnique({ where: { boardId } });
  if (existing) return existing;
  try {
    return await prisma.boardDocument.create({
      data: { boardId, yjsState: Buffer.from(emptyDocumentUpdate()) },
    });
  } catch {
    // Carrera: otro proceso lo creó en el medio.
    const row = await prisma.boardDocument.findUnique({ where: { boardId } });
    if (!row) throw new Error(`No se pudo crear el documento del tablero ${boardId}`);
    return row;
  }
}

/** Carga el `Y.Doc` de un tablero (null si todavía no hay estado persistido). */
export async function loadBoardDoc(boardId: string): Promise<Y.Doc | null> {
  const row = await prisma.boardDocument.findUnique({ where: { boardId } });
  if (!row) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.yjsState));
  return doc;
}

export type SearchEntry = { elementId: string; elementType: string; text: string };

/**
 * Texto indexable de un elemento: campos planos, ítems de las listas de tareas
 * y texto enriquecido. `elementPlainText` no mira `items`, así que las tareas
 * se agregan acá (buscar el texto de una tarea es lo esperable en la UI).
 */
function elementIndexText(element: CanvasElement): string {
  const parts = [elementPlainText(element)];
  if (element.type === 'todo') {
    for (const item of element.items ?? []) {
      parts.push(item.text);
      for (const child of item.children ?? []) parts.push(child.text);
    }
  }
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ');
}

/** Texto indexable de cada elemento: campos planos + texto enriquecido. */
export function collectSearchEntries(doc: Y.Doc): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const element of getOrderedElements(doc)) {
    const richText = fragmentToPlainText(getTextFragment(doc, element.id));
    const text = [elementIndexText(element), richText.trim()]
      .filter((part) => part.length > 0)
      .join(' ')
      .slice(0, 8000);
    if (text.length > 0) {
      entries.push({ elementId: element.id, elementType: element.type, text });
    }
  }
  return entries;
}

/**
 * Refresca `SearchIndex` para un tablero a partir de su documento.
 * Se llama tras cada persistencia de Hocuspocus; los fallos no deben tumbar
 * la persistencia, así que el llamador los captura.
 */
export async function syncSearchIndex(boardId: string, doc: Y.Doc): Promise<number> {
  const entries = collectSearchEntries(doc);
  const ids = entries.map((entry) => entry.elementId);
  await prisma.$transaction([
    prisma.searchIndex.deleteMany({ where: { boardId, elementId: { notIn: ids } } }),
    ...entries.map((entry) =>
      prisma.searchIndex.upsert({
        where: { boardId_elementId: { boardId, elementId: entry.elementId } },
        create: {
          boardId,
          elementId: entry.elementId,
          elementType: entry.elementType,
          text: entry.text,
        },
        update: { elementType: entry.elementType, text: entry.text },
      }),
    ),
  ]);
  return entries.length;
}

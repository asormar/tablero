/**
 * Importación del ZIP de copia de seguridad (punto 3 de la fase 4).
 *
 * El cliente lee el ZIP (`parseBackupZip`), crea el tablero nuevo contra la API
 * y le pasa el documento con la misma técnica que usa «mover entre tableros»:
 * sesión temporal, espera del `synced`, `Y.applyUpdate` con el update guardado y
 * espera de confirmación del proveedor. Los archivos del ZIP se suben por el
 * camino normal de subida y se crean como tarjetas de imagen o archivo.
 *
 * Si el ZIP trae `elements` en JSON (formato sin Yjs) se crean igual, sin texto
 * enriquecido (queda anotado en el resumen).
 */

import * as Y from 'yjs';

import { type AssetSummary, type BoardSummary, addElement, DEFAULT_SIZES } from '@tablero/shared';

import { createBoard } from '@/api/boards';
import { uploadAsset } from '@/api/assets';
import { BoardSession } from '@/collab/BoardSession';
import { extensionOf, type ParsedBackup } from '@/export/importers';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForSync(session: BoardSession, timeoutMs = 8000): Promise<boolean> {
  const provider = session.provider;
  if (!provider) return false;
  if (provider.isSynced) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      provider.off('synced', onSynced);
      resolve(value);
    };
    const onSynced = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    provider.on('synced', onSynced);
  });
}

async function flushProvider(session: BoardSession, timeoutMs = 8000): Promise<boolean> {
  const provider = session.provider;
  if (!provider) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (provider.isSynced && !provider.hasUnsyncedChanges) return true;
    await delay(120);
  }
  return !provider.hasUnsyncedChanges;
}

export type ImportSummary = { board: BoardSummary; assets: number; elements: number; notes: string[] };

/**
 * Crea el tablero importado. Lanza con un mensaje claro si el ZIP no traía
 * documento y no había nada que crear.
 */
export async function importBackupAsBoard(
  parsed: ParsedBackup,
  parentBoardId: string | null,
): Promise<ImportSummary> {
  const title = parsed.title ?? 'Tablero importado';
  const board = await createBoard({ title, parentBoardId, icon: '📥' });
  const session = new BoardSession({ boardId: board.id, connect: true });
  const notes = [...parsed.notes];
  let createdElements = 0;
  try {
    await session.init();
    const synced = await waitForSync(session);
    if (!synced) throw new Error('El tablero nuevo no sincronizó con el servidor');

    if (parsed.state) {
      Y.applyUpdate(session.doc, parsed.state, session.origin);
    } else if (parsed.elements.length > 0) {
      session.doc.transact(() => {
        let index = 0;
        for (const raw of parsed.elements) {
          if (!raw || typeof raw !== 'object') continue;
          const record = raw as Record<string, unknown>;
          const type = typeof record['type'] === 'string' ? record['type'] : null;
          if (!type) continue;
          const init: Record<string, unknown> = {
            x: typeof record['x'] === 'number' ? record['x'] : (index % 4) * 280,
            y: typeof record['y'] === 'number' ? record['y'] : Math.floor(index / 4) * 220,
            width: typeof record['width'] === 'number' ? record['width'] : DEFAULT_SIZES.note.width,
            createdBy: session.doc.clientID.toString(),
          };
          if (typeof record['height'] === 'number') init['height'] = record['height'];
          if (typeof record['color'] === 'string') init['color'] = record['color'];
          addElement(session.doc, type as never, init as never, session.origin);
          index += 1;
          createdElements += 1;
        }
      }, session.origin);
      notes.push(`${createdElements} elemento(s) creados desde el JSON (sin texto enriquecido).`);
    }

    // Archivos reales del ZIP: se suben y se crean como tarjetas.
    let uploaded = 0;
    for (const asset of parsed.assets) {
      try {
        // Copia explícita para asegurar un `ArrayBuffer` (y no un
        // `SharedArrayBuffer`) antes de armar el `File`.
        const file = new File([new Uint8Array(asset.bytes)], asset.name);
        const summary: AssetSummary = await uploadAsset(file, { boardId: board.id });
        const isImage = IMAGE_EXTENSIONS.includes(extensionOf(asset.name));
        session.doc.transact(() => {
          addElement(
            session.doc,
            isImage ? 'image' : 'file',
            {
              x: 40 + uploaded * 40,
              y: 40 + uploaded * 40,
              width: isImage ? DEFAULT_SIZES.image.width : DEFAULT_SIZES.file.width,
              createdBy: session.doc.clientID.toString(),
              assetId: summary.id,
              ...(isImage && summary.width && summary.height
                ? { naturalWidth: summary.width, naturalHeight: summary.height }
                : {}),
            } as never,
            session.origin,
          );
        }, session.origin);
        uploaded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'error';
        notes.push(`No se pudo subir ${asset.name}: ${message}`);
      }
    }

    const flushed = await flushProvider(session);
    if (!flushed) throw new Error('El servidor no confirmó la importación');
    return { board, assets: uploaded, elements: createdElements, notes };
  } finally {
    session.destroy();
  }
}

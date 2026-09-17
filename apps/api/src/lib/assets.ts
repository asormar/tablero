/**
 * Archivos (`Asset`): liberación de los objetos del almacenamiento y cálculo
 * de referencias.
 *
 * Vive acá y no en `routes/assets.ts` porque hay tres caminos que lo usan:
 * el borrado de un archivo (`DELETE /api/assets/:id`), la limpieza de huérfanos
 * (`DELETE /api/storage/orphans`) y el informe de espacio (`GET /api/storage`).
 * Los dos borrados tienen el mismo contrato: si un objeto no se puede borrar,
 * se registra y se sigue (la fila se borra igual); y ninguno puede tocar un
 * archivo **en uso** (ver `referencedAssetIds`).
 */

import type { Asset } from '@prisma/client';
import { elementsOf } from '@tablero/shared';
import * as Y from 'yjs';

import { liveBoardDocument } from '../collab/server.js';
import { prisma } from '../db.js';
import { loadBoardAccess } from './boards.js';
import { deleteObject } from './storage.js';

export type AssetKeys = Pick<Asset, 'storageKey' | 'thumbnailKey'>;

/** Claves de los objetos de un asset (original + miniatura). */
export function assetObjectKeys(asset: AssetKeys): string[] {
  return [asset.storageKey, ...(asset.thumbnailKey ? [asset.thumbnailKey] : [])];
}

/** Borra los objetos de un asset. Nunca lanza: devuelve las claves que fallaron. */
export async function deleteAssetObjects(
  asset: AssetKeys,
  onError?: (key: string, error: unknown) => void,
): Promise<string[]> {
  const failed: string[] = [];
  for (const key of assetObjectKeys(asset)) {
    try {
      await deleteObject(key);
    } catch (error) {
      failed.push(key);
      onError?.(key, error);
    }
  }
  return failed;
}

/**
 * Assets referenciados por los tableros del usuario (documentos + portadas).
 *
 * Se consideran referencias: `assetId` de cualquier elemento del documento
 * (incluidos los que están en la papelera del lienzo: todavía pueden volver),
 * `coverAssetId` de las tarjetas de tablero y la portada del tablero
 * (`Board.coverImageId`). El cálculo lo hace el servidor, así que no depende de
 * lo que mande el cliente.
 *
 * Se miran **todos** los tableros a los que el usuario tiene acceso y no solo
 * los propios: un archivo subido a un tablero compartido (soy editor ahí) está
 * igual de en uso, y ni el borrado de huérfanos ni el borrado directo pueden
 * tocarlo. La papelera y las plantillas cuentan (un elemento restaurado
 * devuelve su referencia).
 *
 * También se miran los documentos **abiertos en memoria** (servidor de
 * colaboración): van por delante del estado persistido, que se escribe con
 * debounce. Sin eso, colocar un archivo en el lienzo y borrarlo en los primeros
 * segundos pasaba el control y dejaba el `assetId` colgado.
 */
export async function referencedAssetIds(userId: string): Promise<{ referenced: Set<string>; boardsScanned: number }> {
  const access = await loadBoardAccess(userId);
  const boards = access.accessible({ includeTrashed: true, includeTemplates: true });
  const referenced = new Set<string>();
  for (const board of boards) {
    if (board.coverImageId) referenced.add(board.coverImageId);
  }

  /** `assetId` / `coverAssetId` de los elementos de un documento. */
  const collect = (doc: Y.Doc): void => {
    elementsOf(doc).forEach((map) => {
      for (const key of ['assetId', 'coverAssetId'] as const) {
        const value = map.get(key);
        if (typeof value === 'string' && value.length > 0) referenced.add(value);
      }
    });
  };

  const boardIds = boards.map((board) => board.id);
  if (boardIds.length > 0) {
    const docs = await prisma.boardDocument.findMany({
      where: { boardId: { in: boardIds } },
      select: { boardId: true, yjsState: true },
    });
    for (const row of docs) {
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, new Uint8Array(row.yjsState));
      } catch {
        continue; // Documento ilegible: sus assets no se consideran huérfanos.
      }
      collect(doc);
    }
    for (const boardId of boardIds) {
      const live = liveBoardDocument(boardId);
      if (live) collect(live);
    }
  }
  return { referenced, boardsScanned: boardIds.length };
}

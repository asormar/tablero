/**
 * Archivos (`Asset`): liberación de los objetos del almacenamiento.
 *
 * Vive acá y no en `routes/assets.ts` porque hay dos caminos que borran assets:
 * la ruta de borrado (`DELETE /api/assets/:id`) y la limpieza de huérfanos
 * (`DELETE /api/storage/orphans`). Los dos tienen el mismo contrato: si un
 * objeto no se puede borrar, se registra y se sigue (la fila se borra igual).
 */

import type { Asset } from '@prisma/client';

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

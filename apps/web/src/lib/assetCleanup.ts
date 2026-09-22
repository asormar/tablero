/**
 * Liberación de los archivos de una tarjeta que sale del documento para siempre.
 *
 * Decisión de diseño: borrar una tarjeta solo la manda
 * a la **papelera** (marca `deletedAt`), así que el archivo no se toca — el
 * deshacer y el restaurar tienen que seguir mostrando la imagen. Un asset se
 * libera recién cuando el elemento sale del documento para siempre (al vaciar la
 * papelera o al purgar lo que superó los 30 días, que se ejecuta al abrir el
 * tablero), y solo si **ningún otro elemento** del documento sigue apuntando al
 * mismo `assetId`: duplicar una tarjeta comparte el archivo, borrar la fila
 * `Asset` dejaría a la copia sin imagen.
 *
 * La fila y los objetos de MinIO los borra `DELETE /api/assets/:id` (que ya los
 * limpia); acá también se sueltan las cachés derivadas del binario en memoria
 * (documento de pdfjs y picos de la forma de onda), que quedarían huérfanas.
 */

import * as Y from 'yjs';

import {
  type CanvasElement,
  assetRoutes,
  elementsOf,
  readElement,
} from '@tablero/shared';

import { deleteAsset } from '@/api/assets';
import type { BoardSession } from '@/collab/BoardSession';
import { forgetPdfDocument } from '@/lib/pdf';
import { forgetPeaks } from '@/lib/waveform';
import { useAppStore } from '@/state/appStore';
import { useAssetStore } from '@/state/assetStore';

/** Todos los elementos del documento, incluidos los de la papelera. */
export function allElementsOf(doc: Y.Doc): CanvasElement[] {
  const result: CanvasElement[] = [];
  elementsOf(doc).forEach((map) => {
    const element = readElement(map);
    if (element) result.push(element);
  });
  return result;
}

/** `assetId` de un elemento (las tarjetas de archivo son las que lo tienen). */
function assetIdOf(element: CanvasElement): string | null {
  return 'assetId' in element && typeof element.assetId === 'string' && element.assetId.length > 0
    ? element.assetId
    : null;
}

/** Assets referenciados por cualquier elemento que siga en el documento. */
export function referencedAssetIds(doc: Y.Doc): Set<string> {
  const referenced = new Set<string>();
  for (const element of allElementsOf(doc)) {
    const assetId = assetIdOf(element);
    if (assetId) referenced.add(assetId);
  }
  return referenced;
}

export type ReleaseResult = {
  /** Assets borrados en el servidor (fila `Asset` + objetos de MinIO). */
  deleted: number;
  /** Assets que quedaron referenciados por otro elemento: no se tocaron. */
  kept: number;
};

/**
 * Libera los assets de los elementos indicados (los que acaban de salir del
 * documento, no los que están en la papelera). Nunca lanza: cada fallo se salda
 * con un aviso, porque la limpieza de archivos no puede romper el tablero.
 */
export async function releaseUnreferencedAssets(
  session: BoardSession,
  removed: readonly CanvasElement[],
): Promise<ReleaseResult> {
  const candidates = new Map<string, string[]>();
  for (const element of removed) {
    const assetId = assetIdOf(element);
    if (!assetId) continue;
    const urls = candidates.get(assetId);
    const url = assetRoutes.raw(assetId);
    if (urls) urls.push(url);
    else candidates.set(assetId, [url]);
  }
  if (candidates.size === 0) return { deleted: 0, kept: 0 };

  // Se recalcula después de `removeElements`: lo que otro elemento siga usando
  // no se libera.
  const referenced = referencedAssetIds(session.doc);
  const online = useAppStore.getState().apiOnline;
  const store = useAssetStore.getState();
  let deleted = 0;
  let kept = 0;

  for (const [assetId, urls] of candidates) {
    if (referenced.has(assetId)) {
      kept += 1;
      continue;
    }
    for (const url of urls) {
      forgetPdfDocument(url);
      forgetPeaks(url);
    }
    store.forget(assetId);
    if (!online) continue;
    try {
      await deleteAsset(assetId);
      deleted += 1;
    } catch {
      useAppStore.getState().setNotice('No se pudo liberar un archivo borrado; se reintenta al purgar la papelera.');
    }
  }

  return { deleted, kept };
}

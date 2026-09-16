/**
 * Subida de archivos al tablero.
 *
 * Camino de una suelta en el lienzo (o de un pegado, o de un clic en la barra
 * lateral):
 *   1. clasificar los archivos (imagen / vídeo / audio / archivo),
 *   2. medir los que necesitan medidas reales (una imagen de 4:3 no ocupa el
 *      mismo alto que una de 16:9) para poder colocarlos sin solaparse,
 *   3. crear las tarjetas **ya** (una transacción, con su hueco en la cascada),
 *   4. subirlas con la cola de 4 en paralelo informando del progreso,
 *   5. completar cada tarjeta con su `assetId` al terminar.
 *
 * Si la API no responde, la tarjeta queda en estado de error con un aviso: el
 * resto del tablero sigue funcionando en local.
 */

import {
  type AssetSummary,
  type Point,
  type Size,
  assetKindFromMime,
  patchElement,
  removeElements,
} from '@tablero/shared';

import { uploadAsset } from '@/api/assets';
import { type AssetCardSpec, completeAssetCard, createAssetCards, createAssetCardsInColumn } from '@/canvas/contentCommands';
import { rectsOf } from '@/canvas/commands';
import {
  type ClassifiedFile,
  type DroppableFile,
  batchPlacement,
  cardSizeFor,
  classifyDroppedFiles,
  fallbackSizeFor,
} from '@/lib/fileDrop';
import { placementForNewElement } from '@/lib/placement';
import { runUploadQueue } from '@/lib/uploadQueue';
import { useAppStore } from '@/state/appStore';
import { useAssetStore } from '@/state/assetStore';
import { useUiStore } from '@/state/uiStore';
import { useUploadStore } from '@/state/uploadStore';
import type { BoardSession } from '@/collab/BoardSession';

/** Concurrencia de subida: cuatro a la vez, como pide la fase. */
export const UPLOAD_CONCURRENCY = 4;

/** Archivos en memoria por tarjeta: permiten reintentar una subida fallida. */
const storedFiles = new Map<string, File>();

/** Margen entre tarjetas del mismo lote. */
const BATCH_GAP = 16;

/** Tiempo máximo para medir un archivo antes de colocarlo con medidas de reserva. */
const PROBE_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/** Medidas reales de una imagen sin subirla (para colocarla sin deformar). */
export async function probeImageSize(file: File): Promise<Size | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      if (size.width > 0 && size.height > 0) return size;
    }
  } catch {
    // Sin `createImageBitmap` (o archivo raro) se prueba con un <img>.
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const done = (size: Size | null): void => {
      URL.revokeObjectURL(url);
      resolve(size);
    };
    image.onload = () =>
      done(image.naturalWidth > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : null);
    image.onerror = () => done(null);
    image.src = url;
  });
}

/** Medidas de un vídeo (solo los metadatos del contenedor). */
export function probeVideoSize(file: File): Promise<Size | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const done = (size: Size | null): void => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(size);
    };
    video.onloadedmetadata = () =>
      done(video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

async function probeSizeFor(item: ClassifiedFile, file: File): Promise<Size | null> {
  if (item.kind === 'image') return withTimeout(probeImageSize(file), PROBE_TIMEOUT_MS);
  if (item.kind === 'video') return withTimeout(probeVideoSize(file), PROBE_TIMEOUT_MS);
  return null;
}

export type AttachOptions = {
  /** Punto de mundo donde se quiere el centro de la primera tarjeta. */
  world: Point;
  /** Seleccionar las tarjetas creadas (por defecto sí). */
  select?: boolean;
  /** Columna destino (kanban): las tarjetas nacen dentro en vez de en el lienzo. */
  columnId?: string | null;
};

export type AttachResult = {
  ids: string[];
  /** Resuelve cuando la cola de subida termina (todas, con éxito o con error). */
  finished: Promise<void>;
};

/**
 * Mide, coloca y sube un lote de archivos. Devuelve los ids creados al
 * instante, con la promesa de la cola aparte para poder verificar el progreso.
 */
export async function attachFilesToBoard(
  session: BoardSession,
  files: readonly File[],
  options: AttachOptions,
): Promise<AttachResult> {
  if (files.length === 0) return { ids: [], finished: Promise.resolve() };

  const classified = classifyDroppedFiles(files as readonly DroppableFile[]);
  const naturals = await Promise.all(
    classified.map((item, index) => probeSizeFor(item, files[index] as File)),
  );
  const sizes = classified.map((item, index) => cardSizeFor(item.kind, naturals[index] ?? null));

  const existing = rectsOf(session);
  const first = sizes[0] ?? fallbackSizeFor('file');
  const start = placementForNewElement({ existing, size: first, world: options.world });
  const plan = batchPlacement({ sizes, origin: start, gap: BATCH_GAP, existing });

  const specs: AssetCardSpec[] = classified.map((item, index) => ({
    kind: item.kind,
    position: plan.positions[index] ?? start,
    size: sizes[index] ?? fallbackSizeFor(item.kind),
    natural: naturals[index] ?? null,
  }));

  const ids = options.columnId
    ? createAssetCardsInColumn(session, options.columnId, specs)
    : createAssetCards(session, specs);
  const ui = useUiStore.getState();
  if (options.select !== false && ids.length > 0) ui.select(ids);
  else ui.clearSelection();

  const finished = runUploads(session, ids, files as File[], classified);
  return { ids, finished };
}

/** Sube los archivos asociados a tarjetas ya creadas (en orden). */
export function runUploads(
  session: BoardSession,
  ids: readonly string[],
  files: readonly File[],
  classified: readonly ClassifiedFile[],
  options: { concurrency?: number } = {},
): Promise<void> {
  // Los tableros locales (`bd_…`) no existen en el servidor: se sube sin
  // `boardId` en lugar de comerse un 404.
  const currentBoardId = useAppStore.getState().currentBoardId;
  const boardId = currentBoardId && !currentBoardId.startsWith('bd_') ? currentBoardId : null;
  const usable: { id: string; file: File; item: ClassifiedFile }[] = [];
  ids.forEach((id, index) => {
    const file = files[index];
    const item = classified[index];
    if (file && item) usable.push({ id, file, item });
  });
  if (usable.length === 0) return Promise.resolve();

  for (const task of usable) {
    storedFiles.set(task.id, task.file);
    useUploadStore.getState().begin({
      elementId: task.id,
      name: task.item.name,
      size: task.item.size,
      kind: task.item.kind,
    });
  }

  return runUploadQueue(
    usable.map((task) => ({
      id: task.id,
      run: async (report: (ratio: number) => void): Promise<AssetSummary> => {
        const asset = await uploadAsset(task.file, {
          boardId,
          onProgress: (ratio) => {
            useUploadStore.getState().setProgress(task.id, ratio);
            report(ratio);
          },
        });
        storedFiles.delete(task.id);
        useAssetStore.getState().prime(asset);
        completeAssetCard(session, task.id, asset);
        useUploadStore.getState().complete(task.id, asset);
        return asset;
      },
    })),
    {
      concurrency: options.concurrency ?? UPLOAD_CONCURRENCY,
      onError: (id, error) => {
        useUploadStore
          .getState()
          .fail(id, error instanceof Error ? error.message : 'No se pudo subir el archivo');
      },
    },
  ).then(() => undefined);
}

/**
 * Sube un archivo dentro de una tarjeta que ya existe (la que creó la barra
 * lateral o el botón «Elegir archivo»). Si el tipo del archivo no coincide con
 * el de la tarjeta, se crea la tarjeta correcta al lado y se retira la vacía.
 */
export async function uploadIntoCard(
  session: BoardSession,
  elementId: string,
  file: File,
): Promise<void> {
  const element = session.getElement(elementId);
  if (!element) return;
  const classified = classifyDroppedFiles([file as DroppableFile]);
  const item = classified[0];
  if (!item) return;

  if (item.kind !== element.type) {
    const natural = await probeSizeFor(item, file);
    const size = cardSizeFor(item.kind, natural);
    // La tarjeta nueva ocupa el sitio de la vacía sin tapar nada más.
    const target = placementForNewElement({
      existing: rectsOf(session).filter((rect) => rect.x !== element.x || rect.y !== element.y),
      size,
      world: { x: element.x + element.width / 2, y: element.y + size.height / 2 },
    });
    removeElements(session.doc, [elementId], session.origin);
    const ids = createAssetCards(session, [{ kind: item.kind, position: target, size, natural }]);
    await runUploads(session, ids, [file], classified);
    return;
  }

  const natural = await probeSizeFor(item, file);
  const size = natural ? cardSizeFor(element.type, natural) : null;
  if (size && size.width < element.width) {
    patchElement(session.doc, elementId, { width: size.width }, session.origin);
  }
  await runUploads(session, [elementId], [file], classified);
}

/**
 * Reintenta la subida de una tarjeta con el archivo que quedó en memoria (el
 * usuario no tiene que volver a elegirlo). Si el archivo no está (se recargó la
 * página), no se hace nada: la tarjeta ofrece elegirlo de nuevo.
 */
export async function retryStoredUpload(session: BoardSession, elementId: string): Promise<void> {
  const file = storedFiles.get(elementId);
  if (!file) return;
  const element = session.getElement(elementId);
  if (!element) return;
  const classified = classifyDroppedFiles([file as DroppableFile]);
  if (element.type === assetKindFromMime(file.type)) {
    await runUploads(session, [elementId], [file], classified);
    return;
  }
  await uploadIntoCard(session, elementId, file);
}

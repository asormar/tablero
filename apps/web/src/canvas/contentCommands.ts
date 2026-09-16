/**
 * Comandos de contenido de la fase 2: tarjetas de archivo, de enlace y muestras
 * de color.
 *
 * Igual que el resto de comandos del lienzo: una llamada = una transacción = un
 * paso de deshacer, con `localOrigin` como origen. Los elementos nacen con
 * `assetId` vacío cuando el archivo todavía se está subiendo: la tarjeta existe
 * desde el primer momento y se completa cuando la API responde.
 */

import {
  type AssetKind,
  type AssetSummary,
  type CreateElementInit,
  type ImageCrop,
  type LinkEmbedType,
  type LinkPreviewData,
  type Point,
  type Size,
  DEFAULT_SIZES,
  addElement,
  patchElement,
} from '@tablero/shared';

import { type PaletteEntry } from '@/lib/palette';
import type { BoardSession } from '@/collab/BoardSession';
import { createChildInColumn } from '@/canvas/columnCommands';
import { useAppStore } from '@/state/appStore';

function currentUserId(): string {
  return useAppStore.getState().user.id;
}

export type LinkDisplaySize = 'compact' | 'medium' | 'large';

/** Anchura de cada tamaño de tarjeta de enlace (sección 6.11 del plan). */
export const LINK_DISPLAY_SIZES: Record<LinkDisplaySize, { width: number; label: string }> = {
  compact: { width: 220, label: 'Compacto' },
  medium: { width: 300, label: 'Mediano' },
  large: { width: 420, label: 'Grande' },
};

export const SWATCH_DEFAULT_HEX = '#2F6FC9';

export type AssetCardSpec = {
  kind: AssetKind;
  /** Esquina superior izquierda ya calculada (cascada del lote). */
  position: Point;
  /** Tamaño con el que nace la tarjeta. */
  size: Size;
  /** Medidas reales del archivo, si ya se conocen. */
  natural?: Size | null;
};

/**
 * Crea las tarjetas de un lote de archivos en **una sola** transacción: la
 * cascada de veinte imágenes se deshace de un tirón.
 */
export function createAssetCards(session: BoardSession, specs: readonly AssetCardSpec[]): string[] {
  if (specs.length === 0) return [];
  const createdBy = currentUserId();
  const ids: string[] = [];
  session.doc.transact(() => {
    for (const spec of specs) {
      const init: Record<string, unknown> = {
        x: Math.round(spec.position.x),
        y: Math.round(spec.position.y),
        width: Math.round(spec.size.width),
        assetId: '',
        createdBy,
      };
      if (spec.natural) {
        init['naturalWidth'] = Math.round(spec.natural.width);
        init['naturalHeight'] = Math.round(spec.natural.height);
      }
      if (spec.kind === 'file') init['height'] = DEFAULT_SIZES.file.height ?? 72;
      ids.push(addElement(session.doc, spec.kind, init as unknown as CreateElementInit, session.origin));
    }
  }, session.origin);
  return ids;
}

/** Tarjeta vacía de un tipo (al soltar la herramienta desde la barra lateral). */
export function createAssetCardAt(session: BoardSession, kind: AssetKind, position: Point, size: Size): string {
  const [id] = createAssetCards(session, [{ kind, position, size }]);
  return id ?? '';
}

/**
 * Tarjetas de un lote de archivos dentro de una columna (kanban). La posición
 * libre no importa: la columna las apila; se conservan las medidas naturales.
 */
export function createAssetCardsInColumn(
  session: BoardSession,
  columnId: string,
  specs: readonly AssetCardSpec[],
): string[] {
  if (specs.length === 0) return [];
  const ids: string[] = [];
  session.doc.transact(() => {
    for (const spec of specs) {
      const init: Record<string, unknown> = { assetId: '', width: Math.round(spec.size.width) };
      if (spec.natural) {
        init['naturalWidth'] = Math.round(spec.natural.width);
        init['naturalHeight'] = Math.round(spec.natural.height);
      }
      if (spec.kind === 'file') init['height'] = DEFAULT_SIZES.file.height ?? 72;
      const id = createChildInColumn(session, columnId, spec.kind, init);
      if (id) ids.push(id);
    }
  }, session.origin);
  return ids;
}

/** Completa una tarjeta con el archivo ya subido (una transacción). */
export function completeAssetCard(session: BoardSession, elementId: string, asset: AssetSummary): void {
  const element = session.getElement(elementId);
  if (!element) return;
  const patch: Record<string, unknown> = { assetId: asset.id };
  const kind = element.type;
  if (kind === 'image' || kind === 'video') {
    if (asset.width && asset.height) {
      patch['naturalWidth'] = asset.width;
      patch['naturalHeight'] = asset.height;
      // Una imagen más pequeña que la tarjeta se muestra a su tamaño natural.
      const base = DEFAULT_SIZES[kind].width;
      if (asset.width < base) patch['width'] = Math.max(80, Math.round(asset.width));
    }
  }
  patchElement(session.doc, elementId, patch, session.origin);
}

/** Campos editables de una tarjeta de archivo. */
export type AssetPatch = {
  caption?: string;
  crop?: ImageCrop;
  frameless?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
  width?: number;
};

export function updateAssetElement(session: BoardSession, elementId: string, patch: AssetPatch): void {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return;
  patchElement(session.doc, elementId, clean, session.origin);
}

/** Recorte (o su restablecimiento con `FULL_CROP`). */
export function setElementCrop(session: BoardSession, elementId: string, crop: ImageCrop): void {
  updateAssetElement(session, elementId, { crop });
}

// --- Enlaces ----------------------------------------------------------------

export function createLinkCardAt(
  session: BoardSession,
  world: Point,
  url: string,
  preview: LinkPreviewData | null,
  displaySize: LinkDisplaySize = 'medium',
): string {
  const { width } = LINK_DISPLAY_SIZES[displaySize];
  const createdBy = currentUserId();
  const init: Record<string, unknown> = {
    x: Math.round(world.x),
    y: Math.round(world.y),
    width,
    url,
    displaySize,
    createdBy,
  };
  if (preview) init['preview'] = preview;
  return addElement(session.doc, 'link', init as unknown as CreateElementInit, session.origin);
}

/** Datos de un incrustado detectado en el cliente, antes de que responda la API. */
export type InstantPreview = {
  embedType: LinkEmbedType;
  embedUrl: string | null;
  url: string;
};

/** Previsualización inmediata: lo que se puede saber sin salir a la red. */
export function instantLinkPreview(input: InstantPreview): LinkPreviewData {
  return {
    url: input.url,
    title: null,
    description: null,
    imageUrl: null,
    faviconUrl: null,
    siteName: null,
    embedType: input.embedType,
    embedUrl: input.embedUrl,
    // `fetchedAt: 0` marca que esto es provisional: la tarjeta todavía tiene que
    // pedir la previsualización real a la API (título, imagen, descripción).
    fetchedAt: 0,
  };
}

export function updateLinkElement(
  session: BoardSession,
  elementId: string,
  patch: { url?: string; preview?: LinkPreviewData },
): void {
  const clean: Record<string, unknown> = {};
  if (patch.url !== undefined) clean['url'] = patch.url;
  if (patch.preview !== undefined) clean['preview'] = patch.preview;
  if (Object.keys(clean).length === 0) return;
  patchElement(session.doc, elementId, clean, session.origin);
}

/** Cambia el tamaño de presentación y el ancho de la tarjeta a la vez. */
export function setLinkDisplaySize(session: BoardSession, elementId: string, size: LinkDisplaySize): void {
  patchElement(
    session.doc,
    elementId,
    { displaySize: size, width: LINK_DISPLAY_SIZES[size].width },
    session.origin,
  );
}

/** Título escrito a mano (sobre la previsualización que ya hubiera). */
export function setLinkTitle(session: BoardSession, elementId: string, title: string): void {
  const element = session.getElement(elementId);
  if (!element || element.type !== 'link') return;
  const preview: LinkPreviewData = {
    url: element.preview?.url ?? element.url,
    title,
    description: element.preview?.description ?? null,
    imageUrl: element.preview?.imageUrl ?? null,
    faviconUrl: element.preview?.faviconUrl ?? null,
    siteName: element.preview?.siteName ?? null,
    embedType: element.preview?.embedType ?? 'generic',
    embedUrl: element.preview?.embedUrl ?? null,
    fetchedAt: element.preview?.fetchedAt ?? Date.now(),
  };
  updateLinkElement(session, elementId, { preview });
}

// --- Muestras de color ------------------------------------------------------

export function createSwatchAt(
  session: BoardSession,
  world: Point,
  hex: string,
  name = '',
): string {
  const size = DEFAULT_SIZES.swatch;
  const createdBy = currentUserId();
  return addElement(
    session.doc,
    'swatch',
    {
      x: Math.round(world.x),
      y: Math.round(world.y),
      width: size.width,
      height: size.height ?? 112,
      hex,
      name,
      createdBy,
    },
    session.origin,
  );
}

export function updateSwatch(
  session: BoardSession,
  elementId: string,
  patch: { hex?: string; name?: string },
): void {
  const clean: Record<string, unknown> = {};
  if (patch.hex !== undefined) clean['hex'] = patch.hex;
  if (patch.name !== undefined) clean['name'] = patch.name;
  if (Object.keys(clean).length === 0) return;
  patchElement(session.doc, elementId, clean, session.origin);
}

/**
 * Crea una muestra por color extraído, en columna a la derecha de la imagen.
 * Todas van en una transacción (un solo paso de deshacer).
 */
export function createSwatchesForPalette(
  session: BoardSession,
  sourceId: string,
  entries: readonly PaletteEntry[],
): string[] {
  const source = session.getElement(sourceId);
  if (!source || entries.length === 0) return [];
  const size = DEFAULT_SIZES.swatch;
  const width = size.width;
  const height = size.height ?? 112;
  const gap = 16;
  let y = source.y;
  const x = source.x + source.width + gap;
  const createdBy = currentUserId();
  const ids: string[] = [];
  session.doc.transact(() => {
    for (const entry of entries) {
      ids.push(
        addElement(
          session.doc,
          'swatch',
          {
            x: Math.round(x),
            y: Math.round(y),
            width,
            height,
            hex: entry.hex,
            name: '',
            createdBy,
          },
          session.origin,
        ),
      );
      y += height + gap;
    }
  }, session.origin);
  return ids;
}

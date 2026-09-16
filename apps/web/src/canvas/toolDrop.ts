/**
 * Soltado de herramientas en el lienzo (arrastrar y soltar nativo).
 *
 * La barra lateral marca el tipo en el `dataTransfer`; aquí se decide qué
 * elemento crear en el punto exacto donde se suelta. Desde la fase 2 los tipos
 * de contenido crean una tarjeta vacía (o una muestra de color) que se completa
 * al elegir el archivo o al pegar el enlace.
 */

import {
  type AssetKind,
  type ElementType,
  type HeadingSize,
  type Point,
  DEFAULT_SIZES,
} from '@tablero/shared';

import {
  createBoardCardAt,
  createElementAt,
  createHeadingAt,
  createNoteAt,
  sizeForType,
} from '@/canvas/commands';
import {
  SWATCH_DEFAULT_HEX,
  createAssetCardAt,
  createLinkCardAt,
} from '@/canvas/contentCommands';
import { createNestedBoard } from '@/app/boardService';
import type { BoardSession } from '@/collab/BoardSession';
import { fallbackSizeFor } from '@/lib/fileDrop';

export const TOOL_MIME = 'application/x-tablero-tool';
export const HEADING_MIME = 'application/x-tablero-heading-size';

const ASSET_TOOLS: Partial<Record<ElementType, AssetKind>> = {
  image: 'image',
  file: 'file',
  video: 'video',
  audio: 'audio',
};

export function isToolDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes(TOOL_MIME);
}

/** ¿El arrastre trae archivos del sistema? */
export function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if ((dataTransfer.files?.length ?? 0) > 0) return true;
  return Array.from(dataTransfer.types).includes('Files');
}

export function hasFiles(dataTransfer: DataTransfer | null): boolean {
  return isFileDrag(dataTransfer);
}

/** Crea el elemento correspondiente a la herramienta soltada. */
export async function createToolAt(
  session: BoardSession,
  type: ElementType,
  world: { x: number; y: number },
  headingSize: HeadingSize | null,
  parentBoardId: string | null,
): Promise<string | null> {
  const assetKind = ASSET_TOOLS[type];
  if (assetKind) {
    // Tarjeta vacía: se completa al elegir el archivo (o al soltarlo encima).
    const topLeft: Point = {
      x: Math.round(world.x - fallbackSizeFor(assetKind).width / 2),
      y: Math.round(world.y - fallbackSizeFor(assetKind).height / 2),
    };
    return createAssetCardAt(session, assetKind, topLeft, fallbackSizeFor(assetKind));
  }

  switch (type) {
    case 'note':
      return createNoteAt(session, world);
    case 'heading':
      return createHeadingAt(session, world, headingSize ?? 'M');
    case 'board': {
      const board = await createNestedBoard(parentBoardId, 'Tablero sin título', null);
      return createBoardCardAt(session, world, board);
    }
    case 'link': {
      const size = DEFAULT_SIZES.link;
      return createLinkCardAt(
        session,
        {
          x: Math.round(world.x - size.width / 2),
          y: Math.round(world.y - (size.height ?? 96) / 2),
        },
        '',
        null,
      );
    }
    case 'swatch': {
      const size = DEFAULT_SIZES.swatch;
      return createElementAt(session, 'swatch', world, {
        size: sizeForType('swatch'),
        init: { hex: SWATCH_DEFAULT_HEX, name: '' },
        select: true,
      });
    }
    default:
      return createElementAt(session, type, world, { size: sizeForType(type) });
  }
}

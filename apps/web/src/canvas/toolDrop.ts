/**
 * Soltado de herramientas en el lienzo (arrastrar y soltar nativo).
 *
 * La barra lateral marca el tipo en el `dataTransfer`; aquí se decide qué
 * elemento crear en el punto exacto donde se suelta.
 */

import type { ElementType, HeadingSize } from '@tablero/shared';

import {
  createBoardCardAt,
  createElementAt,
  createHeadingAt,
  createNoteAt,
  sizeForType,
} from '@/canvas/commands';
import { createNestedBoard } from '@/app/boardService';
import type { BoardSession } from '@/collab/BoardSession';

export const TOOL_MIME = 'application/x-tablero-tool';
export const HEADING_MIME = 'application/x-tablero-heading-size';

export function isToolDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes(TOOL_MIME);
}

/** Crea el elemento correspondiente a la herramienta soltada. */
export async function createToolAt(
  session: BoardSession,
  type: ElementType,
  world: { x: number; y: number },
  headingSize: HeadingSize | null,
  parentBoardId: string | null,
): Promise<string | null> {
  switch (type) {
    case 'note':
      return createNoteAt(session, world);
    case 'heading':
      return createHeadingAt(session, world, headingSize ?? 'M');
    case 'board': {
      const board = await createNestedBoard(parentBoardId, 'Tablero sin título', null);
      return createBoardCardAt(session, world, board);
    }
    default:
      return createElementAt(session, type, world, { size: sizeForType(type) });
  }
}

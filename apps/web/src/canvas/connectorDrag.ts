/**
 * Creación de conectores arrastrando desde el borde de una tarjeta.
 *
 * El gesto se resuelve por completo en el cliente: una línea provisional sigue
 * al puntero y, al soltar, se decide el extremo destino mirando qué hay debajo
 * (el borde de otra tarjeta, un punto de anclaje concreto o el vacío, que deja
 * un extremo libre en el lienzo).
 */

import { type AnchorSide, type FixedSide, type Point } from '@tablero/shared';

import { worldFromClient } from '@/canvas/canvasRef';
import type { BoardSession } from '@/collab/BoardSession';
import { addConnector } from '@/lib/connectors';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

export type ConnectorDropTarget = { elementId: string; side: AnchorSide } | null;

/** Tarjeta (y punto de anclaje, si lo hay) bajo el puntero. */
export function connectorDropTargetAt(clientX: number, clientY: number, fromId: string): ConnectorDropTarget {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    const element = (node as HTMLElement).closest?.('[data-element-id]') as HTMLElement | null;
    if (!element) continue;
    const elementId = element.dataset.elementId;
    if (!elementId || elementId === fromId) continue;
    const anchor = (node as HTMLElement).closest?.('[data-anchor]') as HTMLElement | null;
    const side = anchor?.dataset.anchor;
    const valid = side === 'left' || side === 'right' || side === 'top' || side === 'bottom';
    return { elementId, side: valid ? (side as FixedSide) : 'auto' };
  }
  return null;
}

export type ConnectorDraft = { x1: number; y1: number; x2: number; y2: number };

export type ConnectorDragOptions = {
  session: BoardSession;
  fromId: string;
  /** Lado del borde desde el que se sale. */
  side: FixedSide;
  /** Punto de pantalla donde empezó el gesto (el ancla). */
  startClient: Point;
  /** Línea provisional en coordenadas locales del lienzo. */
  onPreview(draft: ConnectorDraft | null): void;
};

export type ConnectorDrag = {
  move(clientX: number, clientY: number): void;
  end(commit: boolean, clientX: number, clientY: number): void;
};

export function startConnectorDrag(options: ConnectorDragOptions): ConnectorDrag {
  const { session, fromId, side } = options;
  const canvas = document.querySelector('.canvas')?.getBoundingClientRect();
  const left = canvas?.left ?? 0;
  const top = canvas?.top ?? 0;
  const originX = options.startClient.x - left;
  const originY = options.startClient.y - top;
  let done = false;

  return {
    move(clientX, clientY) {
      if (done) return;
      options.onPreview({ x1: originX, y1: originY, x2: clientX - left, y2: clientY - top });
    },
    end(commit, clientX, clientY) {
      if (done) return;
      done = true;
      options.onPreview(null);
      if (!commit) return;
      const drop = connectorDropTargetAt(clientX, clientY, fromId);
      const createdBy = useAppStore.getState().user.id;
      const freePoint = worldFromClient(clientX, clientY);
      const id = drop
        ? addConnector(
            session.doc,
            { elementId: fromId, side, offset: 0.5, point: freePoint },
            { elementId: drop.elementId, side: drop.side, offset: 0.5, point: freePoint },
            session.origin,
            { createdBy: createdBy },
          )
        : addConnector(
            session.doc,
            { elementId: fromId, side, offset: 0.5, point: freePoint },
            { elementId: null, side: 'auto', offset: 0.5, point: freePoint },
            session.origin,
            { createdBy: createdBy, style: { endArrow: 'arrow' } },
          );
      useUiStore.getState().setSelectedConnector(id);
    },
  };
}

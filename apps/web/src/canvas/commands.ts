/**
 * Comandos del tablero.
 *
 * Toda mutación del documento pasa por aquí para que:
 * - se agrupe en una única transacción (un solo paso de deshacer),
 * - el origen sea siempre `localOrigin` (deshacer propio, nunca el de otros),
 * - el estado de interfaz (selección, edición, viewport) quede coherente.
 */

import {
  type AlignAction,
  type BoardSummary,
  type CanvasElement,
  type ColorToken,
  type CreateElementInit,
  type ElementType,
  type HeadingSize,
  type Point,
  type Rect,
  type Size,
  DEFAULT_SIZES,
  GRID_SIZE,
  addElement,
  boundsOf,
  bringToFront,
  duplicateElements,
  elementRect,
  ensureTextFragment,
  fitRect,
  getTextFragment,
  isRichTextType,
  moveElements,
  pasteClipboard,
  patchElement,
  patchElements,
  removeElements,
  resizeElements,
  scaleStroke,
  sendToBack,
  serializeForClipboard,
  snapPointToGrid,
  trashElements,
} from '@tablero/shared';

import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';
import {
  getInternalClipboard,
  readSystemText,
  setInternalClipboard,
  writeSystemText,
} from '@/lib/clipboard';
import { type ElementLayout, rectOf } from '@/lib/layout';
import { removeConnectors } from '@/lib/connectors';
import { blocksToPlainText } from '@/lib/textBlocks';
import { alignmentMoves } from '@/lib/align';
import { nudgeMoves } from '@/lib/dragMath';
import {
  createLinkCardAt,
  createSwatchAt,
  instantLinkPreview,
} from '@/canvas/contentCommands';
import { placementForNewElement } from '@/lib/placement';
import { PERF_NOTE_COUNT, seedTestNotes } from '@/lib/seedTestNotes';
import { planPasteTarget } from '@/lib/pasteTargets';
import {
  type XmlSnapshotNode,
  cloneFragment,
  restoreFragment,
  snapshotFragment,
  writePlainText,
} from '@/lib/xmlFragment';
import type { BoardSession } from '@/collab/BoardSession';
import { reportBoardActivity } from '@/collab/activityBridge';
import { capabilityRefusal } from '@/collab/roles';

const DEFAULT_NOTE_HEIGHT = 120;

function currentUserId(): string {
  return useAppStore.getState().user.id;
}

/**
 * Guarda de escritura de la fase 5: sin permiso de edición la mutación no corre
 * y se explica por qué. El aviso se repite como mucho cada 4 s para que un gesto
 * insistente no llene la pantalla de mensajes.
 */
let lastRefusalAt = 0;

export function allowWrite(session: BoardSession, capability: 'edit' | 'comment' = 'edit'): boolean {
  if (session.can(capability)) return true;
  const refusal = capabilityRefusal(session.getRole(), capability);
  if (refusal) {
    const now = Date.now();
    if (now - lastRefusalAt > 4000) {
      lastRefusalAt = now;
      useAppStore.getState().setNotice(refusal);
    }
  }
  return false;
}

export function sizeForType(type: ElementType): Size {
  const size = DEFAULT_SIZES[type];
  return { width: size.width, height: size.height ?? DEFAULT_NOTE_HEIGHT };
}

/** Rectángulos de todos los elementos (mundo), con las alturas medidas. */
export function rectsOf(session: BoardSession, exclude?: ReadonlySet<string>): Rect[] {
  const { measuredHeights } = useUiStore.getState();
  const rects: Rect[] = [];
  for (const item of session.getLayout()) {
    if (exclude?.has(item.id)) continue;
    rects.push(rectOf(item, measuredHeights));
  }
  return rects;
}

export function layoutItems(ids: string[], layout: ElementLayout[]): ElementLayout[] {
  if (ids.length === 0) return [];
  const wanted = new Set(ids);
  return layout.filter((item) => wanted.has(item.id));
}

export function selectionItems(session: BoardSession): ElementLayout[] {
  const { selection } = useUiStore.getState();
  return layoutItems(selection, session.getLayout());
}

export function selectionRects(session: BoardSession): Rect[] {
  const { measuredHeights } = useUiStore.getState();
  return selectionItems(session).map((item) => rectOf(item, measuredHeights));
}

/** Selecciona los elementos que caen dentro de un rectángulo de mundo. */
export function idsInRect(layout: ElementLayout[], rect: Rect): string[] {
  const { measuredHeights } = useUiStore.getState();
  const result: string[] = [];
  for (const item of layout) {
    const box = rectOf(item, measuredHeights);
    const overlaps =
      box.x < rect.x + rect.width &&
      rect.x < box.x + box.width &&
      box.y < rect.y + rect.height &&
      rect.y < box.y + box.height;
    if (overlaps) result.push(item.id);
  }
  return result;
}

// --- Creación ---------------------------------------------------------------

export type CreateOptions = {
  size?: Size;
  init?: Record<string, unknown>;
  text?: string;
  color?: ColorToken;
  hex?: string;
  select?: boolean;
  edit?: boolean;
};

/**
 * Crea un elemento en el punto de mundo pedido (centrado, ajustado a rejilla y
 * sin tapar lo que ya hay). Devuelve su id.
 */
export function createElementAt(
  session: BoardSession,
  type: ElementType,
  world: Point,
  options: CreateOptions = {},
): string {
  if (!allowWrite(session)) return '';
  const size = options.size ?? sizeForType(type);
  const point = placementForNewElement({ existing: rectsOf(session), size, world });
  const createdBy = currentUserId();
  let id = '';

  session.doc.transact(() => {
    const init: Record<string, unknown> = {
      x: point.x,
      y: point.y,
      width: size.width,
      createdBy,
      ...(options.init ?? {}),
    };
    if (size.height > 0 && (options.init?.['height'] === undefined || options.init['height'] === null)) {
      if (type === 'board' || type === 'heading') init['height'] = size.height;
    }
    id = addElement(session.doc, type, init as unknown as CreateElementInit, session.origin);

    // Las tarjetas de texto nacen con su `Y.XmlFragment`: el editor lo necesita
    // desde el primer momento, aunque la nota esté vacía.
    if (isRichTextType(type) || (options.text !== undefined && options.text.length > 0)) {
      const fragment = ensureTextFragment(session.doc, id, session.origin);
      if (fragment && options.text !== undefined && options.text.length > 0) {
        writePlainText(fragment, options.text, session.origin);
      }
    }
    if (options.color) patchElement(session.doc, id, { color: options.color }, session.origin);
    if (options.hex) patchElement(session.doc, id, { hex: options.hex }, session.origin);
  }, session.origin);

  const ui = useUiStore.getState();
  if (options.select !== false) ui.select([id]);
  if (options.edit) ui.setEditing(id);
  reportBoardActivity(session, { action: 'element.create', elementId: id, elementType: type });
  return id;
}

export function createNoteAt(
  session: BoardSession,
  world: Point,
  options: { text?: string; color?: ColorToken; hex?: string } = {},
): string {
  return createElementAt(session, 'note', world, {
    size: { width: DEFAULT_SIZES.note.width, height: DEFAULT_NOTE_HEIGHT },
    edit: options.text === undefined,
    ...(options.text !== undefined ? { text: options.text } : {}),
    ...(options.color ? { color: options.color } : {}),
    ...(options.hex ? { hex: options.hex } : {}),
  });
}

export function createHeadingAt(session: BoardSession, world: Point, size: HeadingSize = 'M'): string {
  const widths: Record<HeadingSize, number> = { S: 220, M: 320, L: 420, XL: 560 };
  return createElementAt(session, 'heading', world, {
    size: { width: widths[size], height: DEFAULT_SIZES.heading.height ?? 44 },
    init: { size },
    edit: true,
  });
}

export function createBoardCardAt(session: BoardSession, world: Point, board: BoardSummary): string {
  const size = sizeForType('board');
  return createElementAt(session, 'board', world, {
    size,
    init: { boardId: board.id, icon: board.icon ?? '📋' },
  });
}

/**
 * Crea lo que corresponde al texto pegado (pegado inteligente de la fase 2):
 * un enlace crea tarjeta de enlace (con el incrustado listo al instante), un
 * color crea una muestra y el resto, una nota con ese texto.
 */
export function createFromPaste(session: BoardSession, world: Point, text: string | null): string[] {
  const plan = planPasteTarget({ text });
  if (plan.kind === 'empty' || plan.kind === 'files' || plan.kind === 'elements') return [];
  if (plan.kind === 'link') {
    const size = DEFAULT_SIZES.link;
    const preview = instantLinkPreview({
      url: plan.url,
      embedType: plan.embed.embedType,
      embedUrl: plan.embed.embedUrl,
    });
    const id = createLinkCardAt(
      session,
      { x: world.x - size.width / 2, y: world.y - (size.height ?? 96) / 2 },
      plan.url,
      preview,
    );
    return [id];
  }
  if (plan.kind === 'swatch') {
    const size = DEFAULT_SIZES.swatch;
    const id = createSwatchAt(
      session,
      { x: world.x - size.width / 2, y: world.y - (size.height ?? 112) / 2 },
      plan.hex,
      plan.name,
    );
    return [id];
  }
  return [createNoteAt(session, world, { text: plan.text })];
}

// --- Mutaciones sobre la selección -------------------------------------------

/**
 * Borra la selección entera —tarjetas **y** conectores— en **una sola**
 * transacción: un `Deshacer` devuelve todo junto, sin pasos intermedios.
 *
 * Las tarjetas van a la **papelera** (marca `deletedAt`), no salen del
 * documento: es lo que hace posible el panel de papelera y el restaurar; el
 * texto enriquecido no se mueve y `Ctrl/Cmd+Z` sigue devolviendo la tarjeta sin
 * dejar copia (el deshacer quita la marca). Los assets se liberan recién cuando
 * el elemento sale del documento para siempre (ver `emptyTrashForever`). Los
 * conectores se quitan del documento (no tienen papelera): el deshacer los
 * devuelve enteros.
 */
export function deleteSelection(session: BoardSession): void {
  const ui = useUiStore.getState();
  const ids = ui.selection;
  const connectorIds = ui.selectedConnectorIds;
  if (ids.length === 0 && connectorIds.length === 0) return;
  if (!allowWrite(session)) return;
  session.doc.transact(() => {
    if (ids.length > 0) trashElements(session.doc, ids, session.origin, { deletedBy: currentUserId() });
    if (connectorIds.length > 0) removeConnectors(session.doc, connectorIds, session.origin);
  }, session.origin);
  ui.setEditing(null);
  ui.clearSelection();
  ui.setSelectedConnectors([]);
  for (const id of ids) {
    const element = session.getElement(id);
    reportBoardActivity(session, { action: 'element.delete', elementId: id, elementType: element?.type ?? null });
  }
}

export function duplicateSelection(session: BoardSession, offset = { dx: 24, dy: 24 }): string[] {
  const ids = useUiStore.getState().selection;
  if (ids.length === 0) return [];
  if (!allowWrite(session)) return [];
  const newIds = duplicateElements(session.doc, ids, offset, session.origin, {
    createdBy: currentUserId(),
    cloneText: (source, destination) => {
      cloneFragment(source, destination);
    },
  });
  if (newIds.length > 0) useUiStore.getState().select(newIds);
  return newIds;
}

export function copySelection(session: BoardSession): void {
  const ids = useUiStore.getState().selection;
  if (ids.length === 0) return;
  const payload = serializeForClipboard(session.doc, ids);
  const texts: Record<string, unknown> = {};
  const plain: string[] = [];
  for (const element of payload.elements) {
    const fragment = getTextFragment(session.doc, element.id);
    if (!fragment) continue;
    texts[element.id] = snapshotFragment(fragment);
    const text = blocksToPlainText(session.getTextBlocks(element.id));
    if (text.length > 0) plain.push(text);
  }
  payload.texts = texts;
  setInternalClipboard(payload, plain.join('\n\n'));
  void writeSystemText(plain.join('\n\n'));
}

export function cutSelection(session: BoardSession): void {
  const ids = useUiStore.getState().selection;
  if (ids.length === 0) return;
  copySelection(session);
  deleteSelection(session);
}

/** Pega el contenido interno en el punto pedido. Devuelve los ids nuevos. */
export function pasteInternalAt(session: BoardSession, world: Point): string[] {
  const clipboard = getInternalClipboard();
  if (!clipboard || clipboard.payload.elements.length === 0) return [];
  if (!allowWrite(session)) return [];
  const payload = clipboard.payload;
  const elements = payload.elements;

  const boxes: Rect[] = elements.map((element) => elementRect(element, DEFAULT_NOTE_HEIGHT));
  const box = boundsOf(boxes) ?? { x: 0, y: 0, width: 240, height: DEFAULT_NOTE_HEIGHT };
  const target = placementForNewElement({
    existing: rectsOf(session),
    size: { width: box.width, height: box.height },
    world,
  });

  const sorted = [...elements].sort((a, b) => a.createdAt - b.createdAt);
  const newIds = pasteClipboard(session.doc, payload, session.origin, {
    dx: 0,
    dy: 0,
    createdBy: currentUserId(),
    at: target,
  });

  session.doc.transact(() => {
    newIds.forEach((newId, index) => {
      const source = sorted[index];
      if (!source) return;
      const snapshot = payload.texts?.[source.id] as XmlSnapshotNode[] | undefined;
      if (!snapshot || snapshot.length === 0) return;
      const destination = ensureTextFragment(session.doc, newId, session.origin);
      if (destination) restoreFragment(destination, snapshot);
    });
  }, session.origin);

  if (newIds.length > 0) useUiStore.getState().select(newIds);
  return newIds;
}

/** Pega: primero el portapapeles interno, si no el del sistema. */
export async function pasteAt(session: BoardSession, world: Point): Promise<string[]> {
  if (!allowWrite(session)) return [];
  const ids = pasteInternalAt(session, world);
  if (ids.length > 0) return ids;
  const text = await readSystemText();
  const created = createFromPaste(session, world, text);
  return created;
}

export function nudgeSelection(session: BoardSession, dx: number, dy: number): void {
  const items = selectionItems(session);
  if (items.length === 0) return;
  if (!allowWrite(session)) return;
  const moves = nudgeMoves(
    items.map((item) => ({ id: item.id, x: item.x, y: item.y })),
    dx,
    dy,
  );
  moveElements(session.doc, moves, session.origin);
  for (const move of moves) {
    reportBoardActivity(session, { action: 'element.move', elementId: move.id });
  }
}

export function alignSelection(session: BoardSession, action: AlignAction): void {
  const { measuredHeights } = useUiStore.getState();
  const items = selectionItems(session).map((item) => ({ id: item.id, rect: rectOf(item, measuredHeights) }));
  const moves = alignmentMoves(items, action);
  if (moves.length === 0) return;
  if (!allowWrite(session)) return;
  moveElements(session.doc, moves, session.origin);
}

export function setSelectionColor(session: BoardSession, token: ColorToken): void {
  const ids = useUiStore.getState().selection;
  if (ids.length === 0) return;
  if (!allowWrite(session)) return;
  const patch: Record<string, unknown> = { color: token };
  // Una nota que venía de un color literal pasa a usar la paleta.
  for (const id of ids) {
    const element = session.getElement(id);
    if (element && element.type !== 'swatch' && 'hex' in element && element.hex) patch['hex'] = null;
  }
  patchElements(session.doc, ids, patch, session.origin);
  for (const id of ids) {
    reportBoardActivity(session, { action: 'element.edit', elementId: id });
  }
}

export function bringSelectionToFront(session: BoardSession): void {
  const ids = useUiStore.getState().selection;
  if (ids.length > 0) bringToFront(session.doc, ids, session.origin);
}

export function sendSelectionToBack(session: BoardSession): void {
  const ids = useUiStore.getState().selection;
  if (ids.length > 0) sendToBack(session.doc, ids, session.origin);
}

export function toggleSelectionLock(session: BoardSession): boolean {
  const ui = useUiStore.getState();
  const ids = ui.selection;
  if (ids.length === 0) return false;
  const elements = ids
    .map((id) => session.getElement(id))
    .filter((element): element is CanvasElement => element !== null);
  if (elements.length === 0) return false;
  const allLocked = elements.every((element) => element.locked === true);
  patchElements(session.doc, ids, { locked: !allLocked }, session.origin);
  return !allLocked;
}

/**
 * Ancho, posición y alto de un redimensionado (al soltar, una transacción).
 *
 * `height` llega solo desde el tirador de esquina en tarjetas con alto propio
 * (mapa, dibujo): el gesto pinta los dos ejes y el commit los escribe, así el
 * resultado final es exactamente el que se vio durante el arrastre.
 */
export function resizeSelectionWidth(
  session: BoardSession,
  changes: { id: string; x: number; width: number; height?: number }[],
): void {
  if (changes.length === 0) return;
  session.doc.transact(() => {
    for (const change of changes) {
      const element = session.getElement(change.id);
      if (!element) continue;
      patchElement(
        session.doc,
        change.id,
        { x: change.x, width: change.width, ...(change.height !== undefined ? { height: change.height } : {}) },
        session.origin,
        { touch: false },
      );
      // El dibujo se escala con la tarjeta: si no, el trazo queda deformado.
      if (element.type === 'sketch' && element.width > 0) {
        const scale = change.width / element.width;
        const height = change.height ?? element.height ?? DEFAULT_SIZES.sketch.height ?? 220;
        patchElement(
          session.doc,
          change.id,
          {
            strokes: (element.strokes ?? []).map((stroke) => scaleStroke(stroke, scale, scale)),
            height: Math.max(48, Math.round(height)),
          },
          session.origin,
          { touch: false },
        );
      }
    }
    resizeElements(
      session.doc,
      changes.map((change) => ({ id: change.id, width: change.width, height: change.height })),
      session.origin,
    );
  }, session.origin);
}

// --- Selección y viewport ---------------------------------------------------

export function selectAll(session: BoardSession): void {
  const ids = session.getLayout().map((item) => item.id);
  if (ids.length === 0) return;
  useUiStore.getState().select(ids);
}

export function clearSelectionAndEditing(): void {
  const ui = useUiStore.getState();
  ui.setEditing(null);
  ui.clearSelection();
  ui.setContextMenu(null);
}

/**
 * Salto a un elemento (vista global de tareas): lo selecciona y centra la vista
 * en su tarjeta. Si vive dentro de una columna, el encuadre usa la columna
 * (los hijos no tienen posición libre). Devuelve `false` si el elemento no está.
 */
export function focusElementInView(session: BoardSession, id: string): boolean {
  const element = session.getElement(id);
  if (!element) return false;

  // Padre superior (una tarea dentro de una columna se enmarca con su columna).
  let top = element;
  const seen = new Set<string>([top.id]);
  while (top.parentId && !seen.has(top.parentId)) {
    seen.add(top.parentId);
    const parent = session.getElement(top.parentId);
    if (!parent) break;
    top = parent;
  }

  const ui = useUiStore.getState();
  ui.select([id]);
  const item = session.getLayout().find((entry) => entry.id === top.id);
  if (!item) return true;

  const rect = rectOf(item, ui.measuredHeights);
  const scale = Math.min(1, Math.max(ui.viewport.scale, 0.6));
  ui.setViewport({
    x: rect.x + rect.width / 2 - ui.canvasSize.width / (2 * scale),
    y: rect.y + rect.height / 2 - ui.canvasSize.height / (2 * scale),
    scale,
  });
  return true;
}

export function fitToScreen(session: BoardSession): void {
  const ui = useUiStore.getState();
  const bounds = session.bounds(ui.measuredHeights);
  ui.zoomToFit(fitRect(bounds, ui.canvasSize, { padding: 96, maxScale: 1.5 }));
}

export function zoomTo100(): void {
  const ui = useUiStore.getState();
  const anchor = { x: ui.canvasSize.width / 2, y: ui.canvasSize.height / 2 };
  ui.zoomAtPoint(anchor, 1);
}

export function zoomToStepFromKey(direction: 1 | -1): void {
  const ui = useUiStore.getState();
  const anchor = { x: ui.canvasSize.width / 2, y: ui.canvasSize.height / 2 };
  ui.zoomStep(direction, anchor);
}

/** Centro del viewport en coordenadas de mundo. */
export function viewportCenter(): Point {
  const ui = useUiStore.getState();
  const { viewport, canvasSize } = ui;
  return {
    x: viewport.x + canvasSize.width / 2 / viewport.scale,
    y: viewport.y + canvasSize.height / 2 / viewport.scale,
  };
}

/** Punto de mundo para un elemento nuevo creado desde el teclado. */
export function spawnPoint(): Point {
  return snapPointToGrid(viewportCenter(), GRID_SIZE);
}

/**
 * Abre el editor de una tarjeta (doble clic). El texto enriquecido necesita su
 * `Y.XmlFragment` desde el primer momento; las tarjetas que no son de texto no
 * tienen edición en línea.
 */
export function editElement(session: BoardSession, id: string): void {
  const element = session.getElement(id);
  if (!element) return;
  if (!isRichTextType(element.type)) return;
  if (!allowWrite(session)) return;
  session.ensureTextFragment(id);
  useUiStore.getState().setEditing(id);
  reportBoardActivity(session, { action: 'element.edit', elementId: id, elementType: element.type });
}

/** Quita de la selección los elementos (y conectores) que ya no existen (tras deshacer). */
export function pruneSelection(session: BoardSession): void {
  const ui = useUiStore.getState();
  const existingConnectors = new Set(session.getConnectors().map((connector) => connector.id));
  if (ui.selectedConnectorIds.some((id) => !existingConnectors.has(id))) {
    ui.setSelectedConnectors(ui.selectedConnectorIds.filter((id) => existingConnectors.has(id)));
  }
  if (ui.selection.length === 0) return;
  const existing = new Set(session.getLayout().map((item) => item.id));
  const next = ui.selection.filter((id) => existing.has(id));
  if (next.length === ui.selection.length) return;
  ui.select(next);
  if (ui.editingId && !existing.has(ui.editingId)) ui.setEditing(null);
}

export function undoWithPrune(session: BoardSession): void {
  session.undo();
  pruneSelection(session);
}

export function redoWithPrune(session: BoardSession): void {
  session.redo();
  pruneSelection(session);
}

/** Genera las notas de prueba (300 por defecto) a la derecha de lo existente. */
export function seedPerfNotes(session: BoardSession, count = PERF_NOTE_COUNT): number {
  const bounds = session.bounds(useUiStore.getState().measuredHeights);
  const origin = bounds ? { x: bounds.x + bounds.width + 320, y: bounds.y } : { x: 0, y: 0 };
  return seedTestNotes(session.doc, {
    count,
    origin,
    createdBy: currentUserId(),
    columns: 20,
  }).length;
}

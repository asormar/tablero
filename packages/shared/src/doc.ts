/**
 * Documento del tablero (Yjs) y operaciones de dominio.
 *
 * Estructura (sección 3.2 del plan):
 *
 *   doc.getMap('elements')   : Y.Map<ElementId, Y.Map>
 *   doc.getArray('order')    : Y.Array<ElementId>   (orden de apilado)
 *   doc.getMap('connectors') : Y.Map<ConnectorId, Y.Map>
 *
 * Toda mutación pasa por aquí para que las transacciones (y por tanto el
 * deshacer/rehacer) agrupen un gesto completo del usuario.
 */

import * as Y from 'yjs';

import {
  DEFAULT_SIZES,
  type CanvasElement,
  type ElementType,
  type TodoItem,
} from './elements.js';
import { boundsOf, type Rect } from './geometry.js';
import { createElementId } from './ids.js';

export const ELEMENTS_KEY = 'elements';
export const ORDER_KEY = 'order';
export const CONNECTORS_KEY = 'connectors';
export const META_KEY = 'meta';

export type ElementMap = Y.Map<unknown>;
export type ElementStore = Y.Map<ElementMap>;
export type ConnectorMap = Y.Map<unknown>;
export type ConnectorStore = Y.Map<ConnectorMap>;

export function createBoardDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap(ELEMENTS_KEY);
  doc.getArray(ORDER_KEY);
  doc.getMap(CONNECTORS_KEY);
  doc.getMap(META_KEY);
  return doc;
}

export function elementsOf(doc: Y.Doc): ElementStore {
  return doc.getMap(ELEMENTS_KEY) as ElementStore;
}

export function orderOf(doc: Y.Doc): Y.Array<string> {
  return doc.getArray<string>(ORDER_KEY);
}

export function connectorsOf(doc: Y.Doc): ConnectorStore {
  return doc.getMap(CONNECTORS_KEY) as ConnectorStore;
}

/** Altura de reserva cuando el usuario no ha fijado una y no hay medición. */
export function fallbackHeight(type: ElementType): number {
  return DEFAULT_SIZES[type]?.height ?? 48;
}

/** Rectángulo de un elemento. `measuredHeight` viene del ResizeObserver en la UI. */
export function elementRect(element: CanvasElement, measuredHeight?: number): Rect {
  const height = element.height ?? measuredHeight ?? fallbackHeight(element.type);
  return { x: element.x, y: element.y, width: element.width, height };
}

export function boundsOfElements(elements: CanvasElement[], measured?: Map<string, number>): Rect | null {
  return boundsOf(elements.map((el) => elementRect(el, measured?.get(el.id))));
}

const RESERVED_KEYS = new Set(['text']);

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Lee un `Y.Map` y lo convierte en un elemento tipado (o null si está corrupto). */
export function readElement(map: ElementMap): CanvasElement | null {
  const id = asString(map.get('id'));
  const type = asString(map.get('type')) as ElementType | undefined;
  if (!id || !type) return null;
  const base = {
    id,
    type,
    x: asNumber(map.get('x')) ?? 0,
    y: asNumber(map.get('y')) ?? 0,
    width: asNumber(map.get('width')) ?? DEFAULT_SIZES[type]?.width ?? 200,
    createdBy: asString(map.get('createdBy')) ?? 'unknown',
    createdAt: asNumber(map.get('createdAt')) ?? 0,
    updatedAt: asNumber(map.get('updatedAt')) ?? 0,
  } as unknown as CanvasElement;

  const target = base as Record<string, unknown>;
  const height = asNumber(map.get('height'));
  if (height !== undefined) target.height = height;
  const parentId = asString(map.get('parentId'));
  if (parentId !== undefined) target.parentId = parentId;
  const color = asString(map.get('color'));
  if (color !== undefined) target.color = color;
  const hex = asString(map.get('hex'));
  if (hex !== undefined) target.hex = hex;
  const commentsCount = asNumber(map.get('commentsCount'));
  if (commentsCount !== undefined) target.commentsCount = commentsCount;
  const locked = asBoolean(map.get('locked'));
  if (locked !== undefined) target.locked = locked;
  const deletedAt = asNumber(map.get('deletedAt'));
  if (deletedAt !== undefined) target.deletedAt = deletedAt;
  const deletedBy = asString(map.get('deletedBy'));
  if (deletedBy !== undefined) target.deletedBy = deletedBy;

  switch (type) {
    case 'note':
    case 'document':
    case 'heading': {
      const size = asString(map.get('size'));
      if (size !== undefined) target.size = size;
      break;
    }
    case 'todo': {
      const items = map.get('items');
      if (Array.isArray(items)) target.items = items as TodoItem[];
      const title = asString(map.get('title'));
      if (title !== undefined) target.title = title;
      const hideCompleted = asBoolean(map.get('hideCompleted'));
      if (hideCompleted !== undefined) target.hideCompleted = hideCompleted;
      break;
    }
    case 'board': {
      target.boardId = asString(map.get('boardId')) ?? '';
      const icon = asString(map.get('icon'));
      if (icon !== undefined) target.icon = icon;
      const coverAssetId = asString(map.get('coverAssetId'));
      if (coverAssetId !== undefined) target.coverAssetId = coverAssetId;
      const showPreview = asBoolean(map.get('showPreview'));
      if (showPreview !== undefined) target.showPreview = showPreview;
      break;
    }
    case 'column': {
      target.title = asString(map.get('title')) ?? '';
      const collapsed = asBoolean(map.get('collapsed'));
      if (collapsed !== undefined) target.collapsed = collapsed;
      break;
    }
    case 'image':
    case 'file':
    case 'video':
    case 'audio': {
      target.assetId = asString(map.get('assetId')) ?? '';
      const caption = asString(map.get('caption'));
      if (caption !== undefined) target.caption = caption;
      const crop = map.get('crop');
      if (crop !== undefined) target.crop = crop;
      const frameless = asBoolean(map.get('frameless'));
      if (frameless !== undefined) target.frameless = frameless;
      const naturalWidth = asNumber(map.get('naturalWidth'));
      if (naturalWidth !== undefined) target.naturalWidth = naturalWidth;
      const naturalHeight = asNumber(map.get('naturalHeight'));
      if (naturalHeight !== undefined) target.naturalHeight = naturalHeight;
      break;
    }
    case 'link': {
      target.url = asString(map.get('url')) ?? '';
      const preview = map.get('preview');
      if (preview !== undefined) target.preview = preview;
      const displaySize = asString(map.get('displaySize'));
      if (displaySize !== undefined) target.displaySize = displaySize;
      break;
    }
    case 'swatch': {
      target.hex = asString(map.get('hex')) ?? '#FFFFFF';
      const name = asString(map.get('name'));
      if (name !== undefined) target.name = name;
      break;
    }
    case 'sketch': {
      target.strokes = (map.get('strokes') as unknown[]) ?? [];
      const background = asString(map.get('background'));
      if (background !== undefined) target.background = background;
      break;
    }
    case 'table': {
      target.table = map.get('table');
      break;
    }
    case 'map': {
      target.map = map.get('map');
      break;
    }
    case 'comment-pin': {
      const resolved = asBoolean(map.get('resolved'));
      if (resolved !== undefined) target.resolved = resolved;
      break;
    }
    default:
      break;
  }

  return base;
}

/**
 * Escribe los campos de un elemento en su `Y.Map`.
 * Nunca toca `text` (el `Y.XmlFragment` del texto enriquecido).
 */
export function writeElement(map: ElementMap, element: CanvasElement): void {
  for (const [key, value] of Object.entries(element as Record<string, unknown>)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (value === undefined) continue;
    map.set(key, value);
  }
}

function newElementMap(element: CanvasElement): ElementMap {
  const map = new Y.Map<unknown>();
  writeElement(map, element);
  return map;
}

function transact<T>(doc: Y.Doc, origin: unknown, fn: () => T): T {
  let result!: T;
  doc.transact(() => {
    result = fn();
  }, origin);
  return result;
}

/** Aplica `Partial` distribuyendo sobre la unión (cada variante conserva sus campos). */
type DistributivePartial<T> = T extends unknown ? Partial<T> : never;

export type CreateElementInit = DistributivePartial<CanvasElement> & {
  id?: string;
  createdBy: string;
  now?: number;
};

/** Crea y registra un elemento en el documento. Devuelve su id. */
export function addElement(
  doc: Y.Doc,
  type: ElementType,
  init: CreateElementInit,
  origin: unknown,
): string {
  const id = init.id ?? createElementId();
  const now = init.now ?? Date.now();
  const element = {
    ...init,
    id,
    type,
    x: init.x ?? 0,
    y: init.y ?? 0,
    width: init.width ?? DEFAULT_SIZES[type]?.width ?? 200,
    createdBy: init.createdBy,
    createdAt: now,
    updatedAt: now,
  } as CanvasElement;

  transact(doc, origin, () => {
    const map = newElementMap(element);
    elementsOf(doc).set(id, map);
    orderOf(doc).push([id]);
    if (type === 'column') {
      map.set('childrenIds', new Y.Array<string>());
    }
  });
  return id;
}

/** Inserta un elemento ya construido (importación, pegado, duplicado). */
export function insertElement(doc: Y.Doc, element: CanvasElement, origin: unknown, index?: number): void {
  transact(doc, origin, () => {
    const map = newElementMap(element);
    elementsOf(doc).set(element.id, map);
    const order = orderOf(doc);
    if (index === undefined || index >= order.length) {
      order.push([element.id]);
    } else {
      order.insert(Math.max(0, index), [element.id]);
    }
  });
}

export function getElement(doc: Y.Doc, id: string): CanvasElement | null {
  const map = elementsOf(doc).get(id);
  return map ? readElement(map) : null;
}

export function getElementMap(doc: Y.Doc, id: string): ElementMap | undefined {
  return elementsOf(doc).get(id);
}

export function getElements(doc: Y.Doc): CanvasElement[] {
  const result: CanvasElement[] = [];
  elementsOf(doc).forEach((map) => {
    const element = readElement(map);
    if (element && !isTrashed(element)) result.push(element);
  });
  return result;
}

/** Elementos ordenados por z-index (el último de `order` se dibuja encima). */
export function getOrderedElements(doc: Y.Doc): CanvasElement[] {
  const store = elementsOf(doc);
  const seen = new Set<string>();
  const result: CanvasElement[] = [];
  orderOf(doc).forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const map = store.get(id);
    if (!map) return;
    const element = readElement(map);
    if (element && !isTrashed(element)) result.push(element);
  });
  // Elementos huérfanos (sin entrada en `order`): al final, ordenados por creación.
  store.forEach((map, id) => {
    if (seen.has(id)) return;
    const element = readElement(map);
    if (element && !isTrashed(element)) result.push(element);
  });
  return result;
}

export function patchElement(
  doc: Y.Doc,
  id: string,
  patch: Record<string, unknown>,
  origin: unknown,
  options: { touch?: boolean } = {},
): void {
  const map = elementsOf(doc).get(id);
  if (!map) return;
  transact(doc, origin, () => {
    for (const [key, value] of Object.entries(patch)) {
      if (RESERVED_KEYS.has(key)) continue;
      if (value === undefined) continue;
      map.set(key, value);
    }
    if (options.touch !== false) map.set('updatedAt', Date.now());
  });
}

export function patchElements(
  doc: Y.Doc,
  ids: string[],
  patch: Record<string, unknown>,
  origin: unknown,
): void {
  transact(doc, origin, () => {
    for (const id of ids) {
      const map = elementsOf(doc).get(id);
      if (!map) continue;
      for (const [key, value] of Object.entries(patch)) {
        if (RESERVED_KEYS.has(key)) continue;
        if (value === undefined) continue;
        map.set(key, value);
      }
      map.set('updatedAt', Date.now());
    }
  });
}

/** Cuenta de elementos (para la tarjeta de tablero). */
export function elementCount(doc: Y.Doc): number {
  return elementsOf(doc).size;
}

export type ElementMove = { id: string; x: number; y: number };

/** Un gesto de arrastre = una transacción = un paso de deshacer. */
export function moveElements(doc: Y.Doc, moves: ElementMove[], origin: unknown): void {
  if (moves.length === 0) return;
  const store = elementsOf(doc);
  transact(doc, origin, () => {
    const now = Date.now();
    for (const move of moves) {
      const map = store.get(move.id);
      if (!map) continue;
      map.set('x', move.x);
      map.set('y', move.y);
      map.set('updatedAt', now);
    }
  });
}

export function resizeElement(
  doc: Y.Doc,
  id: string,
  size: { width?: number; height?: number },
  origin: unknown,
): void {
  const map = elementsOf(doc).get(id);
  if (!map) return;
  transact(doc, origin, () => {
    if (size.width !== undefined) map.set('width', size.width);
    if (size.height !== undefined) map.set('height', size.height);
    map.set('updatedAt', Date.now());
  });
}

export function resizeElements(
  doc: Y.Doc,
  sizes: { id: string; width?: number; height?: number }[],
  origin: unknown,
): void {
  if (sizes.length === 0) return;
  const store = elementsOf(doc);
  transact(doc, origin, () => {
    const now = Date.now();
    for (const size of sizes) {
      const map = store.get(size.id);
      if (!map) continue;
      if (size.width !== undefined) map.set('width', size.width);
      if (size.height !== undefined) map.set('height', size.height);
      map.set('updatedAt', now);
    }
  });
}

export function removeElements(doc: Y.Doc, ids: string[], origin: unknown): void {
  if (ids.length === 0) return;
  const store = elementsOf(doc);
  transact(doc, origin, () => {
    const order = orderOf(doc);
    for (const id of ids) {
      store.delete(id);
      for (let i = order.length - 1; i >= 0; i -= 1) {
        if (order.get(i) === id) order.delete(i, 1);
      }
    }
  });
}

// --- Papelera ---------------------------------------------------------------

/** Días que un elemento espera en la papelera antes de poder purgarse. */
export const TRASH_TTL_DAYS = 30;
export const TRASH_TTL_MS = TRASH_TTL_DAYS * 24 * 60 * 60 * 1000;

/** ¿Está en la papelera? */
export function isTrashed(element: Pick<CanvasElement, 'deletedAt'>): boolean {
  return typeof element.deletedAt === 'number' && element.deletedAt > 0;
}

export type TrashElementsOptions = { deletedBy?: string; now?: number; withChildren?: boolean };

/**
 * Manda elementos a la papelera.
 *
 * No se saca nada del documento: se marca con `deletedAt` y `deletedBy`, así el
 * texto enriquecido (que vive en su propio `Y.XmlFragment`) no se mueve,
 * restaurar es borrar la marca y el orden de apilado se conserva solo. Las
 * columnas se llevan sus hijos.
 */
export function trashElements(doc: Y.Doc, ids: string[], origin: unknown, options: TrashElementsOptions = {}): string[] {
  const store = elementsOf(doc);
  const now = options.now ?? Date.now();
  const deletedBy = options.deletedBy ?? 'local';
  const withChildren = options.withChildren ?? true;
  const trashed: string[] = [];
  if (ids.length === 0) return trashed;
  transact(doc, origin, () => {
    const pending = [...ids];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const map = store.get(id);
      if (!map || map.get('deletedAt')) continue;
      map.set('deletedAt', now);
      map.set('deletedBy', deletedBy);
      trashed.push(id);
      if (withChildren) {
        const children = map.get('childrenIds');
        if (children instanceof Y.Array) {
          for (const child of children.toArray()) {
            if (typeof child === 'string') pending.push(child);
          }
        }
      }
    }
  });
  return trashed;
}

/** Saca elementos de la papelera, devolviéndolos a donde estaban. */
export function restoreElements(
  doc: Y.Doc,
  ids: string[],
  origin: unknown,
  options: { withChildren?: boolean } = {},
): string[] {
  const store = elementsOf(doc);
  const withChildren = options.withChildren ?? true;
  const restored: string[] = [];
  if (ids.length === 0) return restored;
  transact(doc, origin, () => {
    const pending = [...ids];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const map = store.get(id);
      if (!map || !map.get('deletedAt')) continue;
      map.delete('deletedAt');
      map.delete('deletedBy');
      restored.push(id);
      if (withChildren) {
        const children = map.get('childrenIds');
        if (children instanceof Y.Array) {
          for (const child of children.toArray()) {
            if (typeof child === 'string' && store.get(child)?.get('deletedAt')) pending.push(child);
          }
        }
      }
    }
  });
  return restored;
}

/** Lo que hay en la papelera, lo último borrado primero. */
export function getTrashedElements(doc: Y.Doc): CanvasElement[] {
  const result: CanvasElement[] = [];
  elementsOf(doc).forEach((map) => {
    const element = readElement(map);
    if (element && isTrashed(element)) result.push(element);
  });
  return result.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

export function trashCount(doc: Y.Doc): number {
  return getTrashedElements(doc).length;
}

/** Borra para siempre lo que lleva en la papelera más de `maxAgeMs`. */
export function purgeTrash(doc: Y.Doc, origin: unknown, options: { maxAgeMs?: number; now?: number } = {}): string[] {
  const maxAge = options.maxAgeMs ?? TRASH_TTL_MS;
  const now = options.now ?? Date.now();
  const ids = getTrashedElements(doc)
    .filter((element) => now - (element.deletedAt ?? now) >= maxAge)
    .map((element) => element.id);
  if (ids.length > 0) removeElements(doc, ids, origin);
  return ids;
}

/** Vacía la papelera para siempre. */
export function emptyTrash(doc: Y.Doc, origin: unknown): string[] {
  const ids = getTrashedElements(doc).map((element) => element.id);
  if (ids.length > 0) removeElements(doc, ids, origin);
  return ids;
}

/** Fragmento de texto enriquecido de un elemento, creándolo si no existe. */
export function ensureTextFragment(doc: Y.Doc, id: string, origin?: unknown): Y.XmlFragment | null {
  const map = elementsOf(doc).get(id);
  if (!map) return null;
  const existing = map.get('text');
  if (existing instanceof Y.XmlFragment) return existing;
  let fragment: Y.XmlFragment | null = null;
  doc.transact(() => {
    const created = new Y.XmlFragment();
    map.set('text', created);
    fragment = created;
  }, origin);
  return fragment;
}

export function getTextFragment(doc: Y.Doc, id: string): Y.XmlFragment | null {
  const map = elementsOf(doc).get(id);
  const fragment = map?.get('text');
  return fragment instanceof Y.XmlFragment ? fragment : null;
}

// --- Orden de apilado -------------------------------------------------------

function reorder(doc: Y.Doc, ids: string[], mode: 'front' | 'back' | 'forward' | 'backward', origin: unknown): void {
  transact(doc, origin, () => {
    const order = orderOf(doc);
    const current = order.toArray();
    const set = new Set(ids);
    if (mode === 'front') {
      const kept = current.filter((id) => !set.has(id));
      order.delete(0, order.length);
      order.push([...kept, ...ids.filter((id) => current.includes(id))]);
      return;
    }
    if (mode === 'back') {
      const kept = current.filter((id) => !set.has(id));
      order.delete(0, order.length);
      order.push([...ids.filter((id) => current.includes(id)), ...kept]);
      return;
    }
    const step = mode === 'forward' ? 1 : -1;
    const indices = ids
      .map((id) => current.indexOf(id))
      .filter((i) => i >= 0)
      .sort((a, b) => (step > 0 ? b - a : a - b));
    for (const index of indices) {
      const target = index + step;
      if (target < 0 || target >= current.length) continue;
      const a = current[index]!;
      const b = current[target]!;
      if (set.has(b) && set.has(a)) continue;
      current[index] = b;
      current[target] = a;
    }
    order.delete(0, order.length);
    order.push(current);
  });
}

export const bringToFront = (doc: Y.Doc, ids: string[], origin: unknown) => reorder(doc, ids, 'front', origin);
export const sendToBack = (doc: Y.Doc, ids: string[], origin: unknown) => reorder(doc, ids, 'back', origin);
export const bringForward = (doc: Y.Doc, ids: string[], origin: unknown) => reorder(doc, ids, 'forward', origin);
export const sendBackward = (doc: Y.Doc, ids: string[], origin: unknown) => reorder(doc, ids, 'backward', origin);

/** Normaliza `order` respecto a los elementos existentes. */
export function reconcileOrder(doc: Y.Doc, origin: unknown): void {
  const store = elementsOf(doc);
  const order = orderOf(doc);
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const id of order.toArray()) {
    if (store.has(id) && !seen.has(id)) {
      seen.add(id);
      cleaned.push(id);
    }
  }
  store.forEach((_map, id) => {
    if (!seen.has(id)) {
      seen.add(id);
      cleaned.push(id);
    }
  });
  if (cleaned.join('\u0000') === order.toArray().join('\u0000')) return;
  transact(doc, origin, () => {
    order.delete(0, order.length);
    order.push(cleaned);
  });
}

// --- Duplicar / copiar / pegar ---------------------------------------------

export type ClipboardPayload = {
  version: 1;
  elements: CanvasElement[];
  /** Contenido del texto enriquecido por id (JSON de ProseMirror en la capa web). */
  texts?: Record<string, unknown>;
  /** Ids originales → nuevos ids, para remapear conectores y contenedores. */
  idMap?: Record<string, string>;
};

export function duplicateElements(
  doc: Y.Doc,
  ids: string[],
  offset: { dx: number; dy: number },
  origin: unknown,
  options: {
    createdBy?: string;
    /**
     * Copia del texto enriquecido. La capa web la implementa con
     * `y-prosemirror` (JSON de ProseMirror) porque el clonado de un
     * `Y.XmlFragment` no se puede hacer con una simple actualización binaria.
     */
    cloneText?: (source: Y.XmlFragment, destination: Y.XmlFragment) => void;
  } = {},
): string[] {
  const store = elementsOf(doc);
  const newIds: string[] = [];
  transact(doc, origin, () => {
    const order = orderOf(doc);
    const now = Date.now();
    for (const id of ids) {
      const map = store.get(id);
      if (!map) continue;
      const source = readElement(map);
      if (!source) continue;
      const copy: CanvasElement = {
        ...source,
        id: createElementId(),
        x: source.x + offset.dx,
        y: source.y + offset.dy,
        createdAt: now,
        updatedAt: now,
        ...(options.createdBy ? { createdBy: options.createdBy } : {}),
      };
      const copyMap = newElementMap(copy);
      store.set(copy.id, copyMap);
      order.push([copy.id]);
      newIds.push(copy.id);
      const fragment = map.get('text');
      if (fragment instanceof Y.XmlFragment) {
        // El fragmento destino debe estar integrado en el documento antes de
        // escribirlo (si no, Yjs rechaza la lectura de su contenido).
        const clone = new Y.XmlFragment();
        copyMap.set('text', clone);
        if (options.cloneText) options.cloneText(fragment, clone);
      }
    }
  });
  return newIds;
}

/** Serializa elementos para el portapapeles (interno o del sistema). */
export function serializeForClipboard(doc: Y.Doc, ids: string[]): ClipboardPayload {
  const elements: CanvasElement[] = [];
  const idMap: Record<string, string> = {};
  for (const id of ids) {
    const element = getElement(doc, id);
    if (!element) continue;
    elements.push(stripForClipboard(element));
    idMap[id] = id;
  }
  return { version: 1, elements, idMap };
}

function stripForClipboard(element: CanvasElement): CanvasElement {
  return { ...element, id: element.id, parentId: undefined } as CanvasElement;
}

/** Pega una carga del portapapeles con un desplazamiento y reasigna ids. */
export function pasteClipboard(
  doc: Y.Doc,
  payload: ClipboardPayload,
  origin: unknown,
  options: { dx: number; dy: number; createdBy: string; at?: { x: number; y: number } },
): string[] {
  if (payload.elements.length === 0) return [];
  const sorted = [...payload.elements].sort((a, b) => a.createdAt - b.createdAt);
  const originX = options.at?.x ?? Math.min(...sorted.map((el) => el.x));
  const originY = options.at?.y ?? Math.min(...sorted.map((el) => el.y));
  const baseX = Math.min(...sorted.map((el) => el.x));
  const baseY = Math.min(...sorted.map((el) => el.y));

  const newIds: string[] = [];
  transact(doc, origin, () => {
    const store = elementsOf(doc);
    const order = orderOf(doc);
    const now = Date.now();
    const mapIds: Record<string, string> = {};
    for (const element of sorted) {
      const id = createElementId();
      mapIds[element.id] = id;
      const copy: CanvasElement = {
        ...element,
        id,
        x: originX + (element.x - baseX) + options.dx,
        y: originY + (element.y - baseY) + options.dy,
        createdBy: options.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      delete (copy as { parentId?: string }).parentId;
      store.set(id, newElementMap(copy));
      order.push([id]);
      newIds.push(id);
    }
    // Remapea referencias internas (columnas → hijos).
    for (const [oldId, newId] of Object.entries(mapIds)) {
      const original = payload.elements.find((el) => el.id === oldId);
      if (original?.type !== 'column') continue;
      const map = store.get(newId);
      if (!map) continue;
      const children = new Y.Array<string>();
      const originalChildren = (original as { childrenIds?: string[] }).childrenIds ?? [];
      for (const childId of originalChildren) {
        const mapped = mapIds[childId];
        if (mapped) children.push([mapped]);
      }
      map.set('childrenIds', children);
    }
  });
  return newIds;
}

// --- Texto plano -------------------------------------------------------------

/** Texto plano de un `Y.XmlFragment` (búsqueda, exportación, portapapeles). */
export function fragmentToPlainText(fragment: Y.XmlFragment | null | undefined): string {
  if (!fragment) return '';
  const lines: string[] = [];
  const walkInline = (node: Y.XmlElement | Y.XmlText | Y.XmlHook): string => {
    if (node instanceof Y.XmlText) return node.toString();
    if (node instanceof Y.XmlElement) {
      return node.toArray().map((child) => walkInline(child as Y.XmlElement | Y.XmlText)).join('');
    }
    return '';
  };
  fragment.toArray().forEach((node) => {
    if (node instanceof Y.XmlElement) {
      lines.push(walkInline(node));
    } else if (node instanceof Y.XmlText) {
      lines.push(node.toString());
    }
  });
  return lines.join('\n').replace(/\u00a0/g, ' ');
}

// --- Deshacer / rehacer ------------------------------------------------------

export type UndoManagerOptions = {
  /** Origen de las transacciones propias (`localOrigin` por defecto). */
  trackedOrigins?: Set<unknown>;
  captureTimeout?: number;
};

/**
 * Gestor de deshacer sobre el documento completo, limitado a las
 * transacciones locales del usuario.
 */
export function createUndoManager(doc: Y.Doc, options: UndoManagerOptions = {}): Y.UndoManager {
  return new Y.UndoManager([elementsOf(doc), orderOf(doc), connectorsOf(doc)], {
    trackedOrigins: options.trackedOrigins ?? new Set([null]),
    captureTimeout: options.captureTimeout ?? 400,
  });
}

// --- Exportación / importación ----------------------------------------------

export type PlainBoardDocument = {
  version: 1;
  elements: CanvasElement[];
  order: string[];
};

export function toPlainDocument(doc: Y.Doc): PlainBoardDocument {
  return {
    version: 1,
    elements: getOrderedElements(doc),
    order: orderOf(doc).toArray(),
  };
}

export function applyPlainDocument(doc: Y.Doc, data: PlainBoardDocument, origin: unknown): void {
  transact(doc, origin, () => {
    const store = elementsOf(doc);
    const order = orderOf(doc);
    for (const element of data.elements) {
      store.set(element.id, newElementMap(element));
    }
    order.push(data.elements.map((el) => el.id));
  });
}

/** Estimación de peso del documento (para el indicador de estado). */
export function documentSize(doc: Y.Doc): number {
  return Y.encodeStateAsUpdate(doc).byteLength;
}

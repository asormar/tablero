/**
 * Filtro de escritura por **tipo de cambio** (arreglo de la revisión de la fase 5).
 *
 * El rol **comentarista** puede leer y comentar, pero no editar el tablero. Los
 * comentarios viven en el documento (`doc.getMap('comments')`, ver
 * `packages/shared/src/comments.ts`), así que el canal de colaboración —que
 * hasta ahora descartaba *todos* los updates de quien no tiene `canEdit`— le
 * cerraba la única vía que el rol promete.
 *
 * Acá se decide si un update entrante **solo toca el mapa de comentarios**:
 * mirando la cabecera de cada struct del update (Item/GC) se llega al tipo raíz
 * que escribe (`comments`, `elements`, …) siguiendo la cadena de `parent` —que
 * en un update recién decodificado es un **nombre** de tipo raíz o un **ID** del
 * struct que creó el anidado— y, cuando el struct ya está integrado en el
 * servidor, el objeto de tipo del documento. El conjunto de la *delete set* se
 * resuelve igual: borrar un comentario toca `comments`; borrar el texto de una
 * nota, no.
 *
 * Política ante la duda: **se rechaza**. Cualquier struct o borrado cuyo tipo
 * raíz no se pueda resolver —o que toque otra raíz— hace que el update entero
 * se descarte (un update de Yjs se aplica completo o no se aplica). El precio
 * está documentado en `server.ts`: un lote mixto (comentario + edición) se tira
 * entero, así que el cliente lo reintenta; el cierre con 4403 sigue reservado a
 * los cambios de rol.
 *
 * Solo se usa para conexiones sin permiso de edición: el editor y el dueño
 * pasan por el camino normal.
 */

import * as Y from 'yjs';

/** Tipos raíz que puede escribir un comentarista (el contrato del rol). */
export const COMMENTER_WRITABLE_ROOTS: ReadonlySet<string> = new Set(['comments']);

/** Un struct con contenido, del update o del documento. */
type StructRef = Y.Item | Y.GC;

/** Índice de los structs del propio update: cliente → structs por reloj. */
type UpdateIndex = Map<number, StructRef[]>;

function isStruct(value: unknown): value is StructRef {
  return value instanceof Y.Item || value instanceof Y.GC;
}

/** `parent` (o su ausencia) sin pelearse con los tipos internos de Yjs. */
function parentOf(struct: StructRef): unknown {
  return (struct as { parent?: unknown }).parent;
}

function indexStructs(structs: readonly Y.AbstractStruct[]): UpdateIndex {
  const index: UpdateIndex = new Map();
  for (const struct of structs) {
    if (!isStruct(struct)) continue;
    const list = index.get(struct.id.client);
    if (list) list.push(struct);
    else index.set(struct.id.client, [struct]);
  }
  for (const list of index.values()) list.sort((a, b) => a.id.clock - b.id.clock);
  return index;
}

/**
 * Struct que cubre `id` en una lista ordenada por reloj (la misma búsqueda que
 * hace Yjs en su `StructStore`), o `null` si el reloj cae en un hueco.
 */
function findInList(list: StructRef[] | undefined, clock: number): StructRef | null {
  if (!list || list.length === 0) return null;
  let low = 0;
  let high = list.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (list[middle]!.id.clock <= clock) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found < 0) return null;
  const candidate = list[found]!;
  return candidate.id.clock + candidate.length > clock ? candidate : null;
}

/** Struct del update o del documento, o `null` si no se puede resolver. */
function resolveStruct(doc: Y.Doc, index: UpdateIndex, id: Y.ID): StructRef | null {
  return findInList(index.get(id.client), id.clock) ?? findInList(doc.store.clients.get(id.client), id.clock);
}

/** Nombre de un tipo raíz del documento (`null` si el tipo no es raíz). */
function rootNameOf(doc: Y.Doc, type: Y.AbstractType<unknown>): string | null {
  for (const [key, value] of doc.share.entries()) {
    if (value === type) return key;
  }
  return null;
}

/**
 * Tipo raíz que escribe un struct, siguiendo la cadena de `parent`.
 *
 * Cuatro formas de parent en juego:
 *   - `string`: el struct ya viene decodificado de un update con su tipo raíz;
 *   - `Y.ID`: anidado creado en este mismo update o en el documento (el ID
 *     apunta al struct con contenido `ContentType`);
 *   - `null`: recién creado junto a su vecino (Yjs hereda el parent de `origin`
 *     o `rightOrigin` al integrar); se resuelve igual que hace la librería;
 *   - `AbstractType`: struct ya integrado en el documento; si no es raíz se
 *     sube por el item que lo creó.
 *
 * `null` = indeterminado (se rechaza el update).
 */
function rootTypeOf(doc: Y.Doc, start: StructRef, index: UpdateIndex): string | null {
  const visited = new Set<string>();
  let current: StructRef | null = start;
  for (let depth = 0; current !== null && depth < 64; depth += 1) {
    const key = `${current.id.client}:${current.id.clock}`;
    if (visited.has(key)) return null;
    visited.add(key);

    const parent = parentOf(current);
    if (typeof parent === 'string') return parent;
    if (parent instanceof Y.ID) {
      current = resolveStruct(doc, index, parent);
      continue;
    }
    if (parent instanceof Y.AbstractType) {
      const name = rootNameOf(doc, parent);
      if (name !== null) return name;
      // Tipo anidado ya integrado: el item que lo creó dice a qué raíz pertenece.
      current = parent._item;
      continue;
    }
    // parent === null: Yjs hereda del vecino izquierdo y, si no, del derecho.
    const neighbor: Y.ID | null = current instanceof Y.Item ? (current.origin ?? current.rightOrigin) : null;
    current = neighbor ? resolveStruct(doc, index, neighbor) : null;
  }
  return null;
}

/**
 * Tipos raíz que toca un update (structs + delete set).
 *
 * Devuelve `null` cuando algún elemento no se puede clasificar: el generador del
 * update no es de fiar (o referencia estructura que este documento no tiene) y
 * la política es rechazarlo.
 */
export function touchedRootTypes(doc: Y.Doc, update: Uint8Array): Set<string> | null {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return null;
  }
  const index = indexStructs(decoded.structs);
  const touched = new Set<string>();

  for (const struct of decoded.structs) {
    if (!isStruct(struct)) continue; // `Skip`: no escribe contenido
    const root = rootTypeOf(doc, struct, index);
    if (root === null) return null;
    touched.add(root);
  }

  for (const [client, deletes] of decoded.ds.clients) {
    for (const range of deletes) {
      let clock = range.clock;
      const end = range.clock + range.len;
      while (clock < end) {
        const struct = resolveStruct(doc, index, new Y.ID(client, clock));
        if (struct === null) return null;
        const root = rootTypeOf(doc, struct, index);
        if (root === null) return null;
        touched.add(root);
        const next = struct.id.clock + struct.length;
        if (next <= clock) return null; // defensivo: sin avance no hay salida
        clock = next;
      }
    }
  }
  return touched;
}

/**
 * ¿El update escribe **solo** en el mapa de comentarios? Un update vacío
 * (sin structs ni borrados) también devuelve `true`: no cambia nada.
 */
export function isCommentsOnlyUpdate(doc: Y.Doc, update: Uint8Array): boolean {
  const touched = touchedRootTypes(doc, update);
  if (touched === null) return false;
  for (const root of touched) {
    if (!COMMENTER_WRITABLE_ROOTS.has(root)) return false;
  }
  return true;
}

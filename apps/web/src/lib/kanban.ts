/**
 * Kanban: matemática de la lista de hijos de una columna.
 *
 * Las tarjetas dentro de una columna no tienen posición libre: las ordena el
 * layout a partir de `childrenIds` (un `Y.Array<string>` del propio elemento).
 * Acá están las funciones puras que deciden en qué posición entra lo que se
 * suelta y cómo queda la lista después.
 */

/** Una tarjeta ya colocada en la columna, con su posición medida en el DOM. */
export type ChildSlot = { id: string; top: number; height: number };

/** Ordena los huecos de arriba abajo (el DOM puede devolverlos en cualquier orden). */
export function sortedSlots(slots: readonly ChildSlot[]): ChildSlot[] {
  return [...slots].sort((a, b) => a.top - b.top);
}

/**
 * Índice de inserción para un punto vertical: cada tarjeta cuenta si el puntero
 * pasó su línea media.
 */
export function insertionIndexFromPoint(slots: readonly ChildSlot[], pointerY: number): number {
  let index = 0;
  for (const slot of sortedSlots(slots)) {
    if (pointerY > slot.top + slot.height / 2) index += 1;
  }
  return index;
}

/** Posición (en coordenadas del mismo sistema que los `slot`) de la línea de inserción. */
export function insertionLineY(slots: readonly ChildSlot[], index: number, fallbackY: number): number {
  const ordered = sortedSlots(slots);
  if (ordered.length === 0) return fallbackY;
  const clamped = Math.max(0, Math.min(index, ordered.length));
  if (clamped < ordered.length) return ordered[clamped]!.top;
  const last = ordered[ordered.length - 1]!;
  return last.top + last.height;
}

/**
 * Quita `id` de la lista y lo inserta en `index` (índices de la lista sin él).
 * Si ya estaba donde tiene que quedar, devuelve la misma lista (identidad).
 */
export function reorderIds(ids: readonly string[], id: string, index: number): string[] {
  const without = ids.filter((candidate) => candidate !== id);
  const target = Math.max(0, Math.min(index, without.length));
  const next = [...without.slice(0, target), id, ...without.slice(target)];
  if (next.length === ids.length && next.every((candidate, position) => candidate === ids[position])) {
    return ids as string[];
  }
  return next;
}

/** Inserta uno o varios ids en `index`, conservando su orden relativo. */
export function insertIds(ids: readonly string[], added: readonly string[], index: number): string[] {
  const set = new Set(added);
  const without = ids.filter((candidate) => !set.has(candidate));
  const target = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, target), ...added, ...without.slice(target)];
}

/** Quita ids de la lista (sin tocar el orden del resto). */
export function removeIds(ids: readonly string[], removed: readonly string[]): string[] {
  const set = new Set(removed);
  return ids.filter((candidate) => !set.has(candidate));
}

/**
 * Índice de inserción a partir de la posición del puntero dentro de un índice de
 * filas de una lista (tareas): sirve para el mismo gesto en las listas de tareas.
 */
export function rowIndexFromPoint(rows: readonly ChildSlot[], pointerY: number): number {
  return insertionIndexFromPoint(rows, pointerY);
}

/** Texto del contador de la columna («4 elementos»). */
export function columnCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'elemento' : 'elementos'}`;
}

/** ¿La columna está vacía? (para el estado vacío con la zona de soltado). */
export function isEmptyColumn(childIds: readonly string[]): boolean {
  return childIds.length === 0;
}

/**
 * Contadores de elementos por tablero.
 *
 * La API puede informar `elementCount` en las listas; cuando no lo hace, se usa
 * el número de elementos que este cliente ya conoce del tablero (porque lo abrió
 * en esta sesión). Si no se sabe nada, la tarjeta no inventa un número.
 */

const counts = new Map<string, number>();

export function rememberBoardCount(boardId: string, count: number): void {
  if (counts.get(boardId) === count) return;
  counts.set(boardId, count);
}

export function knownBoardCount(boardId: string): number | null {
  const value = counts.get(boardId);
  return value === undefined ? null : value;
}

export function forgetBoardCount(boardId: string): void {
  counts.delete(boardId);
}

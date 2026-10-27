/**
 * Animación de entrada de las tarjetas nuevas (una sola vez por tarjeta).
 *
 * Antes se decidía en cada render con `Date.now() - createdAt < 320`, así que una
 * tarjeta que se volvía a montar dentro de esa ventana (virtualización, cambio
 * de tablero) repetía la animación. Ahora la decisión se toma al montar y, una
 * vez reproducida, la tarjeta queda anotada para no volver a animarse.
 */

/** Ventana, en milisegundos, en la que una tarjeta se considera recién creada. */
export const ENTER_WINDOW_MS = 320;

const played = new Set<string>();

/** ¿Hay que animar la entrada? Pura: no anota nada. */
export function shouldPlayEnter(id: string, createdAt: number, now: number, seen: ReadonlySet<string> = played): boolean {
  if (seen.has(id)) return false;
  return createdAt > 0 && now - createdAt < ENTER_WINDOW_MS;
}

/** Anota que la entrada de esta tarjeta ya se reprodujo. */
export function markEnterPlayed(id: string): void {
  played.add(id);
}

/** Solo para pruebas: olvida las tarjetas anotadas. */
export function resetEnterAnimations(): void {
  played.clear();
}

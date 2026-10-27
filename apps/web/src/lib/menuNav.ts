/**
 * Navegación con teclado de un menú (`role="menu"`): flechas, Inicio y Fin con
 * vuelta al llegar al borde y sin pasar por los elementos deshabilitados.
 */

/**
 * Índice al que debe ir el foco tras pulsar `key`, o `-1` si la tecla no es de
 * navegación (o no hay ningún elemento habilitado).
 *
 * @param enabled  un valor por elemento: `true` si se puede enfocar
 * @param current  índice enfocado ahora (`-1` si el foco no está en el menú)
 */
export function nextMenuIndex(enabled: readonly boolean[], current: number, key: string): number {
  const indices = enabled.flatMap((isEnabled, index) => (isEnabled ? [index] : []));
  if (indices.length === 0) return -1;
  const first = indices[0]!;
  const last = indices[indices.length - 1]!;
  switch (key) {
    case 'Home':
      return first;
    case 'End':
      return last;
    case 'ArrowDown': {
      if (current < 0) return first;
      return indices.find((index) => index > current) ?? first;
    }
    case 'ArrowUp': {
      if (current < 0) return last;
      const before = indices.filter((index) => index < current);
      return before.length > 0 ? before[before.length - 1]! : last;
    }
    default:
      return -1;
  }
}

/**
 * Nombres accesibles compartidos (fase 6, accesibilidad).
 *
 * Las tarjetas del lienzo son `div` con `role="group"`: necesitan un nombre que
 * diga **qué son** y **qué contienen** para que el lector de pantalla no anuncie
 * solo «nota» treinta veces. Acá vive el armado de ese texto, sin DOM, para
 * poder probarlo.
 */

/** Largo máximo del fragmento de texto que entra en la etiqueta. */
export const CARD_LABEL_MAX = 60;

/** Aplana y recorta el texto de una tarjeta para usarlo en una etiqueta. */
export function cardSnippet(text: string | null | undefined, max = CARD_LABEL_MAX): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return '';
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * Nombre accesible de una tarjeta: tipo + texto (o «vacía») y, si corresponde,
 * el aviso de que la posición está bloqueada.
 */
export function cardAriaLabel(
  typeLabel: string,
  text: string | null | undefined,
  options: { locked?: boolean } = {},
  max = CARD_LABEL_MAX,
): string {
  const snippet = cardSnippet(text, max);
  const base = snippet.length > 0 ? `${typeLabel}: ${snippet}` : `${typeLabel} (vacía)`;
  return options.locked ? `${base}, posición bloqueada` : base;
}

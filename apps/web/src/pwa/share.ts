/**
 * Share Target de la PWA (punto 7 de la fase 4): compartir desde el móvil manda
 * la nota a «Sin ordenar».
 *
 * El manifiesto declara `share_target` con `action: '/?share=1'` y método GET, así
 * que el sistema abre la app con `?share=1&title=…&text=…&url=…`. Acá se leen y
 * se limpian esos parámetros; el espacio de trabajo los convierte en una nota.
 *
 * Lo que se puede probar sin navegador (parseo y composición) vive en este
 * módulo; el efecto que guarda la nota está en `useShareTarget`.
 */

export type SharedPayload = { title: string; text: string; url: string };

/** Lee los parámetros del share target. Devuelve `null` si no hay nada útil. */
export function parseShareParams(search: string): SharedPayload | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    return null;
  }
  const flag = params.get('share');
  const title = (params.get('title') ?? '').trim();
  const text = (params.get('text') ?? '').trim();
  const url = (params.get('url') ?? '').trim();
  if (flag === null && title.length === 0 && text.length === 0 && url.length === 0) return null;
  if (title.length === 0 && text.length === 0 && url.length === 0) return null;
  return { title, text, url };
}

/**
 * Compone el texto de la nota: título, texto y URL sin repetir lo que ya viene
 * incluido en el texto (muchas apps mandan la URL dos veces).
 */
export function composeShareNote(payload: SharedPayload): string {
  const lines: string[] = [];
  const push = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    if (lines.some((line) => line.includes(trimmed))) return;
    lines.push(trimmed);
  };
  push(payload.title);
  push(payload.text);
  push(payload.url);
  return lines.join('\n');
}

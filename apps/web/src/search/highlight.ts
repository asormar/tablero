/**
 * Resaltado de fragmentos de búsqueda (punto 1 de la fase 4).
 *
 * Funciones puras: la consulta se parte en términos, el fragmento se corta
 * alrededor de la primera coincidencia y se devuelven los tramos con `match` en
 * `true` para que el componente los pinte con `<mark>` (nunca `innerHTML`).
 */

export type HighlightSegment = { text: string; match: boolean };

export const MAX_TERMS = 8;

/** Términos normalizados (sin vacíos, sin duplicados, en minúsculas). */
export function tokenizeQuery(query: string): string[] {
  const terms: string[] = [];
  for (const raw of query.toLowerCase().split(/\s+/)) {
    const term = raw.trim();
    if (term.length === 0) continue;
    if (terms.includes(term)) continue;
    terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

type Range = { start: number; end: number };

function rangesFor(text: string, term: string): Range[] {
  if (term.length === 0) return [];
  const haystack = text.toLowerCase();
  const ranges: Range[] = [];
  let index = haystack.indexOf(term);
  while (index >= 0) {
    ranges.push({ start: index, end: index + term.length });
    index = haystack.indexOf(term, index + term.length);
    if (ranges.length > 200) break;
  }
  return ranges;
}

/** Une rangos solapados o contiguos, en orden. */
export function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [{ ...sorted[0]! }];
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/** Parte un texto en tramos resaltados y no resaltados. */
export function highlightSegments(text: string, terms: string[]): HighlightSegment[] {
  const normalized = terms.map((term) => term.toLowerCase()).filter((term) => term.length > 0);
  if (text.length === 0) return [{ text, match: false }];
  if (normalized.length === 0) return [{ text, match: false }];

  const ranges = mergeRanges(normalized.flatMap((term) => rangesFor(text, term)));
  if (ranges.length === 0) return [{ text, match: false }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), match: false });
    segments.push({ text: text.slice(range.start, range.end), match: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/** ¿El texto contiene alguno de los términos? */
export function containsAny(text: string, terms: string[]): boolean {
  const haystack = text.toLowerCase();
  return terms.some((term) => term.length > 0 && haystack.includes(term.toLowerCase()));
}

/**
 * Fragmento alrededor de la primera coincidencia, con puntos suspensivos cuando
 * se recorta. Si no hay coincidencia se devuelven los primeros `radius * 2`
 * caracteres (contexto, sin resaltado).
 */
export function snippetAround(text: string, terms: string[], radius = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return '';
  const haystack = flat.toLowerCase();
  let index = -1;
  for (const term of terms) {
    if (term.length === 0) continue;
    const found = haystack.indexOf(term.toLowerCase());
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) return flat.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(flat.length, index + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/** Cuenta coincidencias totales (para «3 de 12» en la búsqueda del tablero). */
export function countMatches(text: string, terms: string[]): number {
  let total = 0;
  for (const term of terms) {
    if (term.length === 0) continue;
    const haystack = text.toLowerCase();
    const needle = term.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index >= 0) {
      total += 1;
      index = haystack.indexOf(needle, index + needle.length);
    }
  }
  return total;
}

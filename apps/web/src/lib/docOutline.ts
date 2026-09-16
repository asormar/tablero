/**
 * Índice y resumen de un documento largo.
 *
 * El índice sale de los encabezados del texto (`TextBlock` normalizado), que es
 * el mismo origen que usa la vista previa: no hay que montar ProseMirror para
 * saber qué encabezados tiene el documento.
 */

import type { TextBlock } from './textBlocks';

export type OutlineEntry = { level: number; text: string; index: number };

/** Encabezados del documento, en orden, con su nivel (1–3). */
export function outlineOf(blocks: readonly TextBlock[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== 'heading') return;
    const text = block.runs
      .map((run) => run.text)
      .join('')
      .trim();
    if (text.length === 0) return;
    entries.push({ level: Math.min(3, Math.max(1, block.level)), text, index });
  });
  return entries;
}

/** Palabras del documento (para el resumen de la tarjeta). */
export function wordCountOf(blocks: readonly TextBlock[]): number {
  let count = 0;
  for (const block of blocks) {
    const text = block.runs
      .map((run) => run.text)
      .join(' ')
      .trim();
    if (text.length === 0) continue;
    count += text.split(/\s+/).length;
  }
  return count;
}

export type DocumentPreview = { title: string; excerpt: string; wordCount: number };

/**
 * Título y extracto para la tarjeta: manda el primer encabezado (o la primera
 * línea) y el extracto son las líneas siguientes, recortadas.
 */
export function previewOf(blocks: readonly TextBlock[], maxLines = 4): DocumentPreview {
  const lines: { text: string; heading: boolean }[] = [];
  for (const block of blocks) {
    const text = block.runs
      .map((run) => run.text)
      .join('')
      .trim();
    if (text.length === 0) continue;
    lines.push({ text, heading: block.kind === 'heading' });
  }
  const wordCount = wordCountOf(blocks);
  if (lines.length === 0) return { title: '', excerpt: '', wordCount };
  const first = lines[0]!;
  const title = !first.heading && lines.length > 1 && lines[1]!.heading ? lines[1]!.text : first.text;
  const skip = title === first.text ? 1 : first.heading ? 1 : 2;
  const excerpt = lines
    .slice(skip, skip + maxLines)
    .map((line) => line.text)
    .join(' ');
  return { title, excerpt: excerpt.slice(0, 320), wordCount };
}

/**
 * Lectura del texto enriquecido para la vista previa de la tarjeta.
 *
 * La nota se edita con TipTap cuando está en edición, pero las otras 299 se
 * pintan sin montar ningún editor: aquí se normaliza el `Y.XmlFragment` a una
 * estructura plana (bloques + marcas) que se renderiza como HTML simple.
 */

import * as Y from 'yjs';

export type TextRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  link: string | null;
};

export type TextBlock = {
  kind: 'paragraph' | 'heading' | 'list' | 'quote' | 'code';
  /** Nivel del encabezado (1-3) o de la lista (1-2). */
  level: number;
  ordered: boolean;
  runs: TextRun[];
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function linkOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const href = (value as { href?: unknown }).href;
    if (typeof href === 'string') return href;
  }
  return null;
}

function runsOfText(text: Y.XmlText): TextRun[] {
  const runs: TextRun[] = [];
  for (const op of text.toDelta()) {
    if (typeof op.insert !== 'string' || op.insert.length === 0) continue;
    const attributes = (op.attributes ?? {}) as Record<string, unknown>;
    runs.push({
      text: op.insert,
      bold: attributes['bold'] === true,
      italic: attributes['italic'] === true,
      strike: attributes['strike'] === true,
      code: attributes['code'] === true,
      link: linkOf(attributes['link']),
    });
  }
  return runs;
}

function inlineRuns(nodes: (Y.XmlElement | Y.XmlText | Y.XmlHook)[]): TextRun[] {
  const runs: TextRun[] = [];
  for (const node of nodes) {
    if (node instanceof Y.XmlText) {
      runs.push(...runsOfText(node));
      continue;
    }
    if (node instanceof Y.XmlElement) {
      const children = node.toArray() as (Y.XmlElement | Y.XmlText)[];
      if (node.nodeName === 'hardBreak') {
        runs.push({ text: '\n', bold: false, italic: false, strike: false, code: false, link: null });
        continue;
      }
      runs.push(...inlineRuns(children));
    }
  }
  return runs;
}

function levelOf(node: Y.XmlElement, fallback = 1): number {
  const raw = node.getAttribute('level');
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(6, Math.max(1, value));
}

function blocksFromNode(node: Y.XmlElement, depth: number, ordered: boolean): TextBlock[] {
  const children = node.toArray() as (Y.XmlElement | Y.XmlText)[];
  switch (node.nodeName) {
    case 'paragraph': {
      const runs = inlineRuns(children);
      if (runs.length === 0) return [];
      return [{ kind: 'paragraph', level: depth, ordered, runs }];
    }
    case 'heading':
      return [
        {
          kind: 'heading',
          level: levelOf(node, 1),
          ordered,
          runs: inlineRuns(children),
        },
      ];
    case 'bulletList':
    case 'orderedList': {
      const blocks: TextBlock[] = [];
      const isOrdered = node.nodeName === 'orderedList';
      for (const child of children) {
        if (!(child instanceof Y.XmlElement)) continue;
        if (child.nodeName === 'listItem') {
          const inner = blocksFromNode(child, depth + 1, isOrdered);
          if (inner.length === 0) {
            blocks.push({ kind: 'list', level: depth + 1, ordered: isOrdered, runs: [] });
          } else {
            blocks.push(...inner);
          }
        } else {
          blocks.push(...blocksFromNode(child, depth + 1, isOrdered));
        }
      }
      return blocks;
    }
    case 'listItem': {
      const blocks: TextBlock[] = [];
      for (const child of children) {
        if (!(child instanceof Y.XmlElement)) continue;
        if (child.nodeName === 'paragraph') {
          blocks.push({ kind: 'list', level: depth, ordered, runs: inlineRuns(child.toArray() as (Y.XmlElement | Y.XmlText)[]) });
        } else {
          blocks.push(...blocksFromNode(child, depth + 1, ordered));
        }
      }
      return blocks;
    }
    case 'blockquote': {
      const runs: TextRun[] = [];
      for (const child of children) {
        if (child instanceof Y.XmlElement && child.nodeName === 'paragraph') {
          if (runs.length > 0) runs.push({ text: '\n', bold: false, italic: false, strike: false, code: false, link: null });
          runs.push(...inlineRuns(child.toArray() as (Y.XmlElement | Y.XmlText)[]));
        } else if (child instanceof Y.XmlText) {
          runs.push(...runsOfText(child));
        }
      }
      return [{ kind: 'quote', level: depth, ordered, runs }];
    }
    case 'codeBlock': {
      const runs: TextRun[] = [];
      for (const child of children) {
        if (child instanceof Y.XmlText) runs.push(...runsOfText(child));
      }
      return [{ kind: 'code', level: depth, ordered, runs }];
    }
    default: {
      // Nodo desconocido: se muestra su texto para no perder contenido.
      const runs = inlineRuns(children);
      if (runs.length === 0) return [];
      return [{ kind: 'paragraph', level: depth, ordered, runs }];
    }
  }
}

export function textBlocksOf(fragment: Y.XmlFragment | null | undefined): TextBlock[] {
  if (!fragment) return [];
  const blocks: TextBlock[] = [];
  for (const node of fragment.toArray()) {
    if (node instanceof Y.XmlElement) {
      blocks.push(...blocksFromNode(node, 0, false));
      continue;
    }
    if (node instanceof Y.XmlText) {
      const runs = runsOfText(node);
      if (runs.length > 0) blocks.push({ kind: 'paragraph', level: 0, ordered: false, runs });
    }
  }
  return blocks;
}

export function blocksToPlainText(blocks: TextBlock[]): string {
  return blocks.map((block) => block.runs.map((run) => run.text).join('')).join('\n');
}

export function firstLineOf(blocks: TextBlock[]): string {
  for (const block of blocks) {
    const text = block.runs.map((run) => run.text).join('').trim();
    if (text.length > 0) return text;
  }
  return '';
}

export function isTextEmpty(blocks: TextBlock[]): boolean {
  return blocks.every((block) => block.runs.every((run) => run.text.trim().length === 0));
}

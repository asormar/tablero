/**
 * Render de la vista previa del texto enriquecido.
 *
 * Se pinta a partir de la estructura normalizada (`TextBlock[]`), sin montar
 * ningún editor: es lo que permite tener 300 notas con formato en pantalla sin
 * 300 instancias de ProseMirror.
 */

import { Fragment, type ReactNode } from 'react';

import type { TextBlock, TextRun } from '@/lib/textBlocks';

function renderRun(run: TextRun, key: number): ReactNode {
  let node: ReactNode = run.text;
  if (run.code) node = <code className="rt-code">{node}</code>;
  if (run.bold) node = <strong>{node}</strong>;
  if (run.italic) node = <em>{node}</em>;
  if (run.strike) node = <s>{node}</s>;
  // En la vista previa el enlace no navega: la tarjeta se arrastra.
  if (run.link) {
    node = (
      <span className="rt-link" title={run.link}>
        {node}
      </span>
    );
  }
  return <Fragment key={key}>{node}</Fragment>;
}

function renderRuns(runs: TextRun[]): ReactNode[] {
  return runs.map((run, index) => renderRun(run, index));
}

function renderBlock(block: TextBlock, key: number): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(3, Math.max(1, block.level));
      const Tag = (`h${level}` as unknown) as 'h3';
      return (
        <Tag key={key} className="rt-h">
          {renderRuns(block.runs)}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote key={key} className="rt-quote">
          {renderRuns(block.runs)}
        </blockquote>
      );
    case 'code':
      return (
        <pre key={key} className="rt-pre">
          <code>{renderRuns(block.runs)}</code>
        </pre>
      );
    default:
      return (
        <p key={key} className="rt-p">
          {renderRuns(block.runs)}
        </p>
      );
  }
}

type Group = { ordered: boolean; indexes: number[] };

/** Agrupa listas consecutivas para que compartan un único `<ul>`/`<ol>`. */
function renderBlocks(blocks: TextBlock[]): ReactNode[] {
  const output: ReactNode[] = [];
  let group: Group | null = null;

  const flushGroup = (): void => {
    if (!group) return;
    const items = group.indexes.map((index) => (
      <li key={index}>{renderRuns(blocks[index]?.runs ?? [])}</li>
    ));
    const key = `list-${group.indexes[0] ?? 0}`;
    output.push(
      group.ordered ? (
        <ol key={key} className="rt-list">
          {items}
        </ol>
      ) : (
        <ul key={key} className="rt-list">
          {items}
        </ul>
      ),
    );
    group = null;
  };

  blocks.forEach((block, index) => {
    if (block.kind === 'list') {
      if (group && group.ordered === block.ordered) {
        group.indexes.push(index);
        return;
      }
      flushGroup();
      group = { ordered: block.ordered, indexes: [index] };
      return;
    }
    flushGroup();
    output.push(renderBlock(block, index));
  });
  flushGroup();
  return output;
}

export function TextBlocks({ blocks, className }: { blocks: TextBlock[]; className?: string }): ReactNode {
  return <div className={className}>{renderBlocks(blocks)}</div>;
}

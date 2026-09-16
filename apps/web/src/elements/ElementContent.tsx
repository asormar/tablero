/**
 * Contenido de una tarjeta según su tipo (fase 1: nota, encabezado y tablero).
 *
 * Solo el elemento en edición monta TipTap; el resto pinta la vista previa
 * normalizada, que es lo que hace viable tener cientos de notas en pantalla.
 */

import { type CanvasElement, type ElementType, type HeadingSize, elementLabel } from '@tablero/shared';
import { Suspense, lazy } from 'react';

import { knownBoardCount } from '@/app/boardCounts';
import type { BoardSession } from '@/collab/BoardSession';
import { useSessionText } from '@/collab/SessionContext';
import { useAppStore } from '@/state/appStore';
import { blocksToPlainText, firstLineOf, isTextEmpty } from '@/lib/textBlocks';

import { AudioCard, FileCard, ImageCard, VideoCard } from './cards/AssetCards';
import { ColumnCard } from './cards/ColumnCard';
import { DocumentCard } from './cards/DocumentCard';
import { LinkCard } from './cards/LinkCard';
import { MapCard } from './cards/MapCard';
import { SketchCard } from './cards/SketchCard';
import { SwatchCard } from './cards/SwatchCard';
import { TableCard } from './cards/TableCard';
import { TodoCard } from './cards/TodoCard';
import { TextBlocks } from './renderBlocks';

// El editor (TipTap + ProseMirror) solo se necesita mientras se edita una nota:
// se carga bajo demanda para no engordar el arranque del lienzo.
const LazyRichTextEditor = lazy(async () => {
  const module = await import('./RichTextEditor');
  return { default: module.RichTextEditor };
});

const HEADING_CLASS: Record<HeadingSize, string> = {
  S: 'heading--s',
  M: 'heading--m',
  L: 'heading--l',
  XL: 'heading--xl',
};

const PLACEHOLDER: Partial<Record<ElementType, string>> = {
  note: 'Escribe una nota…',
  document: 'Escribe un documento…',
  heading: 'Escribe un encabezado…',
  todo: 'Escribe una tarea…',
};

export type ElementContentProps = {
  session: BoardSession;
  element: CanvasElement;
  editing: boolean;
  simplified: boolean;
};

export function ElementContent({ session, element, editing, simplified }: ElementContentProps) {
  switch (element.type) {
    case 'note':
      return (
        <TextView
          session={session}
          id={element.id}
          variant="note"
          editing={editing}
          simplified={simplified}
        />
      );
    case 'heading':
      return (
        <TextView
          session={session}
          id={element.id}
          variant="heading"
          size={element.size ?? 'M'}
          editing={editing}
          simplified={simplified}
        />
      );
    case 'document':
      return <DocumentCard session={session} element={element} simplified={simplified} />;
    case 'todo':
      return <TodoCard session={session} element={element} simplified={simplified} />;
    case 'column':
      return <ColumnCard session={session} element={element} simplified={simplified} editing={editing} />;
    case 'table':
      return <TableCard session={session} element={element} simplified={simplified} />;
    case 'sketch':
      return <SketchCard session={session} element={element} simplified={simplified} />;
    case 'map':
      return <MapCard session={session} element={element} simplified={simplified} />;
    case 'board':
      return <BoardCard element={element} simplified={simplified} />;
    case 'image':
      return <ImageCard session={session} element={element} simplified={simplified} />;
    case 'video':
      return <VideoCard session={session} element={element} simplified={simplified} />;
    case 'audio':
      return <AudioCard session={session} element={element} simplified={simplified} />;
    case 'file':
      return <FileCard session={session} element={element} simplified={simplified} />;
    case 'link':
      return <LinkCard session={session} element={element} simplified={simplified} />;
    case 'swatch':
      return <SwatchCard session={session} element={element} simplified={simplified} />;
    default:
      return <GenericCard type={element.type} />;
  }
}

function TextView({
  session,
  id,
  variant,
  size,
  editing,
  simplified,
}: {
  session: BoardSession;
  id: string;
  variant: 'note' | 'heading';
  size?: HeadingSize;
  editing: boolean;
  simplified: boolean;
}) {
  const blocks = useSessionText(id);
  const placeholder = PLACEHOLDER[variant] ?? 'Escribe…';

  if (editing) {
    const fragment = session.getTextFragment(id);
    if (fragment) {
      return (
        <Suspense fallback={<div className="rt-content rt-content--loading" />}>
          <LazyRichTextEditor
            fragment={fragment}
            placeholder={placeholder}
            contentClassName={variant === 'heading' ? HEADING_CLASS[size ?? 'M'] : undefined}
          />
        </Suspense>
      );
    }
  }

  if (simplified) {
    const line = firstLineOf(blocks);
    return (
      <div className="el-simplified" title={line}>
        {line.length > 0 ? line : placeholder}
      </div>
    );
  }

  if (isTextEmpty(blocks)) {
    return <div className="el-empty">{placeholder}</div>;
  }

  if (variant === 'heading') {
    return <TextBlocks blocks={blocks} className={`rt-heading ${HEADING_CLASS[size ?? 'M']}`} />;
  }

  return <TextBlocks blocks={blocks} className="rt" />;
}

function BoardCard({ element, simplified }: { element: CanvasElement; simplified: boolean }) {
  const boardId = element.type === 'board' ? element.boardId : '';
  const board = useAppStore((state) => state.boards.find((item) => item.id === boardId) ?? null);
  const icon = board?.icon ?? (element.type === 'board' ? element.icon : null) ?? '📋';
  const title = board?.title ?? 'Tablero';
  const count = board?.elementCount ?? knownBoardCount(boardId);

  return (
    <div className="board-card">
      <div className={`board-card__body${simplified ? ' is-simplified' : ''}`}>
        <span className="board-card__pages" aria-hidden="true" />
        <span className="board-card__icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="board-card__meta">
        <span className="board-card__title" title={title}>
          {title}
        </span>
        <span className="board-card__count">
          {count === null ? 'Tablero' : `${count} ${count === 1 ? 'elemento' : 'elementos'}`}
        </span>
      </div>
    </div>
  );
}

function GenericCard({ type }: { type: ElementType }) {
  return (
    <div className="el-generic">
      <span className="el-generic__label">{elementLabel(type)}</span>
      <span className="el-generic__hint">Disponible en una fase siguiente</span>
    </div>
  );
}

/** Texto plano de una tarjeta (título de pestaña, depuración). */
export function plainTextOf(session: BoardSession, id: string): string {
  return blocksToPlainText(session.getTextBlocks(id));
}

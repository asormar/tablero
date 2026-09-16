/**
 * Barra lateral de herramientas.
 *
 * Los tres tipos de la fase 1 se pueden arrastrar al lienzo (drag & drop nativo)
 * o crear con un clic en el centro de la vista. El resto de tipos del producto
 * aparecen deshabilitados con el aviso "próximamente".
 */

import { useState } from 'react';

import type { ElementType, HeadingSize } from '@tablero/shared';

import {
  Grid2x2,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  ListChecks,
  Map as MapIcon,
  Palette,
  PenTool,
  StickyNote,
  Table as TableIcon,
  Type,
  Video,
  FileText,
  Columns3,
  Sparkles,
} from 'lucide-react';

import {
  createBoardCardAt,
  createElementAt,
  createHeadingAt,
  createNoteAt,
  seedPerfNotes,
  sizeForType,
  spawnPoint,
} from '@/canvas/commands';
import { HEADING_MIME, TOOL_MIME } from '@/canvas/toolDrop';
import type { BoardSession } from '@/collab/BoardSession';
import { isDevBuild } from '@/lib/renderStats';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';
import { createNestedBoard } from '@/app/boardService';

type Tool = {
  type: ElementType;
  label: string;
  icon: JSX.Element;
  enabled: boolean;
  hint?: string;
};

const FUTURE_TOOLS: Tool[] = [
  { type: 'document', label: 'Documento', icon: <FileText size={18} />, enabled: false },
  { type: 'todo', label: 'Tareas', icon: <ListChecks size={18} />, enabled: false },
  { type: 'image', label: 'Imagen', icon: <ImageIcon size={18} />, enabled: false },
  { type: 'link', label: 'Enlace', icon: <Link2 size={18} />, enabled: false },
  { type: 'video', label: 'Vídeo', icon: <Video size={18} />, enabled: false },
  { type: 'column', label: 'Columna', icon: <Columns3 size={18} />, enabled: false },
  { type: 'table', label: 'Tabla', icon: <TableIcon size={18} />, enabled: false },
  { type: 'swatch', label: 'Muestra de color', icon: <Palette size={18} />, enabled: false },
  { type: 'sketch', label: 'Dibujo', icon: <PenTool size={18} />, enabled: false },
  { type: 'map', label: 'Mapa', icon: <MapIcon size={18} />, enabled: false },
];

const HEADING_SIZES: HeadingSize[] = ['S', 'M', 'L', 'XL'];

type ToolbarProps = {
  session: BoardSession;
  onOpenBoard(boardId: string): void;
};

export function Toolbar({ session }: ToolbarProps): JSX.Element {
  const [headingSize, setHeadingSize] = useState<HeadingSize>('M');
  const setPendingTool = useUiStore((state) => state.setPendingTool);
  const currentBoardId = useAppStore((state) => state.currentBoardId);

  const dragProps = (type: ElementType, extra?: Record<string, string>) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData(TOOL_MIME, type);
      for (const [key, value] of Object.entries(extra ?? {})) {
        event.dataTransfer.setData(key, value);
      }
      event.dataTransfer.effectAllowed = 'copy';
      setPendingTool(type);
    },
    onDragEnd: () => setPendingTool(null),
  });

  const addNote = (): void => {
    createNoteAt(session, spawnPoint());
  };

  const addHeading = (): void => {
    createHeadingAt(session, spawnPoint(), headingSize);
  };

  const addBoard = async (): Promise<void> => {
    const board = await createNestedBoard(currentBoardId, 'Tablero sin título', null);
    createBoardCardAt(session, spawnPoint(), board);
  };

  const addFuture = (type: ElementType): void => {
    createElementAt(session, type, spawnPoint());
  };

  const addTestNotes = (): void => {
    seedPerfNotes(session, 300);
  };

  return (
    <aside className="toolbar" aria-label="Herramientas">
      <div className="toolbar__group">
        <button
          type="button"
          className="toolbar__tool"
          title="Nota (N) · clic para crear o arrastrar al lienzo"
          onClick={addNote}
          {...dragProps('note')}
        >
          <StickyNote size={18} />
          <span className="toolbar__label">Nota</span>
        </button>

        <div className="toolbar__split">
          <button
            type="button"
            className="toolbar__tool toolbar__tool--split"
            title={`Encabezado ${headingSize} — clic para crear`}
            onClick={addHeading}
            {...dragProps('heading', { [HEADING_MIME]: headingSize })}
          >
            <Type size={18} />
            <span className="toolbar__label">Encabezado</span>
          </button>
          <div className="toolbar__sizes" role="group" aria-label="Tamaño del encabezado">
            {HEADING_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={`toolbar__size${size === headingSize ? ' is-active' : ''}`}
                title={`Encabezado ${size}`}
                onClick={() => setHeadingSize(size)}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="toolbar__tool"
          title="Tablero (B) — clic para crear un tablero anidado"
          onClick={() => void addBoard()}
          {...dragProps('board')}
        >
          <LayoutGrid size={18} />
          <span className="toolbar__label">Tablero</span>
        </button>
      </div>

      <div className="toolbar__group toolbar__group--future" aria-label="Próximamente">
        {FUTURE_TOOLS.map((tool) => (
          <button
            key={tool.type}
            type="button"
            className="toolbar__tool"
            disabled={!tool.enabled}
            title={tool.enabled ? tool.label : `${tool.label} — próximamente`}
            aria-label={tool.enabled ? tool.label : `${tool.label} (próximamente)`}
            onClick={() => (tool.enabled ? addFuture(tool.type) : undefined)}
            {...(tool.enabled ? dragProps(tool.type) : {})}
          >
            {tool.icon}
            <span className="toolbar__label">{tool.label}</span>
          </button>
        ))}
      </div>

      {isDevBuild ? (
        <div className="toolbar__group toolbar__group--dev">
          <button
            type="button"
            className="toolbar__tool"
            title="Generar 300 notas de prueba (Ctrl+Shift+Alt+N)"
            onClick={addTestNotes}
          >
            <Sparkles size={18} />
            <span className="toolbar__label">300 notas</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}

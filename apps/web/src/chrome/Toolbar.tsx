/**
 * Barra lateral de herramientas.
 *
 * Los tipos de la fase 1 y de la fase 2 se pueden arrastrar al lienzo (drag &
 * drop nativo) o crear con un clic cerca del centro de la vista. Los de
 * contenido abren el selector de archivos; el enlace y la muestra se crean
 * vacíos para completarlos en la tarjeta. Mapa, tabla, dibujo, columna,
 * documento y tareas siguen deshabilitados (fases siguientes).
 */

import { useState } from 'react';

import type { AssetKind, ElementType, HeadingSize } from '@tablero/shared';

import {
  Columns3,
  FileText,
  Grid2x2,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  ListChecks,
  Map as MapIcon,
  MessageSquarePlus,
  Mic,
  Music,
  Palette,
  Paperclip,
  PenTool,
  StickyNote,
  Table as TableIcon,
  Type,
  Video,
} from 'lucide-react';

import {
  createBoardCardAt,
  createHeadingAt,
  createNoteAt,
  seedPerfNotes,
  spawnPoint,
} from '@/canvas/commands';
import { SWATCH_DEFAULT_HEX, createLinkCardAt, createSwatchAt } from '@/canvas/contentCommands';
import { HEADING_MIME, TOOL_MIME, createToolAt } from '@/canvas/toolDrop';
import { attachFilesToBoard } from '@/canvas/uploadController';
import type { BoardSession } from '@/collab/BoardSession';
import { can as canCapability, capabilityRefusal } from '@/collab/roles';
import { useSessionPermission } from '@/collab/SessionContext';
import { DEFAULT_SIZES } from '@tablero/shared';
import { pickFiles } from '@/lib/filePicker';
import { isDevBuild } from '@/lib/renderStats';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';
import { createNestedBoard } from '@/app/boardService';

type Tool = {
  type: ElementType;
  label: string;
  icon: JSX.Element;
  hint: string;
};

/** Tipos de contenido de la fase 2 (activos). */
const CONTENT_TOOLS: Tool[] = [
  { type: 'image', label: 'Imagen', icon: <ImageIcon size={18} />, hint: 'Imagen — clic para elegir archivos' },
  { type: 'video', label: 'Vídeo', icon: <Video size={18} />, hint: 'Vídeo — clic para elegir archivos' },
  // Nota musical (el mismo icono que la tarjeta de audio vacía): el micrófono
  // queda para «Grabar», que es otra acción, en la misma barra.
  { type: 'audio', label: 'Audio', icon: <Music size={18} />, hint: 'Audio — clic para elegir archivos' },
  { type: 'file', label: 'Archivo', icon: <Paperclip size={18} />, hint: 'Archivo — clic para elegir archivos' },
  { type: 'link', label: 'Enlace', icon: <Link2 size={18} />, hint: 'Enlace — clic para crear una tarjeta y pegar la URL' },
  { type: 'swatch', label: 'Muestra', icon: <Palette size={18} />, hint: 'Muestra de color — clic para crear una' },
];

/** Tipos de la fase 3 (estructura y organización). */
const STRUCTURE_TOOLS: Tool[] = [
  { type: 'document', label: 'Documento', icon: <FileText size={18} />, hint: 'Documento — doble clic para abrirlo a página completa' },
  { type: 'todo', label: 'Tareas', icon: <ListChecks size={18} />, hint: 'Lista de tareas — Enter, Tab y fechas de vencimiento' },
  { type: 'column', label: 'Columna', icon: <Columns3 size={18} />, hint: 'Columna (C) — varias en fila forman un kanban' },
  { type: 'table', label: 'Tabla', icon: <TableIcon size={18} />, hint: 'Tabla editable — pega desde Excel o Google Sheets' },
  { type: 'sketch', label: 'Dibujo', icon: <PenTool size={18} />, hint: 'Dibujo a mano alzada — lápiz, rotulador, goma' },
  { type: 'map', label: 'Mapa', icon: <MapIcon size={18} />, hint: 'Mapa con marcadores — busca lugares por nombre' },
];

const ASSET_KIND_BY_TYPE: Partial<Record<ElementType, AssetKind>> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'file',
};

const HEADING_SIZES: HeadingSize[] = ['S', 'M', 'L', 'XL'];

type ToolbarProps = {
  session: BoardSession;
  onOpenBoard(boardId: string): void;
};

export function Toolbar({ session }: ToolbarProps): JSX.Element {
  const [headingSize, setHeadingSize] = useState<HeadingSize>('M');
  const setPendingTool = useUiStore((state) => state.setPendingTool);
  const setRecorderOpen = useUiStore((state) => state.setRecorderOpen);
  const currentBoardId = useAppStore((state) => state.currentBoardId);
  const permission = useSessionPermission();
  const canCreate = canCapability(permission.role, 'edit');
  const commentPinMode = useUiStore((state) => state.commentPinMode);
  const canComment = canCapability(permission.role, 'comment');

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

  /** Clic en una herramienta de contenido: elegir archivos y crear tarjetas. */
  const addAssets = async (kind: AssetKind): Promise<void> => {
    const files = await pickFiles(kind === 'file' ? 'any' : kind, true);
    if (files.length === 0) return;
    await attachFilesToBoard(session, files, { world: spawnPoint() });
  };

  const addLink = (): void => {
    const size = DEFAULT_SIZES.link;
    const world = spawnPoint();
    createLinkCardAt(
      session,
      { x: world.x - size.width / 2, y: world.y - (size.height ?? 96) / 2 },
      '',
      null,
    );
  };

  const addSwatch = (): void => {
    const size = DEFAULT_SIZES.swatch;
    const world = spawnPoint();
    createSwatchAt(
      session,
      { x: world.x - size.width / 2, y: world.y - (size.height ?? 112) / 2 },
      SWATCH_DEFAULT_HEX,
      '',
    );
  };

  const addTestNotes = (): void => {
    seedPerfNotes(session, 300);
  };

  const renderContentTool = (tool: Tool): JSX.Element => {
    const kind = ASSET_KIND_BY_TYPE[tool.type];
    const onClick = (): void => {
      if (kind) {
        void addAssets(kind);
        return;
      }
      if (tool.type === 'link') {
        addLink();
        return;
      }
      if (tool.type === 'swatch') {
        addSwatch();
        return;
      }
      void createToolAt(session, tool.type, spawnPoint(), headingSize, currentBoardId);
    };

    return (
      <button
        key={tool.type}
        type="button"
        className="toolbar__tool"
        title={`${tool.hint} · arrastrar al lienzo`}
        onClick={onClick}
        {...dragProps(tool.type)}
      >
        {tool.icon}
        <span className="toolbar__label">{tool.label}</span>
      </button>
    );
  };

  return (
    <aside
      className={`toolbar${canCreate ? '' : ' toolbar--readonly'}`}
      aria-label="Herramientas"
      data-toolbar-editable={canCreate ? 'yes' : 'no'}
    >
      {!canCreate ? (
        // Rol de lectura: no hay barra de creación. Se explica por qué y, si el
        // rol permite comentar, queda el botón de la chincheta.
        <div className="toolbar__readonly" data-toolbar-readonly role="note">
          <span className="toolbar__readonly-text">
            {capabilityRefusal(permission.role, 'edit') ?? 'Este tablero está en solo lectura.'}
          </span>
          {canComment ? (
            <button
              type="button"
              className={`toolbar__tool${commentPinMode ? ' is-active' : ''}`}
              title="Colocar un comentario en el lienzo"
              data-toolbar-comment-pin
              aria-pressed={commentPinMode}
              onClick={() => useUiStore.getState().setCommentPinMode(!commentPinMode)}
            >
              <MessageSquarePlus size={18} />
              <span className="toolbar__label">Comentar</span>
            </button>
          ) : null}
        </div>
      ) : (
        <>
      <div className="toolbar__group" role="group" aria-label="Crear">
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

      <div className="toolbar__group" role="group" aria-label="Contenido">
        {CONTENT_TOOLS.map(renderContentTool)}
        <button
          type="button"
          className="toolbar__tool"
          title="Grabar audio con el micrófono"
          aria-label="Grabar audio con el micrófono"
          onClick={() => setRecorderOpen(true)}
        >
          <Mic size={18} />
          <span className="toolbar__label">Grabar</span>
        </button>
      </div>

      <div className="toolbar__group toolbar__group--structure" role="group" aria-label="Estructura">
        {STRUCTURE_TOOLS.map(renderContentTool)}
        <button
          type="button"
          className={`toolbar__tool${commentPinMode ? ' is-active' : ''}`}
          title="Colocar un comentario suelto en el lienzo"
          aria-label="Colocar un comentario en el lienzo"
          data-toolbar-comment-pin
          aria-pressed={commentPinMode}
          onClick={() => useUiStore.getState().setCommentPinMode(!commentPinMode)}
        >
          <MessageSquarePlus size={18} />
          <span className="toolbar__label">Comentar</span>
        </button>
      </div>

      {isDevBuild ? (
        <div className="toolbar__group toolbar__group--dev" role="group" aria-label="Desarrollo">
          <button
            type="button"
            className="toolbar__tool"
            title="Generar 300 notas de prueba (Ctrl+Shift+Alt+N)"
            aria-label="Generar 300 notas de prueba"
            onClick={addTestNotes}
          >
            <Grid2x2 size={18} />
            <span className="toolbar__label">300 notas</span>
          </button>
        </div>
      ) : null}
        </>
      )}
    </aside>
  );
}

/**
 * Tarjeta de dibujo a mano alzada.
 *
 * `perfect-freehand` + Pointer Events: el lápiz aprovecha la presión del lápiz
 * (y la simula con el ratón). Herramientas: lápiz, rotulador, subrayador, goma,
 * línea, rectángulo y elipse; color y grosor; fondo transparente o blanco.
 *
 * Cada trazo se guarda **simplificado** (`simplifyStroke`) y la goma recorta
 * geométricamente (`eraseStrokes`), para no inflar el documento. Mientras se
 * dibuja solo se pinta una vista previa local: al documento va un trazo por
 * gesto (un paso de deshacer). El deshacer propio del dibujo es local (una pila
 * de trazos) y no toca el historial del lienzo.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  Circle,
  Eraser,
  Highlighter,
  Minus,
  Pen,
  Pencil,
  Redo2,
  Square,
  Undo2,
} from 'lucide-react';

import {
  type CanvasElement,
  type SketchStroke,
  type SketchTool,
  SKETCH_SIZES,
  appendPoints,
  createStroke,
  eraserRadius,
  eraseStrokes,
  patchElement,
  pointsOf,
} from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { finishStroke, renderOf, samplesToPoints, shapeRect } from '@/lib/sketchMath';
import { useUiStore } from '@/state/uiStore';

const PALETTE: string[] = [
  '#2B2B28',
  '#6B6B66',
  '#C93B3B',
  '#D2761F',
  '#B58A00',
  '#3E8A2F',
  '#248C81',
  '#2F6FC9',
  '#7A4FBF',
  '#C2467F',
];

const TOOLS: { tool: SketchTool; label: string; icon: JSX.Element }[] = [
  { tool: 'pen', label: 'Lápiz', icon: <Pencil size={14} /> },
  { tool: 'marker', label: 'Rotulador', icon: <Pen size={14} /> },
  { tool: 'highlighter', label: 'Subrayador', icon: <Highlighter size={14} /> },
  { tool: 'eraser', label: 'Goma', icon: <Eraser size={14} /> },
  { tool: 'line', label: 'Línea', icon: <Minus size={14} /> },
  { tool: 'rect', label: 'Rectángulo', icon: <Square size={14} /> },
  { tool: 'ellipse', label: 'Elipse', icon: <Circle size={14} /> },
];

const MAX_HISTORY = 40;

export type SketchCardProps = {
  session: BoardSession;
  element: CanvasElement;
  simplified: boolean;
};

export function SketchCard({ session, element, simplified }: SketchCardProps): JSX.Element | null {
  const [tool, setTool] = useState<SketchTool>('pen');
  const [color, setColor] = useState(PALETTE[0] as string);
  const [size, setSize] = useState<number>(SKETCH_SIZES[2] ?? 4);
  const [preview, setPreview] = useState<SketchStroke | null>(null);
  const [working, setWorking] = useState<SketchStroke[] | null>(null);
  const history = useRef<SketchStroke[][]>([]);
  const redoStack = useRef<SketchStroke[][]>([]);
  const drawing = useRef<{ id: string; active: boolean }>({ id: '', active: false });
  const svg = useRef<SVGSVGElement | null>(null);

  const strokes = useMemo<SketchStroke[]>(
    () => (element.type === 'sketch' ? element.strokes ?? [] : []),
    [element],
  );
  const background = element.type === 'sketch' ? element.background ?? 'transparent' : 'transparent';

  useEffect(() => {
    history.current = [];
    redoStack.current = [];
  }, [element.id]);

  if (element.type !== 'sketch') return null;

  const commit = (next: SketchStroke[], record = true): void => {
    if (record) {
      history.current = [...history.current.slice(-MAX_HISTORY + 1), strokes];
      redoStack.current = [];
    }
    patchElement(session.doc, element.id, { strokes: next }, session.origin);
  };

  const undoLocal = (): void => {
    const previous = history.current[history.current.length - 1];
    if (!previous) return;
    history.current = history.current.slice(0, -1);
    redoStack.current = [...redoStack.current, strokes];
    patchElement(session.doc, element.id, { strokes: previous }, session.origin);
  };

  const redoLocal = (): void => {
    const next = redoStack.current[redoStack.current.length - 1];
    if (!next) return;
    redoStack.current = redoStack.current.slice(0, -1);
    history.current = [...history.current, strokes];
    patchElement(session.doc, element.id, { strokes: next }, session.origin);
  };

  /** Punto de la tarjeta a partir de un evento de puntero. */
  const localPoint = (event: { clientX: number; clientY: number }, pressure?: number): { x: number; y: number; pressure: number } => {
    const rect = svg.current?.getBoundingClientRect();
    const width = element.width || 1;
    const height = element.height ?? 220;
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0, pressure: pressure ?? 0.5 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
      pressure: pressure && pressure > 0 ? pressure : 0.5,
    };
  };

  const startDraw = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (simplified) return;
    event.stopPropagation();
    event.preventDefault();
    const point = localPoint(event, event.pressure);
    if (tool === 'eraser') {
      drawing.current = { id: 'eraser', active: true };
      setWorking(eraseStrokes(strokes, { x: point.x, y: point.y }, eraserRadius(size), 'split'));
      return;
    }
    const stroke = appendPoints(createStroke(tool, color, size), [point]);
    drawing.current = { id: stroke.id, active: true };
    setPreview(stroke);
  };

  const moveDraw = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!drawing.current.active) return;
    event.stopPropagation();
    const point = localPoint(event, event.pressure);
    if (drawing.current.id === 'eraser') {
      // La goma trabaja sobre una copia local: al documento va un solo gesto.
      setWorking((current) =>
        eraseStrokes(current ?? strokes, { x: point.x, y: point.y }, eraserRadius(size), 'split'),
      );
      return;
    }
    setPreview((current) => (current ? appendPoints(current, [point]) : current));
  };

  const endDraw = (): void => {
    if (!drawing.current.active) return;
    const erasing = drawing.current.id === 'eraser';
    drawing.current = { id: '', active: false };
    if (erasing) {
      const result = working;
      setWorking(null);
      if (result && result.length !== strokes.length) commit(result);
      else if (result && result.some((stroke, index) => stroke.id !== strokes[index]?.id)) commit(result);
      return;
    }
    const stroke = preview;
    setPreview(null);
    if (!stroke || pointsOf(stroke).length < 2) return;
    commit([...strokes, finishStroke(stroke)]);
  };

  const height = element.height ?? 220;

  if (simplified) {
    return (
      <div className="el-simplified" title={`Dibujo (${strokes.length} trazos)`}>
        {`Dibujo · ${strokes.length}`}
      </div>
    );
  }

  return (
    <div className="sketch" data-interactive onPointerDown={(event) => event.stopPropagation()}>
      <div className="sketch__tools">
        {TOOLS.map((entry) => (
          <button
            key={entry.tool}
            type="button"
            className={`icon-button icon-button--small${tool === entry.tool ? ' is-active' : ''}`}
            title={entry.label}
            aria-pressed={tool === entry.tool}
            onClick={() => setTool(entry.tool)}
          >
            {entry.icon}
          </button>
        ))}
        <span className="sketch__sep" />
        <div className="sketch__colors">
          {PALETTE.map((hex) => (
            <button
              key={hex}
              type="button"
              className={`sketch__color${color === hex ? ' is-active' : ''}`}
              style={{ background: hex }}
              title={hex}
              aria-label={`Color ${hex}`}
              onClick={() => setColor(hex)}
            />
          ))}
        </div>
        <select
          className="sketch__size"
          value={size}
          title="Grosor"
          aria-label="Grosor del trazo"
          onChange={(event) => setSize(Number(event.target.value))}
        >
          {SKETCH_SIZES.map((value) => (
            <option key={value} value={value}>
              {value} px
            </option>
          ))}
        </select>
        <span className="sketch__sep" />
        <button
          type="button"
          className="icon-button icon-button--small"
          title="Deshacer trazo"
          disabled={history.current.length === 0}
          onClick={undoLocal}
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          className="icon-button icon-button--small"
          title="Rehacer trazo"
          disabled={redoStack.current.length === 0}
          onClick={redoLocal}
        >
          <Redo2 size={13} />
        </button>
        <button
          type="button"
          className="icon-button icon-button--small"
          title={background === 'white' ? 'Fondo transparente' : 'Fondo blanco'}
          aria-pressed={background === 'white'}
          onClick={() =>
            patchElement(
              session.doc,
              element.id,
              { background: background === 'white' ? 'transparent' : 'white' },
              session.origin,
            )
          }
        >
          <span className={`sketch__bg${background === 'white' ? ' is-white' : ''}`} />
        </button>
      </div>

      <svg
        ref={svg}
        className={`sketch__canvas${background === 'white' ? ' is-white' : ''}`}
        viewBox={`0 0 ${element.width || 320} ${height}`}
        preserveAspectRatio="none"
        onPointerDown={startDraw}
        onPointerMove={moveDraw}
        onPointerUp={endDraw}
        onPointerLeave={endDraw}
        onPointerCancel={endDraw}
        style={{ touchAction: 'none' }}
      >
        {(working ?? strokes).map((stroke) => {
          const render = renderOf(stroke);
          if (render.kind === 'shape') {
            const rect = shapeRect(render.from, render.to);
            if (render.shape === 'line') {
              return (
                <line
                  key={stroke.id}
                  x1={render.from.x}
                  y1={render.from.y}
                  x2={render.to.x}
                  y2={render.to.y}
                  stroke={stroke.color}
                  strokeWidth={render.size}
                  strokeLinecap="round"
                  opacity={render.opacity}
                />
              );
            }
            if (render.shape === 'rect') {
              return (
                <rect
                  key={stroke.id}
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth={render.size}
                  opacity={render.opacity}
                />
              );
            }
            return (
              <ellipse
                key={stroke.id}
                cx={rect.x + rect.width / 2}
                cy={rect.y + rect.height / 2}
                rx={rect.width / 2}
                ry={rect.height / 2}
                fill="none"
                stroke={stroke.color}
                strokeWidth={render.size}
                opacity={render.opacity}
              />
            );
          }
          return <path key={stroke.id} d={render.path} fill={stroke.color} opacity={render.opacity} />;
        })}
        {preview && preview.points.length > 0
          ? (() => {
              const render = renderOf(preview);
              return render.kind === 'freehand' ? (
                <path d={render.path} fill={preview.color} opacity={render.opacity} />
              ) : null;
            })()
          : null}
      </svg>
      {strokes.length === 0 && !preview ? <p className="sketch__hint">Dibuja aquí</p> : null}
    </div>
  );
}

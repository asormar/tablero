/**
 * Barra contextual flotante sobre la selección.
 *
 * Color, orden de apilado, alineación/distribución (con 2+ elementos),
 * duplicar, bloquear y eliminar. Se sitúa encima de la caja envolvente de la
 * selección y se oculta mientras dura un arrastre (ahí manda el DOM).
 */

import { useMemo, useState } from 'react';

import { boundsOf } from '@tablero/shared';
import type { AlignAction } from '@tablero/shared';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  BetweenHorizontalStart,
  BetweenVerticalStart,
  CopyPlus,
  FolderInput,
  Lock,
  LockOpen,
  Palette,
  Trash2,
} from 'lucide-react';

import {
  alignSelection,
  bringSelectionToFront,
  deleteSelection,
  duplicateSelection,
  sendSelectionToBack,
  setSelectionColor,
  toggleSelectionLock,
} from '@/canvas/commands';
import type { BoardSession } from '@/collab/BoardSession';
import { useSessionLayout } from '@/collab/SessionContext';
import { availableAlignActions } from '@/lib/align';
import { rectOf } from '@/lib/layout';
import { useUiStore } from '@/state/uiStore';

import { ColorPicker } from './ColorPicker';
import { useOutsideClose } from './useOutsideClose';

const ALIGN_ICONS: Record<AlignAction, JSX.Element> = {
  left: <AlignStartVertical size={15} />,
  'center-x': <AlignCenterVertical size={15} />,
  right: <AlignEndVertical size={15} />,
  top: <AlignStartHorizontal size={15} />,
  'center-y': <AlignCenterHorizontal size={15} />,
  bottom: <AlignEndHorizontal size={15} />,
  'distribute-x': <BetweenHorizontalStart size={15} />,
  'distribute-y': <BetweenVerticalStart size={15} />,
};

export function ContextBar({ session }: { session: BoardSession }): JSX.Element | null {
  const selection = useUiStore((state) => state.selection);
  const viewport = useUiStore((state) => state.viewport);
  const canvasSize = useUiStore((state) => state.canvasSize);
  const measured = useUiStore((state) => state.measuredHeights);
  const interaction = useUiStore((state) => state.interaction);
  const layout = useSessionLayout();
  const [colorsOpen, setColorsOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);

  const colorsRef = useOutsideClose<HTMLDivElement>(colorsOpen, () => setColorsOpen(false));
  const alignRef = useOutsideClose<HTMLDivElement>(alignOpen, () => setAlignOpen(false));

  const items = useMemo(() => {
    if (selection.length === 0) return [];
    const wanted = new Set(selection);
    return layout.filter((item) => wanted.has(item.id));
  }, [layout, selection]);

  const bounds = useMemo(
    () => boundsOf(items.map((item) => rectOf(item, measured))),
    [items, measured],
  );

  const first = items[0];
  const element = first ? session.getElement(first.id) : null;
  const allLocked = items.length > 0 && items.every((item) => item.locked);
  const colorValue = element?.color;

  if (items.length === 0 || !bounds || interaction !== 'idle') return null;

  const screenX = (bounds.x + bounds.width / 2 - viewport.x) * viewport.scale;
  const screenY = (bounds.y - viewport.y) * viewport.scale;
  const halfWidth = 190;
  const left = Math.min(Math.max(screenX, halfWidth), Math.max(halfWidth, canvasSize.width - halfWidth));
  const placeBelow = screenY < 96;
  const top = placeBelow ? screenY + bounds.height * viewport.scale + 12 : screenY - 10;

  return (
    <div
      className="ctxbar"
      style={{ left, top, transform: placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="ctxbar__group" ref={colorsRef}>
        <button
          type="button"
          className={`icon-button${colorsOpen ? ' is-active' : ''}`}
          title="Color"
          onClick={() => setColorsOpen((open) => !open)}
        >
          <Palette size={15} />
        </button>
        {colorsOpen ? (
          <div className="popover popover--colors">
            <ColorPicker
              value={colorValue}
              onPick={(token) => {
                setSelectionColor(session, token);
                setColorsOpen(false);
              }}
            />
          </div>
        ) : null}
      </div>

      <span className="ctxbar__sep" />

      <button
        type="button"
        className="icon-button"
        title="Traer al frente"
        onClick={() => bringSelectionToFront(session)}
      >
        <ArrowUpToLine size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        title="Enviar al fondo"
        onClick={() => sendSelectionToBack(session)}
      >
        <ArrowDownToLine size={15} />
      </button>

      {items.length >= 2 ? (
        <>
          <span className="ctxbar__sep" />
          <div className="ctxbar__group" ref={alignRef}>
            <button
              type="button"
              className={`icon-button${alignOpen ? ' is-active' : ''}`}
              title="Alinear y distribuir"
              onClick={() => setAlignOpen((open) => !open)}
            >
              <AlignStartVertical size={15} />
            </button>
            {alignOpen ? (
              <div className="popover popover--align">
                {availableAlignActions(items.length).map((option) => (
                  <button
                    key={option.action}
                    type="button"
                    className="menu__item"
                    title={option.label}
                    onClick={() => {
                      alignSelection(session, option.action);
                      setAlignOpen(false);
                    }}
                  >
                    {ALIGN_ICONS[option.action]}
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <span className="ctxbar__sep" />

      <button
        type="button"
        className="icon-button"
        title="Mover a otro tablero…"
        onClick={() => useUiStore.getState().setMoveToOpen(true)}
      >
        <FolderInput size={15} />
      </button>

      <button
        type="button"
        className="icon-button"
        title={`Duplicar (Ctrl+D)${items.length > 1 ? ' · 1 paso de deshacer' : ''}`}
        onClick={() => duplicateSelection(session)}
      >
        <CopyPlus size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        title={allLocked ? 'Desbloquear posición' : 'Bloquear posición'}
        onClick={() => toggleSelectionLock(session)}
      >
        {allLocked ? <LockOpen size={15} /> : <Lock size={15} />}
      </button>
      <button
        type="button"
        className="icon-button icon-button--danger"
        title="Eliminar (Supr)"
        onClick={() => deleteSelection(session)}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

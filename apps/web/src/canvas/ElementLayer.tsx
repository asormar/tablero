/**
 * Capa de elementos con virtualización.
 *
 * Solo se montan las tarjetas que intersectan el viewport ampliado por un
 * margen de 320 px de mundo: con 300 notas y la vista ajustada, el número de
 * nodos en el DOM se mantiene bajo y el desplazamiento sigue siendo fluido.
 */

import { memo, useEffect, useMemo } from 'react';

import { SIMPLIFIED_SCALE } from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { useSessionLayout } from '@/collab/SessionContext';
import { LAYOUT_PADDING, visibleLayout } from '@/lib/layout';
import { countLayerRender, isDevBuild, setMounted } from '@/lib/renderStats';
import { useUiStore } from '@/state/uiStore';

import { CanvasElementView } from './CanvasElementView';
import { mountedNodeCount } from './nodeRegistry';

function ElementLayerBase({ session }: { session: BoardSession }): JSX.Element {
  if (isDevBuild) countLayerRender();

  const layout = useSessionLayout();
  const viewport = useUiStore((state) => state.viewport);
  const canvasSize = useUiStore((state) => state.canvasSize);
  const selection = useUiStore((state) => state.selection);
  const editingId = useUiStore((state) => state.editingId);
  const measuredHeights = useUiStore((state) => state.measuredHeights);
  const draggingIds = useUiStore((state) => state.draggingIds);
  const simplified = viewport.scale < SIMPLIFIED_SCALE;

  const visible = useMemo(
    () =>
      visibleLayout(
        layout,
        {
          x: viewport.x,
          y: viewport.y,
          width: canvasSize.width / viewport.scale,
          height: canvasSize.height / viewport.scale,
        },
        measuredHeights,
        LAYOUT_PADDING,
      ),
    [layout, measuredHeights, viewport.x, viewport.y, viewport.scale, canvasSize.width, canvasSize.height],
  );

  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const dragging = useMemo(() => new Set(draggingIds), [draggingIds]);
  const showHandles = selection.length === 1;
  const visibleCount = visible.length;

  useEffect(() => {
    if (isDevBuild) setMounted(visibleCount, mountedNodeCount());
  }, [visibleCount]);

  return (
    <>
      {visible.map((item) => (
        <CanvasElementView
          key={item.id}
          session={session}
          id={item.id}
          type={item.type}
          x={item.x}
          y={item.y}
          width={item.width}
          height={item.height}
          autoHeight={item.autoHeight}
          selected={selectedIds.has(item.id)}
          editing={editingId === item.id}
          dragging={dragging.has(item.id)}
          simplified={simplified}
          showHandles={showHandles}
        />
      ))}
    </>
  );
}

export const ElementLayer = memo(ElementLayerBase);

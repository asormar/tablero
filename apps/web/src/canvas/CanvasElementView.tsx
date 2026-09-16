/**
 * Tarjeta del lienzo.
 *
 * Se suscribe únicamente a su propio `Y.Map` (y a su texto) mediante
 * `useSyncExternalStore`: mover o editar una tarjeta no re-renderiza las demás.
 * El posicionamiento va en `transform` (una sola propiedad, sin layout) para que
 * el arrastre se pueda resolver escribiendo directamente en el DOM.
 */

import { memo, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

import { Lock } from 'lucide-react';

import type { ElementType } from '@tablero/shared';
import { ASPECT_RESIZABLE } from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { useSessionElement } from '@/collab/SessionContext';
import { ElementContent } from '@/elements/ElementContent';
import { countElementRender, isDevBuild } from '@/lib/renderStats';
import { noteSurface } from '@/lib/smartPaste';

import { observeHeight, unobserveHeight } from './measure';
import { registerNode } from './nodeRegistry';

export type CanvasElementViewProps = {
  session: BoardSession;
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  autoHeight: boolean;
  selected: boolean;
  editing: boolean;
  /** La tarjeta se está moviendo ahora mismo. */
  dragging: boolean;
  simplified: boolean;
  showHandles: boolean;
};

function CanvasElementViewBase(props: CanvasElementViewProps): JSX.Element | null {
  if (isDevBuild) countElementRender();
  const { session, id, type } = props;
  const element = useSessionElement(id);
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    registerNode(id, node);
    observeHeight(node);
    return () => {
      registerNode(id, null);
      unobserveHeight(node);
    };
  }, [id]);

  if (!element) return null;

  const style: CSSProperties = {
    transform: `translate3d(${props.x}px, ${props.y}px, 0)`,
    width: props.width,
  };
  if (!props.autoHeight) style.height = props.height;

  const classes = ['el', `el--${type}`];
  if (props.selected) classes.push('is-selected');
  if (props.editing) classes.push('is-editing');
  if (props.dragging) classes.push('is-dragging');
  if (element.locked) classes.push('is-locked');
  if (props.simplified) classes.push('is-zoomed-out');
  // «Sin marco»: la imagen se muestra sola, sin tarjeta alrededor.
  if (element.type === 'image' && element.frameless) classes.push('is-frameless');
  // Animación de entrada solo en tarjetas recién creadas (no al virtualizar).
  const isNew = element.createdAt > 0 && Date.now() - element.createdAt < 320;
  if (isNew) classes.push('is-new');

  const hasSurface = Boolean(element.hex) || (element.color !== undefined && element.color !== 'none');
  if (hasSurface) {
    const surface = noteSurface(element.color, element.hex);
    style.background = surface.background;
    style.color = surface.color;
  }

  return (
    <div
      ref={ref}
      className={classes.join(' ')}
      data-element-id={id}
      data-type={type}
      style={style}
      role="group"
      aria-label={type}
    >
      <div className="el__content">
        <ElementContent
          session={session}
          element={element}
          editing={props.editing}
          simplified={props.simplified}
        />
      </div>
      {element.locked ? (
        <span className="el__lock" title="Posición bloqueada">
          <Lock size={12} />
        </span>
      ) : null}
      {props.showHandles && !element.locked ? (
        <>
          <span className="el__handle el__handle--w" data-handle="w" />
          <span className="el__handle el__handle--e" data-handle="e" />
          {ASPECT_RESIZABLE.includes(type) ? (
            <span className="el__handle el__handle--se" data-handle="se" title="Redimensionar proporcional" />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export const CanvasElementView = memo(CanvasElementViewBase);

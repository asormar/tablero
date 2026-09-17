/**
 * Tarjeta del lienzo.
 *
 * Se suscribe únicamente a su propio `Y.Map` (y a su texto) mediante
 * `useSyncExternalStore`: mover o editar una tarjeta no re-renderiza las demás.
 * El posicionamiento va en `transform` (una sola propiedad, sin layout) para que
 * el arrastre se pueda resolver escribiendo directamente en el DOM.
 */

import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { Lock } from 'lucide-react';

import type { ElementType } from '@tablero/shared';
import { ASPECT_RESIZABLE } from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { CardCommentBadge } from '@/collab/CommentLayer';
import { can as canCapability } from '@/collab/roles';
import { useSessionElement, useSessionPermission } from '@/collab/SessionContext';
import { ElementContent } from '@/elements/ElementContent';
import { useT } from '@/i18n';
import { cardAriaLabel } from '@/lib/a11y';
import { countElementRender, isDevBuild } from '@/lib/renderStats';
import { noteSurface } from '@/lib/smartPaste';
import { blocksToPlainText } from '@/lib/textBlocks';
import { elementTypeLabel } from '@/search/typeLabels';
import { useSettingsStore } from '@/settings/settingsStore';
import { useUiStore } from '@/state/uiStore';

import { editElement } from './commands';
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

/** Puntos de anclaje para crear conectores (aparecen al pasar el ratón). */
const ANCHOR_SIDES = ['left', 'right', 'top', 'bottom'] as const;

function CanvasElementViewBase(props: CanvasElementViewProps): JSX.Element | null {
  if (isDevBuild) countElementRender();
  const { session, id, type } = props;
  const element = useSessionElement(id);
  const theme = useSettingsStore((state) => state.resolvedTheme);
  const t = useT();
  const permission = useSessionPermission();
  const readOnly = !canCapability(permission.role, 'edit');
  const ref = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);

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
  // Modo lectura (fase 5): el contenido de la tarjeta deja de recibir punteros,
  // así ninguna zona interactiva (casillas, celdas, mapas, dibujo) puede
  // escribir. La tarjeta se sigue pudiendo seleccionar para leerla.
  if (readOnly) classes.push('is-readonly');
  // «Sin marco»: la imagen se muestra sola, sin tarjeta alrededor.
  if (element.type === 'image' && element.frameless) classes.push('is-frameless');
  // Animación de entrada solo en tarjetas recién creadas (no al virtualizar).
  const isNew = element.createdAt > 0 && Date.now() - element.createdAt < 320;
  if (isNew) classes.push('is-new');

  const hasSurface = Boolean(element.hex) || (element.color !== undefined && element.color !== 'none');
  if (hasSurface) {
    // El color de la tarjeta respeta el tema activo (fase 4): el token tiene
    // variante clara y oscura.
    const surface = noteSurface(element.color, element.hex, theme);
    style.background = surface.background;
    style.color = surface.color;
  }

  // Nombre accesible: tipo traducido + adelanto del texto (fase 6).
  // `getTextBlocks` está cacheado por versión del elemento (la misma
  // suscripción que ya trae `useSessionElement`), así que esta lectura no
  // agrega trabajo por render ni una suscripción extra por tarjeta.
  const label = cardAriaLabel(elementTypeLabel(type, t), blocksToPlainText(session.getTextBlocks(id)), { locked: element.locked });

  /**
   * Teclado (fase 6): al recibir el foco la tarjeta entra en la selección — así
   * las flechas, `Supr` y el menú contextual funcionan igual que con el ratón.
   */
  const focusCard = (): void => {
    const ui = useUiStore.getState();
    if (ui.editingId === id) return;
    if (ui.selection.length === 1 && ui.selection[0] === id) return;
    ui.select([id]);
  };

  /** `Shift+F10` / tecla Menú abre el menú de la tarjeta, como el clic derecho. */
  const onCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // Solo cuando el foco está en la tarjeta, no dentro de su editor.
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = ref.current?.getBoundingClientRect();
      useUiStore.getState().setContextMenu({ x: Math.round(rect?.left ?? 0) + 24, y: Math.round(rect?.top ?? 0) + 24, targetId: id });
      return;
    }
    if (event.key === 'Enter' && !readOnly) {
      event.preventDefault();
      editElement(session, id);
    }
  };

  return (
    <div
      ref={ref}
      className={classes.join(' ')}
      data-element-id={id}
      data-type={type}
      style={style}
      role="group"
      aria-label={label}
      tabIndex={0}
      onFocus={focusCard}
      onKeyDown={onCardKeyDown}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div className="el__content">
        <ElementContent
          session={session}
          element={element}
          editing={props.editing}
          simplified={props.simplified}
        />
      </div>
      {!props.simplified ? <CardCommentBadge elementId={id} /> : null}
      {element.locked ? (
        <span className="el__lock" title="Posición bloqueada">
          <Lock size={12} />
        </span>
      ) : null}
      {!readOnly && !props.simplified && !element.locked && (hovered || props.selected) ? (
        <>
          {ANCHOR_SIDES.map((side) => (
            <span
              key={side}
              className={`el__anchor el__anchor--${side}`}
              data-anchor={side}
              aria-hidden="true"
              title="Arrastrar para conectar con otra tarjeta"
            />
          ))}
        </>
      ) : null}
      {!readOnly && props.showHandles && !element.locked ? (
        <>
          <span className="el__handle el__handle--w" data-handle="w" aria-hidden="true" />
          <span className="el__handle el__handle--e" data-handle="e" aria-hidden="true" />
          {ASPECT_RESIZABLE.includes(type) ? (
            <span className="el__handle el__handle--se" data-handle="se" aria-hidden="true" title="Redimensionar proporcional" />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export const CanvasElementView = memo(CanvasElementViewBase);

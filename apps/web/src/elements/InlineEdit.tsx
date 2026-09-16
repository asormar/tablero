/**
 * Texto editable dentro de una tarjeta (pie de foto, nombre de una muestra,
 * título de un enlace).
 *
 * Es un campo controlado de verdad, no un `contenteditable`: el texto se
 * escribe con el teclado y se confirma al salir del campo o con Enter, así que
 * cada edición es **una** transacción del documento (un paso de deshacer) y no
 * una escritura por pulsación.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type InlineEditProps = {
  value: string;
  placeholder: string;
  ariaLabel: string;
  className?: string;
  /** Verdadero: `textarea` que crece con el texto (pie de foto). */
  multiline?: boolean;
  /** Se llama solo si el valor cambió de verdad. */
  onCommit(value: string): void;
  /** Se llama al empezar a editar (útil para no arrastrar la tarjeta). */
  onFocus?(): void;
};

export function InlineEdit({
  value,
  placeholder,
  ariaLabel,
  className,
  multiline = false,
  onCommit,
  onFocus,
}: InlineEditProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const node = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Mientras no se edita, el campo sigue al documento (otro usuario, deshacer).
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  useLayoutEffect(() => {
    const current = node.current;
    if (!current || !multiline) return;
    current.style.height = 'auto';
    current.style.height = `${Math.min(current.scrollHeight, 120)}px`;
  }, [draft, multiline]);

  const commit = (): void => {
    setFocused(false);
    if (draft !== value) onCommit(draft);
  };

  const shared = {
    className: ['inline-edit', className].filter(Boolean).join(' '),
    value: draft,
    placeholder,
    'aria-label': ariaLabel,
    onFocus: () => {
      setFocused(true);
      onFocus?.();
    },
    onBlur: commit,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(event.target.value),
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      event.stopPropagation();
      if (event.key === 'Enter' && (!multiline || !event.shiftKey)) {
        event.preventDefault();
        event.currentTarget.blur();
      }
      if (event.key === 'Escape') {
        setDraft(value);
        event.currentTarget.blur();
      }
    },
  };

  if (multiline) {
    return (
      <textarea
        rows={1}
        {...shared}
        ref={(element) => {
          node.current = element;
        }}
      />
    );
  }
  return (
    <input
      type="text"
      {...shared}
      ref={(element) => {
        node.current = element;
      }}
    />
  );
}

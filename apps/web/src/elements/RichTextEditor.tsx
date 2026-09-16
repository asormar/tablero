/**
 * Editor de texto enriquecido de una tarjeta (TipTap sobre Yjs).
 *
 * - El historial de ProseMirror (`history` de StarterKit) está desactivado: el
 *   deshacer del texto lo lleva `yUndoPlugin`, que viene con la extensión de
 *   colaboración de TipTap (respaldada por y-prosemirror).
 * - El documento es el `Y.XmlFragment` del campo `text` del elemento, así que lo
 *   que se escribe viaja por Yjs igual que el resto de cambios.
 */

import Collaboration from '@tiptap/extension-collaboration';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type * as Y from 'yjs';

export type RichTextEditorProps = {
  fragment: Y.XmlFragment;
  placeholder: string;
  /** Clases extra para el contenido (tamaño de encabezado, por ejemplo). */
  contentClassName?: string;
  /** Se llama cuando el editor pierde el foco hacia fuera. */
  onBlur?(): void;
};

export function RichTextEditor({ fragment, placeholder, contentClassName, onBlur }: RichTextEditorProps) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // El historial propio de ProseMirror queda desactivado: manda yUndoPlugin.
          history: false,
        }),
        Placeholder.configure({ placeholder }),
        // La extensión de colaboración de TipTap monta ySyncPlugin y yUndoPlugin
        // de y-prosemirror sobre este fragmento: el texto vive en Yjs y el
        // deshacer del texto lo lleva su propio gestor.
        Collaboration.configure({ fragment }),
      ],
      autofocus: 'end',
      editorProps: {
        attributes: {
          class: ['rt-content', contentClassName ?? ''].filter(Boolean).join(' '),
          spellcheck: 'false',
        },
      },
    },
    [fragment],
  );

  if (!editor) return null;

  return (
    <div
      className="rt-editor"
      data-editing="true"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && event.currentTarget.contains(next)) return;
        onBlur?.();
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}

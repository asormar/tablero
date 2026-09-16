/**
 * Editor de la página de documento.
 *
 * Mismo texto enriquecido que la nota (StarterKit sobre el `Y.XmlFragment` del
 * elemento, con `y-prosemirror` llevando el deshacer) más lo que necesita un
 * documento largo: imágenes (que se suben soltándolas o pegándolas), tablas y
 * separadores.
 *
 * Va en su propio módulo para que las extensiones de tabla e imagen **no**
 * entren en el paquete de arranque del lienzo: se carga solo al abrir un
 * documento.
 */

import Collaboration from '@tiptap/extension-collaboration';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import type * as Y from 'yjs';

import { assetRoutes } from '@tablero/shared';

import { assetApiPath, uploadAsset } from '@/api/assets';
import { useAppStore } from '@/state/appStore';

export type DocumentEditorProps = {
  fragment: Y.XmlFragment;
  placeholder: string;
  /** Se llama con el editor montado (para la barra: tabla, separador, imagen). */
  onReady?(editor: Editor | null): void;
};

/** Sube un archivo y devuelve la URL con la que insertarlo en el documento. */
async function uploadToDocument(file: File): Promise<string | null> {
  const boardId = useAppStore.getState().currentBoardId;
  try {
    const asset = await uploadAsset(file, {
      boardId: boardId && !boardId.startsWith('bd_') ? boardId : null,
    });
    return assetApiPath(asset.url);
  } catch {
    useAppStore.getState().setNotice('No se pudo subir la imagen del documento.');
    return null;
  }
}

export function DocumentEditor({ fragment, placeholder, onReady }: DocumentEditorProps) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ history: false }),
        Placeholder.configure({ placeholder }),
        Collaboration.configure({ fragment }),
        Image.configure({ inline: false, allowBase64: false }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
      ],
      autofocus: 'start',
      editorProps: {
        attributes: {
          class: 'doc-page__content rt-content',
          spellcheck: 'false',
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
            file.type.startsWith('image/'),
          );
          if (files.length === 0) return false;
          event.preventDefault();
          void (async () => {
            for (const file of files) {
              const url = await uploadToDocument(file);
              if (!url) continue;
              const node = view.state.schema.nodes['image']?.create({ src: url, alt: file.name });
              if (!node) continue;
              view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
            }
          })();
          return true;
        },
        handlePaste: (view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
            file.type.startsWith('image/'),
          );
          if (files.length === 0) return false;
          event.preventDefault();
          void (async () => {
            for (const file of files) {
              const url = await uploadToDocument(file);
              if (!url) continue;
              const node = view.state.schema.nodes['image']?.create({ src: url, alt: file.name });
              if (!node) continue;
              view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
            }
          })();
          return true;
        },
      },
    },
    [fragment],
  );

  useEffect(() => {
    onReady?.(editor ?? null);
    return () => onReady?.(null);
  }, [editor, onReady]);

  if (!editor) return null;
  return <EditorContent editor={editor} />;
}

/** URL pública de una imagen del documento (para la exportación y el índice). */
export function imageUrlFor(assetId: string): string {
  return assetApiPath(assetRoutes.raw(assetId));
}

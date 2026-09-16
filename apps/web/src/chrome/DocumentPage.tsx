/**
 * Documento a página completa.
 *
 * Modal amplio con el editor de página (mismo formato que la nota + imágenes,
 * tablas y separadores) y el índice automático que sale de los encabezados.
 * Cerrar es `Esc` o el botón; el texto ya está guardado (cada cambio va al
 * documento Yjs), así que no hay nada que confirmar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Image as ImageIcon, ListTree, Minus, Table as TableIcon, X } from 'lucide-react';

import type { Editor } from '@tiptap/core';
import { Suspense, lazy } from 'react';

import { assetApiPath, uploadAsset } from '@/api/assets';
import type { BoardSession } from '@/collab/BoardSession';
import { useSessionElement, useSessionText } from '@/collab/SessionContext';
import { outlineOf, wordCountOf } from '@/lib/docOutline';
import { pickFiles } from '@/lib/filePicker';
import { useAppStore } from '@/state/appStore';
import { useUiStore } from '@/state/uiStore';

const LazyDocumentEditor = lazy(async () => {
  const module = await import('@/elements/DocumentEditor');
  return { default: module.DocumentEditor };
});

function DocumentPageInner({ session, documentId }: { session: BoardSession; documentId: string }): JSX.Element | null {
  const element = useSessionElement(documentId);
  const blocks = useSessionText(documentId);
  const [editor, setEditor] = useState<Editor | null>(null);
  const page = useRef<HTMLDivElement | null>(null);
  const outline = useMemo(() => outlineOf(blocks), [blocks]);
  const words = useMemo(() => wordCountOf(blocks), [blocks]);

  const close = useCallback(() => useUiStore.getState().closeDocument(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const fragment = session.getTextFragment(documentId);

  const scrollToHeading = (index: number): void => {
    const container = page.current;
    if (!container) return;
    const nodes = container.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3');
    nodes[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const insertImage = async (): Promise<void> => {
    if (!editor) return;
    const files = await pickFiles('image', false);
    const file = files[0];
    if (!file) return;
    const boardId = useAppStore.getState().currentBoardId;
    try {
      const asset = await uploadAsset(file, {
        boardId: boardId && !boardId.startsWith('bd_') ? boardId : null,
      });
      editor.chain().focus().setImage({ src: assetApiPath(asset.url), alt: file.name }).run();
    } catch {
      useAppStore.getState().setNotice('No se pudo subir la imagen del documento.');
    }
  };

  if (!element || !fragment) {
    return (
      <div className="doc-page" role="dialog" aria-modal="true" aria-label="Documento">
        <div className="doc-page__panel">
          <p className="doc-page__empty">El documento no está disponible.</p>
          <button type="button" className="auth__submit" onClick={close}>
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="doc-page" role="dialog" aria-modal="true" aria-label="Documento a página completa">
      <div className="doc-page__panel">
        <header className="doc-page__bar">
          <span className="doc-page__brand">
            <ListTree size={14} />
            <span>Documento</span>
          </span>
          <div className="doc-page__tools">
            <button
              type="button"
              className="icon-button"
              title="Insertar tabla"
              disabled={!editor}
              onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            >
              <TableIcon size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Insertar separador"
              disabled={!editor}
              onClick={() => editor?.chain().focus().setHorizontalRule().run()}
            >
              <Minus size={15} />
            </button>
            <button type="button" className="icon-button" title="Insertar imagen" onClick={() => void insertImage()}>
              <ImageIcon size={15} />
            </button>
          </div>
          <span className="doc-page__words">{words === 1 ? '1 palabra' : `${words} palabras`}</span>
          <button type="button" className="icon-button" title="Cerrar (Esc)" onClick={close}>
            <X size={15} />
          </button>
        </header>

        <div className="doc-page__body">
          <div className="doc-page__sheet" ref={page} onPointerDown={(event) => event.stopPropagation()}>
            <Suspense fallback={<div className="doc-page__loading">Cargando el editor…</div>}>
              <LazyDocumentEditor
                fragment={fragment}
                placeholder="Escribe el documento… usa «## » para un encabezado"
                onReady={setEditor}
              />
            </Suspense>
          </div>

          <aside className="doc-page__outline" aria-label="Índice">
            <h2 className="doc-page__outline-title">Índice</h2>
            {outline.length === 0 ? (
              <p className="doc-page__outline-empty">
                Los encabezados del documento aparecen acá para saltar entre secciones.
              </p>
            ) : (
              <ol className="doc-page__outline-list">
                {outline.map((entry, index) => (
                  <li key={`${entry.index}-${entry.text}`} className={`doc-page__outline-item doc-page__outline-item--h${entry.level}`}>
                    <button type="button" onClick={() => scrollToHeading(index)} title={entry.text}>
                      {entry.text}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

export function DocumentPage({ session }: { session: BoardSession }): JSX.Element | null {
  const documentId = useUiStore((state) => state.documentId);
  if (!documentId) return null;
  return <DocumentPageInner session={session} documentId={documentId} />;
}

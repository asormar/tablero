/**
 * Tarjeta de documento: vista de tarjeta con título y extracto.
 *
 * El documento no se edita en el lienzo: la tarjeta muestra lo suficiente para
 * reconocerlo (título, extracto y número de palabras) y se abre a página
 * completa con el botón o con doble clic.
 */

import { Expand, FileText } from 'lucide-react';
import { useMemo } from 'react';

import type { CanvasElement } from '@tablero/shared';

import type { BoardSession } from '@/collab/BoardSession';
import { useSessionText } from '@/collab/SessionContext';
import { previewOf } from '@/lib/docOutline';
import { useUiStore } from '@/state/uiStore';

export type DocumentCardProps = {
  session: BoardSession;
  element: CanvasElement;
  simplified: boolean;
};

export function DocumentCard({ session, element, simplified }: DocumentCardProps): JSX.Element {
  const blocks = useSessionText(element.id);
  const preview = useMemo(() => previewOf(blocks), [blocks]);
  const open = (): void => useUiStore.getState().openDocument(element.id);

  if (simplified) {
    return <div className="el-simplified" title={preview.title}>{preview.title || 'Documento'}</div>;
  }

  return (
    <div className="doc-card">
      <header className="doc-card__head">
        <FileText size={12} />
        <span className="doc-card__badge">Documento</span>
        <span className="doc-card__words">
          {preview.wordCount === 1 ? '1 palabra' : `${preview.wordCount} palabras`}
        </span>
        <button
          type="button"
          className="icon-button icon-button--small"
          title="Abrir a página completa"
          data-interactive
          onPointerDown={(event) => event.stopPropagation()}
          onClick={open}
        >
          {/* `Expand`: abrir la tarjeta en grande (la vista se «encaja» con `Maximize2`). */}
          <Expand size={12} />
        </button>
      </header>
      <h3 className="doc-card__title">{preview.title || 'Documento sin título'}</h3>
      <p className="doc-card__excerpt">
        {preview.excerpt || 'Doble clic para escribir el documento completo.'}
      </p>
    </div>
  );
}

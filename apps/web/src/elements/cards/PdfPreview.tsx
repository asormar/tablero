/**
 * Miniatura de la primera página de un PDF y visor paginado dentro de la
 * tarjeta de archivo (canvas del cliente, sin pasar por el servidor).
 */

import { useEffect, useRef, useState } from 'react';

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

import { loadPdfDocument, renderPdfPage } from '@/lib/pdf';

export type PdfCanvasProps = {
  url: string;
  width: number;
  /** Página a mostrar (1-based). */
  page?: number;
  className?: string;
  onPageCount?(count: number): void;
};

/** Pinta una página concreta de un PDF en un canvas del tamaño pedido. */
export function PdfCanvas({ url, width, page = 1, className, onPageCount }: PdfCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    void (async () => {
      const document = await loadPdfDocument(url);
      if (cancelled) return;
      if (!document) {
        setState('error');
        return;
      }
      onPageCount?.(document.numPages);
      try {
        await renderPdfPage(document, Math.min(Math.max(1, page), document.numPages), canvas, {
          maxWidth: width,
        });
        if (!cancelled) setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, width, page, onPageCount]);

  return (
    <div className={['pdf-canvas', className].filter(Boolean).join(' ')} data-state={state}>
      <canvas ref={canvasRef} />
      {state !== 'ready' ? (
        <span className="pdf-canvas__status">
          {state === 'loading' ? <Loader2 size={14} className="spin" /> : 'No se pudo leer el PDF'}
        </span>
      ) : null}
    </div>
  );
}

export type PdfPageViewerProps = {
  url: string;
  width: number;
  /** Alto máximo del área visible (mundo, sin escalar). */
  maxHeight?: number;
};

/** Visor paginado: página anterior/siguiente sobre el mismo canvas. */
export function PdfPageViewer({ url, width, maxHeight = 380 }: PdfPageViewerProps): JSX.Element {
  const [page, setPage] = useState(1);
  const [count, setCount] = useState<number | null>(null);
  const safeWidth = Math.max(80, Math.round(width));

  return (
    <div className="pdf-viewer">
      <PdfCanvas url={url} width={safeWidth} page={page} onPageCount={setCount} />
      <div className="pdf-viewer__bar">
        <button
          type="button"
          className="icon-button"
          title="Página anterior"
          disabled={page <= 1}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="pdf-viewer__counter">
          {page}
          {count ? ` / ${count}` : ''}
        </span>
        <button
          type="button"
          className="icon-button"
          title="Página siguiente"
          disabled={count !== null && page >= count}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setPage((current) => current + 1)}
        >
          <ChevronRight size={14} />
        </button>
        <span className="pdf-viewer__hint">máx. {Math.round(maxHeight)} px</span>
      </div>
    </div>
  );
}

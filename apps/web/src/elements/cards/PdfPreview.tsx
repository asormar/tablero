/**
 * Miniatura de la primera página de un PDF y visor paginado dentro de la
 * tarjeta de archivo (canvas del cliente, sin pasar por el servidor).
 *
 * El documento de pdfjs se retiene solo mientras el canvas está montado. El
 * visor paginado vive en la tarjeta (`PdfPageViewerPanel`): acá está el canvas
 * que los dos comparten, sin duplicar lógica.
 */

import { useEffect, useRef, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { loadPdfDocument, releasePdfDocument, retainPdfDocument, renderPdfPage } from '@/lib/pdf';

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

  // Retención por URL: al desmontar el último visor de esa URL, el documento se
  // olvida (`forgetPdfDocument`) y no queda memoria de PDFs que ya no se ven.
  useEffect(() => {
    if (url.length === 0) return undefined;
    retainPdfDocument(url);
    return () => releasePdfDocument(url);
  }, [url]);

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


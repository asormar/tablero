/**
 * PDF en el cliente: el servidor no procesa PDF a propósito, así que la
 * miniatura de la primera página y el visor paginado se dibujan aquí con
 * `pdfjs-dist` sobre un `<canvas>`.
 *
 * La librería se carga bajo demanda (con su worker aparte) para no engordar el
 * arranque del lienzo: solo pesa cuando hay un PDF a la vista.
 */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [module, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      module.GlobalWorkerOptions.workerSrc = worker.default;
      return module;
    })();
  }
  return pdfjsPromise;
}

const documents = new Map<string, Promise<PDFDocumentProxy | null>>();
const tasks = new Map<string, { destroy(): Promise<void> }>();

/** Documento ya abierto, o `null` si el archivo no es un PDF legible. */
export function loadPdfDocument(url: string): Promise<PDFDocumentProxy | null> {
  const existing = documents.get(url);
  if (existing) return existing;
  const job = (async (): Promise<PDFDocumentProxy | null> => {
    try {
      const pdfjs = await loadPdfjs();
      const task = pdfjs.getDocument({ url, withCredentials: true });
      tasks.set(url, task as unknown as { destroy(): Promise<void> });
      return await task.promise;
    } catch {
      documents.delete(url);
      tasks.delete(url);
      return null;
    }
  })();
  documents.set(url, job);
  return job;
}

export type RenderPageOptions = {
  /** Ancho en píxeles CSS que debe ocupar la página. */
  maxWidth: number;
  /** Factor de densidad de pantalla (2 en pantallas retina). */
  scaleFactor?: number;
};

/**
 * Dibuja una página en el canvas. Devuelve el alto en píxeles CSS que ocupa,
 * para que la tarjeta pueda reservar el espacio antes de pintar.
 */
export async function renderPdfPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  options: RenderPageOptions,
): Promise<number> {
  const page: PDFPageProxy = await document.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(0.05, options.maxWidth / base.width);
  const density = options.scaleFactor ?? Math.min(2, window.devicePixelRatio || 1);
  const viewport = page.getViewport({ scale: scale * density });
  const context = canvas.getContext('2d');
  if (!context) return Math.round(base.height * scale);

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = `${Math.round(base.width * scale)}px`;
  canvas.style.height = `${Math.round(base.height * scale)}px`;

  await page.render({ canvasContext: context, canvas, viewport }).promise;
  page.cleanup();
  return Math.round(base.height * scale);
}

export function forgetPdfDocument(url: string): void {
  const task = tasks.get(url);
  tasks.delete(url);
  documents.delete(url);
  void task?.destroy().catch(() => undefined);
}

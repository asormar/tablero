/**
 * Exportación por la API (punto 3 de la fase 4):
 *
 *   POST /api/boards/:id/export?format=markdown|text|json|zip
 *   GET  /api/export/account          (ZIP de toda la cuenta)
 *
 * La respuesta es un archivo (no JSON), así que no pasa por `apiRequest`: se
 * baja con `fetch` y se guarda como blob. Si la API contesta JSON (error), se
 * levanta un `ApiError` con el mensaje del servidor.
 */

import { API_BASE_URL, ApiError } from '@/api/client';

export type ServerExportFormat = 'markdown' | 'text' | 'json' | 'zip';

function extractFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // se usa el de reserva
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1] ?? fallback;
}

async function download(
  path: string,
  fallbackName: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<{ filename: string; bytes: number }> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method, credentials: 'include' });
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload?.error === 'string') message = payload.error;
    } catch {
      // sin cuerpo JSON: se queda el mensaje genérico
    }
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const filename = extractFilename(response, fallbackName);
  saveBlob(blob, filename);
  return { filename, bytes: blob.size };
}

/** Guarda un blob como descarga (nunca navega ni reemplaza la pestaña). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Se libera después: si no, Safari cancela la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportBoard(
  boardId: string,
  format: ServerExportFormat,
  fallbackName: string,
  includeAssets = true,
): Promise<{ filename: string; bytes: number }> {
  const query = `?format=${encodeURIComponent(format)}&includeAssets=${includeAssets ? 'true' : 'false'}`;
  // El contrato del API es `POST /api/boards/:id/export` (ver la cabecera del
  // módulo): armarlo con GET daba 404 y el botón de exportar no hacía nada.
  return download(`/boards/${encodeURIComponent(boardId)}/export${query}`, fallbackName, 'POST');
}

export async function exportAccount(fallbackName: string): Promise<{ filename: string; bytes: number }> {
  return download('/export/account', fallbackName);
}

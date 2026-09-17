/**
 * Captura rápida por la API (fase 4, punto 7 del API): `POST /api/capture`.
 *
 * El endpoint acepta dos credenciales: el token personal (atajos del sistema) o
 * la cookie de sesión (esta app). Si todavía no existe, el llamante cae al
 * camino del cliente (`unsortedNote.ts`), que escribe en el documento del
 * tablero «Sin ordenar» con la misma técnica que mover tarjetas entre tableros.
 */

import { apiRequest } from '@/api/client';

export type CaptureResult = { boardId: string; elementId: string | null; boardCreated: boolean };

export async function captureNote(text: string): Promise<CaptureResult> {
  const payload = await apiRequest<unknown>('/capture', {
    method: 'POST',
    body: { type: 'note', text },
    timeoutMs: 12_000,
  });
  const record = (payload ?? {}) as Record<string, unknown>;
  const boardId =
    typeof record['boardId'] === 'string'
      ? record['boardId']
      : typeof (record['note'] as Record<string, unknown> | undefined)?.['boardId'] === 'string'
        ? ((record['note'] as Record<string, unknown>)['boardId'] as string)
        : '';
  const elementId =
    typeof record['elementId'] === 'string'
      ? record['elementId']
      : typeof (record['note'] as Record<string, unknown> | undefined)?.['id'] === 'string'
        ? ((record['note'] as Record<string, unknown>)['id'] as string)
        : null;
  return { boardId, elementId, boardCreated: record['boardCreated'] === true };
}

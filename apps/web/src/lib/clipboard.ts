/**
 * Portapapeles.
 *
 * Se mantiene un portapapeles interno (el del propio Tablero, con la carga
 * completa de elementos) y se escribe además texto plano en el portapapeles del
 * sistema. El interno es el que garantiza que pegar funcione aunque el
 * navegador bloquee el acceso al del sistema.
 */

import type { ClipboardPayload } from '@tablero/shared';

export type InternalClipboard = {
  payload: ClipboardPayload;
  /** Texto plano representativo, para pegados externos y depuración. */
  plainText: string;
  capturedAt: number;
};

let internal: InternalClipboard | null = null;

export function setInternalClipboard(payload: ClipboardPayload, plainText: string): void {
  internal = { payload, plainText, capturedAt: Date.now() };
}

export function getInternalClipboard(): InternalClipboard | null {
  return internal;
}

/** Escribe texto en el portapapeles del sistema. Nunca lanza. */
export async function writeSystemText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Lee el portapapeles del sistema. Devuelve `null` si el navegador lo bloquea. */
export async function readSystemText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    const text = await navigator.clipboard.readText();
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

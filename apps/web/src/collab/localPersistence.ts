/**
 * Persistencia local del documento (modo sin conexión).
 *
 * Guarda el estado Yjs completo en `localStorage`, con escritura diferida, para
 * que recargar la página no pierda nada aunque no haya servidor de
 * colaboración. Al abrir el tablero se carga antes de conectar: unir el estado
 * local con el del servidor es seguro porque la unión de CRDTs es conmutativa.
 */

import * as Y from 'yjs';

const PREFIX = 'tablero:doc:v1:';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function key(boardId: string): string {
  return `${PREFIX}${boardId}`;
}

export function loadLocalDocument(boardId: string): Uint8Array | null {
  try {
    const raw = localStorage.getItem(key(boardId));
    if (!raw) return null;
    return base64ToBytes(raw);
  } catch {
    return null;
  }
}

export function saveLocalDocument(boardId: string, doc: Y.Doc): void {
  try {
    const update = Y.encodeStateAsUpdate(doc);
    localStorage.setItem(key(boardId), bytesToBase64(update));
  } catch {
    // Cuota llena o almacenamiento bloqueado: el modo local sigue funcionando
    // en memoria, solo se pierde la persistencia entre recargas.
  }
}

export function clearLocalDocument(boardId: string): void {
  try {
    localStorage.removeItem(key(boardId));
  } catch {
    // sin almacenamiento disponible
  }
}

/**
 * Fusiona el documento guardado de un tablero en otro id.
 *
 * Se usa al adoptar en el servidor un tablero creado sin conexión: el contenido
 * aislado en el navegador pasa al id definitivo y, desde ahí, sube al servidor
 * en la primera sincronización. La fusión es una unión de CRDTs, así que no
 * pisa lo que ya hubiera en el destino.
 */
export function mergeLocalDocuments(fromBoardId: string, toBoardId: string): boolean {
  const from = loadLocalDocument(fromBoardId);
  if (!from) return false;
  const doc = new Y.Doc();
  try {
    const existing = loadLocalDocument(toBoardId);
    if (existing) Y.applyUpdate(doc, existing);
    Y.applyUpdate(doc, from);
    localStorage.setItem(key(toBoardId), bytesToBase64(Y.encodeStateAsUpdate(doc)));
    return true;
  } catch {
    return false;
  } finally {
    doc.destroy();
  }
}

/**
 * Guarda el documento con un retardo tras cada cambio (una escritura cada
 * 800 ms como mucho). Devuelve la función para dejar de observar.
 */
export function startLocalPersistence(boardId: string, doc: Y.Doc, delayMs = 800): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    saveLocalDocument(boardId, doc);
  };
  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(flush, delayMs);
  };
  doc.on('update', schedule);
  const onHide = () => {
    if (timer !== null) {
      clearTimeout(timer);
      flush();
    }
  };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', onHide);
  saveLocalDocument(boardId, doc);

  return () => {
    doc.off('update', schedule);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('beforeunload', onHide);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      flush();
    }
  };
}

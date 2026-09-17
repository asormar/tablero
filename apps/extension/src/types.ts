/**
 * Tipos compartidos entre el popup, el service worker y el content script.
 *
 * El content script se compila como script clásico (Chrome no acepta módulos
 * ahí), así que solo puede importar tipos: nunca valores.
 */

/** Ajustes que viven en `chrome.storage.local`. */
export type Settings = {
  /** Raíz del API, con o sin `/api` al final (p. ej. `http://localhost:8787`). */
  apiBaseUrl: string;
  /** Token personal de captura (`X-Capture-Token`). Cadena vacía si no hay. */
  captureToken: string;
};

/** Datos que el content script extrae de la página. */
export type PageData = {
  title: string;
  url: string;
  selection: string;
};

/** Cuerpo de `POST /api/capture` tal como lo manda la extensión. */
export type CapturePayload = {
  type: 'note' | 'image';
  text: string;
  /** Presente solo cuando se pide la captura de la parte visible. */
  imageDataUrl?: string;
};

export type CaptureFailureKind = 'unreachable' | 'invalid_token' | 'missing_token' | 'api_error';

export type CaptureOutcome =
  | { ok: true; boardId: string; boardTitle: string; elementId: string | null; live: boolean }
  | { ok: false; kind: CaptureFailureKind; error: string; status?: number; code?: string };

export type ConnectionOutcome =
  | { ok: true; message: string }
  | { ok: false; kind: CaptureFailureKind; error: string; status?: number; code?: string };

/** Mensajes popup → service worker. */
export type PopupRequest =
  | { type: 'capture'; payload: CapturePayload }
  | { type: 'probe-connection' };

/** Mensajes popup → content script. */
export type ContentRequest = { type: 'page-data' };

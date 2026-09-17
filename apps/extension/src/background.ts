/**
 * Service worker (MV3): único punto que habla con el API.
 *
 * El popup le manda mensajes (`capture`, `probe-connection`) y devuelve el
 * resultado tal cual. Hacer la red acá tiene dos ventajas: la petición no se
 * corta si el popup se cierra, y la lógica del API queda en un solo lugar.
 */

import { probeConnection, sendCapture } from './api.js';
import { ensureSettings } from './settings.js';
import type { CaptureOutcome, CapturePayload, ConnectionOutcome, PopupRequest } from './types.js';

function isPopupRequest(message: unknown): PopupRequest | null {
  if (typeof message !== 'object' || message === null) return null;
  const type = (message as { type?: unknown }).type;
  if (type === 'probe-connection') return { type: 'probe-connection' };
  if (type === 'capture') {
    const payload = (message as { payload?: unknown }).payload;
    if (typeof payload !== 'object' || payload === null) return null;
    const candidate = payload as { type?: unknown; text?: unknown; imageDataUrl?: unknown };
    if (candidate.type !== 'note' && candidate.type !== 'image') return null;
    if (typeof candidate.text !== 'string') return null;
    const request: PopupRequest = { type: 'capture', payload: { type: candidate.type, text: candidate.text } };
    if (typeof candidate.imageDataUrl === 'string' && candidate.imageDataUrl.length > 0) {
      (request as { payload: CapturePayload }).payload.imageDataUrl = candidate.imageDataUrl;
    }
    return request;
  }
  return null;
}

async function handleCapture(payload: CapturePayload): Promise<CaptureOutcome> {
  const settings = await ensureSettings();
  return sendCapture(settings, payload);
}

async function handleProbe(): Promise<ConnectionOutcome> {
  const settings = await ensureSettings();
  return probeConnection(settings);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = isPopupRequest(message);
  if (!request) return undefined;

  const respond = (promise: Promise<CaptureOutcome | ConnectionOutcome>): true => {
    void promise.then(sendResponse, (error: unknown) => {
      sendResponse({ ok: false, kind: 'api_error', error: `Error inesperado en el service worker: ${String(error)}` });
    });
    return true; // el canal queda abierto para responder más tarde
  };

  if (request.type === 'capture') return respond(handleCapture(request.payload));
  return respond(handleProbe());
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});

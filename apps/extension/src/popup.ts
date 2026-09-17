/**
 * Popup: lee la pestaña activa (título, URL y selección), deja ajustar el token
 * y la URL base, y manda la captura a «Sin ordenar» a través del service worker.
 *
 * Nada de red acá: el popup solo junta datos y muestra el resultado **real** del
 * API (éxito o el error con su código) en la línea de estado.
 */

import { composeCaptureText } from './api.js';
import {
  MIN_TOKEN_LENGTH,
  clearCaptureToken,
  ensureSettings,
  loadSettings,
  normalizeApiBaseUrl,
  saveSettings,
} from './settings.js';
import type {
  CaptureOutcome,
  CapturePayload,
  ConnectionOutcome,
  ContentRequest,
  PageData,
  PopupRequest,
  Settings,
} from './types.js';

/**
 * Páginas donde no se puede inyectar nada: se captura a mano (título y URL de
 * la pestaña) y se avisa que no hay selección.
 */
const RESTRICTED_PREFIXES = [
  'chrome://',
  'edge://',
  'about:',
  'devtools://',
  'chrome-extension://',
  'view-source:',
  'file://',
  'https://chrome.google.com/webstore',
  'https://chromewebstore.google.com',
];

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Falta #${id} en popup.html`);
  return found as T;
}

const els = {
  target: element<HTMLParagraphElement>('target'),
  title: element<HTMLInputElement>('title'),
  url: element<HTMLInputElement>('url'),
  selection: element<HTMLTextAreaElement>('selection'),
  withImage: element<HTMLInputElement>('with-image'),
  capture: element<HTMLButtonElement>('capture'),
  captureStatus: element<HTMLParagraphElement>('capture-status'),
  settings: element<HTMLDetailsElement>('settings'),
  apiBase: element<HTMLInputElement>('api-base'),
  token: element<HTMLInputElement>('token'),
  tokenState: element<HTMLParagraphElement>('token-state'),
  save: element<HTMLButtonElement>('save-settings'),
  clearToken: element<HTMLButtonElement>('clear-token'),
  test: element<HTMLButtonElement>('test-connection'),
  settingsStatus: element<HTMLParagraphElement>('settings-status'),
};

let busy = false;

type StatusState = 'ok' | 'warn' | 'error' | 'busy' | '';

function setStatus(node: HTMLElement, state: StatusState, text: string): void {
  node.dataset['state'] = state;
  node.textContent = text;
}

function setBusy(value: boolean): void {
  busy = value;
  els.capture.disabled = value;
  els.test.disabled = value;
  els.save.disabled = value;
  els.clearToken.disabled = value;
}

function describeError(outcome: { error: string; code?: string; status?: number }): string {
  const details: string[] = [];
  if (outcome.code !== undefined && outcome.code.length > 0) details.push(outcome.code);
  if (typeof outcome.status === 'number') details.push(`HTTP ${outcome.status}`);
  return details.length > 0 ? `${outcome.error} (${details.join(', ')})` : outcome.error;
}

function truncate(value: string, max = 90): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function isPageData(value: unknown): value is PageData {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['title'] === 'string' &&
    typeof record['url'] === 'string' &&
    typeof record['selection'] === 'string'
  );
}

function isRestrictedUrl(url: string | undefined): boolean {
  if (typeof url !== 'string' || url.length === 0) return true;
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

// --- Pestaña activa y datos de la página -------------------------------------

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  return tab !== undefined && typeof tab.id === 'number' ? tab : null;
}

async function askContentScript(tabId: number): Promise<PageData | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'page-data' } satisfies ContentRequest);
    return isPageData(response) ? response : null;
  } catch {
    // Sin receptor: la página se abrió antes de instalar/actualizar la extensión.
    return null;
  }
}

/** Datos de la página; si el content script no está, se inyecta y se reintenta. */
async function readPageData(tabId: number): Promise<PageData | null> {
  const direct = await askContentScript(tabId);
  if (direct) return direct;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    return null; // página restringida (chrome://, PDF, web store…)
  }
  return askContentScript(tabId);
}

async function captureVisiblePart(tab: chrome.tabs.Tab | null): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab?.windowId, { format: 'png' });
    return dataUrl.length > 0
      ? { ok: true, dataUrl }
      : { ok: false, error: 'la captura volvió vacía' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// --- Mensajes al service worker ----------------------------------------------

function toCaptureOutcome(value: unknown): CaptureOutcome {
  if (typeof value === 'object' && value !== null && 'ok' in value) return value as CaptureOutcome;
  return { ok: false, kind: 'api_error', error: `El service worker devolvió algo inesperado: ${JSON.stringify(value)}` };
}

function toConnectionOutcome(value: unknown): ConnectionOutcome {
  if (typeof value === 'object' && value !== null && 'ok' in value) return value as ConnectionOutcome;
  return { ok: false, kind: 'api_error', error: `El service worker devolvió algo inesperado: ${JSON.stringify(value)}` };
}

async function sendCaptureMessage(payload: CapturePayload): Promise<CaptureOutcome> {
  try {
    return toCaptureOutcome(await chrome.runtime.sendMessage({ type: 'capture', payload } satisfies PopupRequest));
  } catch (error) {
    return {
      ok: false,
      kind: 'api_error',
      error: `No se pudo hablar con el service worker (${error instanceof Error ? error.message : String(error)}): recargá la extensión en chrome://extensions`,
    };
  }
}

async function sendProbeMessage(): Promise<ConnectionOutcome> {
  try {
    return toConnectionOutcome(await chrome.runtime.sendMessage({ type: 'probe-connection' } satisfies PopupRequest));
  } catch (error) {
    return {
      ok: false,
      kind: 'api_error',
      error: `No se pudo hablar con el service worker (${error instanceof Error ? error.message : String(error)}): recargá la extensión en chrome://extensions`,
    };
  }
}

// --- Captura -----------------------------------------------------------------

function captureSummary(outcome: Extract<CaptureOutcome, { ok: true }>): string {
  const board = outcome.boardTitle.length > 0 ? outcome.boardTitle : 'Sin ordenar';
  const element = outcome.elementId ?? '—';
  return `Nota creada en «${board}». tablero: ${outcome.boardId || '—'} · elemento: ${element} · en vivo: ${outcome.live ? 'sí' : 'no'}`;
}

function showCaptureSuccess(outcome: Extract<CaptureOutcome, { ok: true }>): void {
  setStatus(els.captureStatus, 'ok', captureSummary(outcome));
}

async function runCapture(): Promise<void> {
  if (busy) return;

  const page: PageData = {
    title: els.title.value,
    url: els.url.value,
    selection: els.selection.value,
  };
  const text = composeCaptureText(page);
  if (text.length === 0) {
    setStatus(els.captureStatus, 'error', 'No hay nada para capturar: completá el título, la URL o la selección.');
    return;
  }

  const settings = await loadSettings();
  if (settings.captureToken.length === 0) {
    els.settings.open = true;
    setStatus(els.captureStatus, 'error', 'Falta el token personal: pegalo en Ajustes y guardá.');
    return;
  }

  setBusy(true);
  setStatus(els.captureStatus, 'busy', 'Enviando la captura…');
  try {
    if (!els.withImage.checked) {
      const outcome = await sendCaptureMessage({ type: 'note', text });
      if (outcome.ok) showCaptureSuccess(outcome);
      else setStatus(els.captureStatus, 'error', describeError(outcome));
      return;
    }

    const tab = await activeTab();
    const shot = await captureVisiblePart(tab);
    if (!shot.ok) {
      setStatus(els.captureStatus, 'error', `No se pudo capturar la parte visible: ${shot.error}`);
      return;
    }

    const withImage = await sendCaptureMessage({ type: 'image', text, imageDataUrl: shot.dataUrl });
    if (withImage.ok) {
      showCaptureSuccess(withImage);
      return;
    }
    if (withImage.code === 'capture_unsupported_type') {
      // El contrato de captura todavía no acepta imágenes: se guarda la nota
      // igual y se muestra el error del API tal cual (sin tocarlo).
      const note = await sendCaptureMessage({ type: 'note', text });
      if (note.ok) {
        setStatus(els.captureStatus, 'warn', `${captureSummary(note)} · la imagen no se pudo adjuntar: ${describeError(withImage)}`);
      } else {
        setStatus(els.captureStatus, 'error', `La imagen no se pudo adjuntar (${describeError(withImage)}) y la nota tampoco entró: ${describeError(note)}`);
      }
      return;
    }
    setStatus(els.captureStatus, 'error', describeError(withImage));
  } finally {
    setBusy(false);
  }
}

// --- Ajustes -----------------------------------------------------------------

function updateTokenState(settings: Settings): void {
  const token = settings.captureToken;
  els.tokenState.textContent =
    token.length === 0
      ? 'Sin token guardado. Se copia desde la web de Tablero (GET /api/settings).'
      : `Token guardado en chrome.storage.local (${token.slice(0, 6)}…${token.slice(-4)}).`;
}

async function persistSettings(): Promise<Settings | null> {
  const base = normalizeApiBaseUrl(els.apiBase.value);
  if (base.length === 0) {
    setStatus(els.settingsStatus, 'error', 'URL base inválida: tiene que empezar con http:// o https:// (por ejemplo http://localhost:8787).');
    return null;
  }
  const token = els.token.value.trim();
  if (token.length > 0 && token.length < MIN_TOKEN_LENGTH) {
    setStatus(els.settingsStatus, 'error', `El token parece incompleto (${token.length} caracteres).`);
    return null;
  }
  const saved = await saveSettings({ apiBaseUrl: base, captureToken: token });
  els.apiBase.value = saved.apiBaseUrl;
  els.token.value = saved.captureToken;
  updateTokenState(saved);
  return saved;
}

async function runProbe(): Promise<void> {
  if (busy) return;
  const saved = await persistSettings();
  if (!saved) return;

  setBusy(true);
  setStatus(els.settingsStatus, 'busy', 'Probando conexión…');
  try {
    const outcome = await sendProbeMessage();
    if (outcome.ok) {
      setStatus(els.settingsStatus, 'ok', `Conexión correcta: ${outcome.message}`);
      return;
    }
    if (outcome.kind === 'unreachable') {
      setStatus(els.settingsStatus, 'error', `API inalcanzable: ${describeError(outcome)}`);
      return;
    }
    if (outcome.kind === 'invalid_token') {
      setStatus(els.settingsStatus, 'error', `Token inválido: el API responde, pero rechaza el token. ${describeError(outcome)}`);
      return;
    }
    if (outcome.kind === 'missing_token') {
      setStatus(els.settingsStatus, 'error', `Falta el token personal. ${describeError(outcome)}`);
      return;
    }
    setStatus(els.settingsStatus, 'error', `Error del API: ${describeError(outcome)}`);
  } finally {
    setBusy(false);
  }
}

// --- Arranque ----------------------------------------------------------------

async function init(): Promise<void> {
  const settings = await ensureSettings();
  els.apiBase.value = settings.apiBaseUrl;
  els.token.value = settings.captureToken;
  updateTokenState(settings);
  if (settings.captureToken.length === 0) els.settings.open = true;

  const tab = await activeTab();
  if (!tab) {
    els.capture.disabled = true;
    setStatus(els.captureStatus, 'error', 'No hay una pestaña activa para capturar.');
    return;
  }

  if (isRestrictedUrl(tab.url)) {
    els.target.textContent = `Pestaña activa: ${truncate(tab.title ?? tab.url ?? '')}`;
    els.title.value = tab.title ?? '';
    els.url.value = tab.url ?? '';
    els.withImage.disabled = true;
    setStatus(els.captureStatus, 'warn', 'Esta página es interna del navegador: se puede capturar el título y la URL, pero no la selección ni la imagen.');
    return;
  }

  const data = await readPageData(tab.id as number);
  els.target.textContent = `Pestaña activa: ${truncate(tab.title ?? tab.url ?? '')}`;
  els.title.value = data?.title ?? tab.title ?? '';
  els.url.value = data?.url ?? tab.url ?? '';
  els.selection.value = data?.selection ?? '';
  if (!data) {
    els.withImage.disabled = true;
    setStatus(els.captureStatus, 'warn', 'No se pudo leer la página (¿es un PDF o una vista interna?): completá los campos a mano.');
  }
}

els.capture.addEventListener('click', () => {
  void runCapture();
});

els.save.addEventListener('click', () => {
  void (async () => {
    const saved = await persistSettings();
    if (!saved) return;
    setStatus(els.settingsStatus, 'ok', 'Ajustes guardados en chrome.storage.local.');
  })();
});

els.clearToken.addEventListener('click', () => {
  void (async () => {
    const saved = await clearCaptureToken();
    els.token.value = '';
    updateTokenState(saved);
    setStatus(els.settingsStatus, 'ok', 'Token borrado de chrome.storage.local.');
  })();
});

els.test.addEventListener('click', () => {
  void runProbe();
});

void init();

/**
 * Ajustes de la extensión en `chrome.storage.local` (el token se pega a mano,
 * no hay OAuth ni login: el endpoint de captura está pensado para esto).
 */

import type { Settings } from './types.js';

export const SETTINGS_KEY = 'tableroCaptureSettings';

/** Misma API que usa la web de desarrollo. */
export const DEFAULT_API_BASE_URL = 'http://localhost:8787';

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  captureToken: '',
};

/** Largo mínimo razonable de un token (los del API son de 43 caracteres). */
export const MIN_TOKEN_LENGTH = 10;

/**
 * Normaliza la URL base: sin espacios, sin barra final y solo http/https.
 * Devuelve cadena vacía si no es una URL utilizable.
 */
export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}`;
  } catch {
    return '';
  }
}

function readSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const record = raw as Record<string, unknown>;
  const apiBaseUrl = typeof record['apiBaseUrl'] === 'string' ? record['apiBaseUrl'] : DEFAULT_SETTINGS.apiBaseUrl;
  const captureToken = typeof record['captureToken'] === 'string' ? record['captureToken'] : DEFAULT_SETTINGS.captureToken;
  return {
    apiBaseUrl: apiBaseUrl.length > 0 ? apiBaseUrl : DEFAULT_SETTINGS.apiBaseUrl,
    captureToken: captureToken.trim(),
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return readSettings(stored[SETTINGS_KEY]);
}

/** Escribe los ajustes por defecto si todavía no hay nada guardado. */
export async function ensureSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (stored[SETTINGS_KEY] === undefined) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS } });
    return { ...DEFAULT_SETTINGS };
  }
  return readSettings(stored[SETTINGS_KEY]);
}

/** Guarda un cambio parcial y devuelve el estado completo resultante. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next: Settings = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Borra el token guardado (los demás ajustes quedan como están). */
export async function clearCaptureToken(): Promise<Settings> {
  return saveSettings({ captureToken: '' });
}

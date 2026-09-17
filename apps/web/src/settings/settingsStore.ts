/**
 * Ajustes de la aplicación (punto 5 y 11 de la fase 4).
 *
 * El estado vive en Zustand y se persiste en `localStorage` con la clave
 * `tablero:settings:v1` (el mismo formato JSON de siempre). Si la API expone
 * `GET/PATCH /api/settings` se sincroniza con el servidor de forma optimista y
 * silenciosa: cuando todavía no está, los ajustes siguen funcionando en local.
 *
 * El tema se resuelve acá (claro/oscuro/sistema, con `matchMedia`) y se aplica
 * al `<html>` como `data-theme` — así el CSS solo necesita dos bloques de
 * variables y no hay parpadeo al arrancar (lo fija también un script inline en
 * `index.html`).
 */

import { create } from 'zustand';

import { type Language, setLanguage } from '@/i18n';

import { fetchRemoteSettings, patchRemoteSettings } from './api';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type CanvasBackground = 'plain' | 'dots' | 'grid';

export const SETTINGS_KEY = 'tablero:settings:v1';

export type AppSettings = {
  theme: ThemePreference;
  language: Language;
  canvasBackground: CanvasBackground;
  showGuides: boolean;
  snapToGrid: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'es',
  canvasBackground: 'dots',
  showGuides: true,
  snapToGrid: true,
};

const THEMES: ThemePreference[] = ['light', 'dark', 'system'];
const BACKGROUNDS: CanvasBackground[] = ['plain', 'dots', 'grid'];

/** Normaliza lo que haya en el almacenamiento (o lo que devuelva la API). */
export function normalizeSettings(input: unknown, base: AppSettings = DEFAULT_SETTINGS): AppSettings {
  if (!input || typeof input !== 'object') return { ...base };
  const record = input as Record<string, unknown>;
  const next: AppSettings = { ...base };
  if (typeof record['theme'] === 'string' && (THEMES as string[]).includes(record['theme'])) {
    next.theme = record['theme'] as ThemePreference;
  }
  if (record['language'] === 'es' || record['language'] === 'en') next.language = record['language'];
  if (
    typeof record['canvasBackground'] === 'string' &&
    (BACKGROUNDS as string[]).includes(record['canvasBackground'])
  ) {
    next.canvasBackground = record['canvasBackground'] as CanvasBackground;
  }
  if (typeof record['showGuides'] === 'boolean') next.showGuides = record['showGuides'];
  if (typeof record['snapToGrid'] === 'boolean') next.snapToGrid = record['snapToGrid'];
  return next;
}

function readStoredSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark = systemPrefersDark()): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

/** Aplica el tema y el fondo al documento (idempotente). */
export function applySettingsToDocument(settings: AppSettings): ResolvedTheme {
  const resolved = resolveTheme(settings.theme);
  try {
    const root = document.documentElement;
    root.dataset['theme'] = resolved;
    root.dataset['themePref'] = settings.theme;
    root.dataset['canvasBg'] = settings.canvasBackground;
    root.style.colorScheme = resolved;
  } catch {
    // sin DOM (pruebas)
  }
  setLanguage(settings.language);
  return resolved;
}

type SettingsState = {
  settings: AppSettings;
  resolvedTheme: ResolvedTheme;
  /** El servidor no expone `/api/settings` (todavía). */
  remoteUnavailable: boolean;
  setTheme(theme: ThemePreference): void;
  setLanguage(language: Language): void;
  setCanvasBackground(background: CanvasBackground): void;
  setShowGuides(show: boolean): void;
  setSnapToGrid(snap: boolean): void;
  toggleTheme(): void;
  /** Fusiona ajustes remotos sin pisar cambios locales más nuevos. */
  mergeRemote(settings: Partial<AppSettings>): void;
  markRemoteUnavailable(): void;
};

const initial: AppSettings = readStoredSettings();

export const useSettingsStore = create<SettingsState>()((set, get) => {
  const persist = (next: AppSettings): AppSettings => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // sin almacenamiento: queda en memoria
    }
    return next;
  };

  const commit = (patch: Partial<AppSettings>, sync = true): void => {
    const next = persist({ ...get().settings, ...patch });
    const resolvedTheme = applySettingsToDocument(next);
    set({ settings: next, resolvedTheme });
    if (sync) void pushRemoteSettings(patch);
  };

  return {
    settings: initial,
    resolvedTheme: resolveTheme(initial.theme),
    remoteUnavailable: false,
    setTheme(theme) {
      commit({ theme });
    },
    setLanguage(language) {
      commit({ language });
    },
    setCanvasBackground(canvasBackground) {
      commit({ canvasBackground });
    },
    setShowGuides(showGuides) {
      commit({ showGuides });
    },
    setSnapToGrid(snapToGrid) {
      commit({ snapToGrid });
    },
    toggleTheme() {
      const current = get().resolvedTheme;
      commit({ theme: current === 'dark' ? 'light' : 'dark' });
    },
    mergeRemote(remote) {
      const next = persist(normalizeSettings(remote, get().settings));
      const resolvedTheme = applySettingsToDocument(next);
      set({ settings: next, resolvedTheme, remoteUnavailable: false });
    },
    markRemoteUnavailable() {
      if (get().remoteUnavailable) return;
      set({ remoteUnavailable: true });
    },
  };
});

/** Empuja un cambio a la API sin bloquear: si falla, el ajuste es local igual. */
async function pushRemoteSettings(patch: Partial<AppSettings>): Promise<void> {
  try {
    await patchRemoteSettings(patch);
    useSettingsStore.setState({ remoteUnavailable: false });
  } catch {
    useSettingsStore.getState().markRemoteUnavailable();
  }
}

/** Carga los ajustes del servidor y los fusiona (llamado en el arranque). */
export async function loadRemoteSettings(): Promise<void> {
  try {
    const remote = await fetchRemoteSettings();
    if (!remote) {
      useSettingsStore.getState().markRemoteUnavailable();
      return;
    }
    // El servidor manda solo si hay algo guardado; si viene vacío se conserva
    // lo local (el usuario pudo haber cambiado el tema sin conexión).
    const hasAny = Object.keys(remote).length > 0;
    if (hasAny) useSettingsStore.getState().mergeRemote(remote);
  } catch {
    useSettingsStore.getState().markRemoteUnavailable();
  }
}

/** Aplica los ajustes guardados antes de montar React (sin parpadeo). */
export function initSettings(): void {
  const current = useSettingsStore.getState().settings;
  const resolved = applySettingsToDocument(current);
  useSettingsStore.setState({ resolvedTheme: resolved });
  // El sistema puede cambiar (por ejemplo, al atardecer): se sigue en vivo.
  try {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', () => {
      const settings = useSettingsStore.getState().settings;
      if (settings.theme !== 'system') return;
      const next = resolveTheme('system');
      applySettingsToDocument(settings);
      useSettingsStore.setState({ resolvedTheme: next });
    });
  } catch {
    // navegador sin matchMedia
  }
  void loadRemoteSettings();
}

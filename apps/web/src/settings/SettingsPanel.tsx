/**
 * Ajustes (puntos 5 y 11 de la fase 4).
 *
 * Una página en modal con las cuatro secciones del plan: apariencia (tema
 * claro/oscuro/sistema e idioma es/en), lienzo (fondo liso/puntos/cuadrícula,
 * guías y ajuste a rejilla), almacenamiento (espacio usado, archivos huérfanos
 * con limpieza) y la lista de atajos.
 *
 * El tema y el idioma son locales y se empujan a `PATCH /api/settings` cuando el
 * endpoint existe; si todavía no está, los ajustes siguen funcionando en este
 * navegador y se avisa con una línea, sin bloquear nada.
 */

import { useCallback, useEffect, useState } from 'react';

import { HardDrive, Keyboard, Loader2, Moon, Monitor, Palette, Sun, Trash2, X } from 'lucide-react';

import { useT, LANGUAGES, type Language } from '@/i18n';
import { isDevBuild } from '@/lib/renderStats';
import { usePanelsStore } from '@/state/panelsStore';
import { useAppStore } from '@/state/appStore';
import { useFocusTrap } from '@/hooks/useFocusTrap';

import { type StorageReport, deleteOrphans, fetchStorage, formatBytes } from './api';
import { SHORTCUT_GROUPS, DEV_SHORTCUT_GROUP } from './shortcuts';
import { useSettingsStore } from './settingsStore';

export function SettingsPanel(): JSX.Element | null {
  const open = usePanelsStore((state) => state.settingsOpen);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const t = useT();
  const settings = useSettingsStore((state) => state.settings);
  const remoteUnavailable = useSettingsStore((state) => state.remoteUnavailable);
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const loadStorage = useCallback(async (signal?: AbortSignal) => {
    setStorageError(false);
    try {
      const report = await fetchStorage();
      if (signal?.aborted) return;
      setStorage(report);
    } catch {
      if (signal?.aborted) return;
      setStorage(null);
      setStorageError(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    void loadStorage(controller.signal);
    return () => controller.abort();
  }, [open, loadStorage]);

  if (!open) return null;

  const close = (): void => usePanelsStore.getState().setSettingsOpen(false);
  const groups = isDevBuild ? [...SHORTCUT_GROUPS, DEV_SHORTCUT_GROUP] : SHORTCUT_GROUPS;
  const themes: { value: 'light' | 'dark' | 'system'; label: string; icon: JSX.Element }[] = [
    { value: 'light', label: t('settings.themeLight'), icon: <Sun size={14} /> },
    { value: 'dark', label: t('settings.themeDark'), icon: <Moon size={14} /> },
    { value: 'system', label: t('settings.themeSystem'), icon: <Monitor size={14} /> },
  ];
  const backgrounds: { value: 'plain' | 'dots' | 'grid'; label: string }[] = [
    { value: 'plain', label: t('settings.bgPlain') },
    { value: 'dots', label: t('settings.bgDots') },
    { value: 'grid', label: t('settings.bgGrid') },
  ];

  const cleanOrphans = async (): Promise<void> => {
    if (cleaning) return;
    setCleaning(true);
    try {
      const deleted = await deleteOrphans();
      useAppStore.getState().setNotice(t('settings.orphansCleaned', { count: deleted }));
      await loadStorage();
    } catch {
      setStorageError(true);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('settings.title')}>
      <div className="modal__panel settings" ref={trapRef}>
        <div className="modal__head">
          <h2 className="modal__title">{t('settings.title')}</h2>
          <button type="button" className="icon-button" title={t('common.close')} onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div className="modal__body settings__body">
          <section className="settings__section" aria-label={t('settings.appearance')}>
            <h3 className="settings__heading">{t('settings.appearance')}</h3>

            <div className="settings__row">
              <span className="settings__label">{t('settings.theme')}</span>
              <div className="settings__segmented" role="radiogroup" aria-label={t('settings.theme')}>
                {themes.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={settings.theme === option.value}
                    data-theme-option={option.value}
                    className={`settings__segment${settings.theme === option.value ? ' is-active' : ''}`}
                    onClick={() => useSettingsStore.getState().setTheme(option.value)}
                  >
                    {option.icon}
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings__row">
              <span className="settings__label">{t('settings.language')}</span>
              <select
                className="settings__select"
                data-language-select
                value={settings.language}
                aria-label={t('settings.language')}
                onChange={(event) =>
                  useSettingsStore.getState().setLanguage(event.target.value as Language)
                }
              >
                {LANGUAGES.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="settings__section" aria-label={t('settings.canvas')}>
            <h3 className="settings__heading">{t('settings.canvas')}</h3>

            <div className="settings__row">
              <span className="settings__label">{t('settings.canvasBackground')}</span>
              <div className="settings__segmented" role="radiogroup" aria-label={t('settings.canvasBackground')}>
                {backgrounds.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={settings.canvasBackground === option.value}
                    data-bg-option={option.value}
                    className={`settings__segment${settings.canvasBackground === option.value ? ' is-active' : ''}`}
                    onClick={() => useSettingsStore.getState().setCanvasBackground(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="settings__check">
              <input
                type="checkbox"
                data-guides-toggle
                checked={settings.showGuides}
                onChange={(event) => useSettingsStore.getState().setShowGuides(event.target.checked)}
              />
              <span>{t('settings.guides')}</span>
            </label>

            <label className="settings__check">
              <input
                type="checkbox"
                data-snap-toggle
                checked={settings.snapToGrid}
                onChange={(event) => useSettingsStore.getState().setSnapToGrid(event.target.checked)}
              />
              <span>{t('settings.snap')}</span>
            </label>
          </section>

          <section className="settings__section" aria-label={t('settings.storage')}>
            <h3 className="settings__heading">
              <HardDrive size={14} aria-hidden="true" /> {t('settings.storage')}
            </h3>
            {storageError ? (
              <p className="settings__muted">{t('common.offline')}</p>
            ) : storage ? (
              <>
                <div className="settings__row">
                  <span className="settings__label">{t('settings.used')}</span>
                  <span className="settings__value" data-storage-used>
                    {formatBytes(storage.usedBytes)} · {t('settings.files', { count: storage.files })}
                  </span>
                </div>
                <div className="settings__row">
                  <span className="settings__label">{t('settings.orphans')}</span>
                  {storage.orphans.length === 0 ? (
                    <span className="settings__value">{t('settings.orphansNone')}</span>
                  ) : (
                    <span className="settings__value" data-storage-orphans>
                      {formatBytes(storage.orphans.reduce((total, orphan) => total + orphan.sizeBytes, 0))}
                    </span>
                  )}
                </div>
                {storage.orphans.length > 0 ? (
                  <button
                    type="button"
                    className="button settings__clean"
                    data-clean-orphans
                    disabled={cleaning}
                    onClick={() => void cleanOrphans()}
                  >
                    {cleaning ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                    {t('settings.orphansClean')}
                  </button>
                ) : null}
              </>
            ) : (
              <p className="settings__muted">
                <Loader2 size={13} className="spin" /> {t('common.loading')}
              </p>
            )}
          </section>

          <section className="settings__section" aria-label={t('settings.shortcuts')}>
            <h3 className="settings__heading">
              <Keyboard size={14} aria-hidden="true" /> {t('settings.shortcuts')}
            </h3>
            <p className="settings__muted">{t('settings.shortcutsHint')}</p>
            <div className="settings__shortcuts">
              {groups.map((group) => (
                <div key={group.titleKey} className="settings__shortcuts-group">
                  <h4 className="settings__shortcuts-title">{t(group.titleKey)}</h4>
                  <ul className="shortcuts__list">
                    {group.items.map((item) => (
                      <li key={`${group.titleKey}-${item.keys}`} className="shortcuts__item">
                        <kbd className="shortcuts__keys">{item.keys}</kbd>
                        <span className="shortcuts__label">{t(item.labelKey)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {remoteUnavailable ? (
            <p className="settings__muted settings__remote">
              <Palette size={13} aria-hidden="true" /> {t('settings.unavailable')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

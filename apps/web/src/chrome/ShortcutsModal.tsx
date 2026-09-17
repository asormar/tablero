/**
 * Ayuda de atajos de teclado (modal con `?`).
 *
 * La lista es la misma que muestran los ajustes (`settings/shortcuts.ts`) y los
 * textos salen del diccionario de i18n: así la ayuda y la configuración no se
 * pueden desincronizar.
 */

import { useEffect } from 'react';

import { X } from 'lucide-react';

import { useT } from '@/i18n';
import { isDevBuild } from '@/lib/renderStats';
import { DEV_SHORTCUT_GROUP, SHORTCUT_GROUPS } from '@/settings/shortcuts';
import { useUiStore } from '@/state/uiStore';

export function ShortcutsModal(): JSX.Element | null {
  const open = useUiStore((state) => state.helpOpen);
  const t = useT();
  const close = (): void => useUiStore.getState().setHelpOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  if (!open) return null;
  const groups = isDevBuild ? [...SHORTCUT_GROUPS, DEV_SHORTCUT_GROUP] : SHORTCUT_GROUPS;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('shortcuts.title')} onClick={close}>
      <div className="modal__panel" onClick={(event) => event.stopPropagation()}>
        <header className="modal__head">
          <h2 className="modal__title">{t('shortcuts.title')}</h2>
          <button type="button" className="icon-button" title={t('common.close')} onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="modal__body">
          {groups.map((group) => (
            <section key={group.titleKey} className="shortcuts">
              <h3 className="shortcuts__title">{t(group.titleKey)}</h3>
              <ul className="shortcuts__list">
                {group.items.map((item) => (
                  <li key={`${group.titleKey}-${item.keys}`} className="shortcuts__item">
                    <kbd className="shortcuts__keys">{item.keys}</kbd>
                    <span className="shortcuts__label">{t(item.labelKey)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

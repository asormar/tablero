/**
 * Ayuda de atajos de teclado (modal con `?`).
 *
 * La lista es la misma que muestran los ajustes (`settings/shortcuts.ts`) y los
 * textos salen del diccionario de i18n: así la ayuda y la configuración no se
 * pueden desincronizar. Las teclas se adaptan a la plataforma (`⌘` en Mac).
 */

import { useT } from '@/i18n';
import { platformKeys } from '@/lib/platform';
import { isDevBuild } from '@/lib/renderStats';
import { DEV_SHORTCUT_GROUP, SHORTCUT_GROUPS } from '@/settings/shortcuts';
import { useUiStore } from '@/state/uiStore';

import { Modal } from './Modal';

export function ShortcutsModal(): JSX.Element | null {
  const open = useUiStore((state) => state.helpOpen);
  const t = useT();

  if (!open) return null;
  const groups = isDevBuild ? [...SHORTCUT_GROUPS, DEV_SHORTCUT_GROUP] : SHORTCUT_GROUPS;

  return (
    <Modal title={t('shortcuts.title')} onClose={() => useUiStore.getState().setHelpOpen(false)}>
      <div className="modal__body">
        {groups.map((group) => (
          <section key={group.titleKey} className="shortcuts">
            <h3 className="shortcuts__title">{t(group.titleKey)}</h3>
            <ul className="shortcuts__list">
              {group.items.map((item) => (
                <li key={`${group.titleKey}-${item.keys}`} className="shortcuts__item">
                  <kbd className="shortcuts__keys">{platformKeys(item.keys)}</kbd>
                  <span className="shortcuts__label">{t(item.labelKey)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}

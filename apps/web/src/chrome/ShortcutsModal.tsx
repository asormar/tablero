/** Ayuda de atajos de teclado (modal con `?`). */

import { useEffect } from 'react';

import { X } from 'lucide-react';

import { isDevBuild } from '@/lib/renderStats';
import { useUiStore } from '@/state/uiStore';

type Group = { title: string; items: { keys: string; label: string }[] };

const GROUPS: Group[] = [
  {
    title: 'Lienzo',
    items: [
      { keys: 'Rueda', label: 'Desplazar el lienzo' },
      { keys: 'Ctrl/Cmd + rueda', label: 'Zoom centrado en el cursor' },
      { keys: 'Espacio + arrastrar', label: 'Desplazar (también botón central)' },
      { keys: '+ / −', label: 'Acercar y alejar' },
      { keys: 'Ctrl/Cmd + 0', label: 'Zoom al 100 %' },
      { keys: 'Shift + 1', label: 'Ajustar a pantalla' },
    ],
  },
  {
    title: 'Selección',
    items: [
      { keys: 'Clic', label: 'Seleccionar una tarjeta' },
      { keys: 'Shift + clic', label: 'Sumar o quitar de la selección' },
      { keys: 'Arrastrar en vacío', label: 'Lazo de selección' },
      { keys: 'Ctrl/Cmd + A', label: 'Seleccionar todo' },
      { keys: 'Esc', label: 'Deseleccionar o salir de edición' },
      { keys: 'Flechas', label: 'Mover 1 px (10 px con Shift)' },
      { keys: 'Supr / Retroceso', label: 'Eliminar la selección' },
      { keys: 'Ctrl/Cmd + D', label: 'Duplicar' },
    ],
  },
  {
    title: 'Edición y contenido',
    items: [
      { keys: 'Doble clic', label: 'Editar una nota o crear una en vacío' },
      { keys: 'Doble clic en tablero', label: 'Abrir el tablero' },
      { keys: 'N', label: 'Nota nueva en el centro de la vista' },
      { keys: 'B', label: 'Tablero nuevo anidado' },
      { keys: 'Ctrl/Cmd + C / X / V', label: 'Copiar, cortar y pegar' },
      { keys: 'Ctrl/Cmd + Z', label: 'Deshacer (solo tus cambios)' },
      { keys: 'Ctrl/Cmd + Shift + Z', label: 'Rehacer' },
      { keys: 'clic derecho', label: 'Menú contextual' },
      { keys: '?', label: 'Esta ayuda' },
    ],
  },
];

const DEV_GROUP: Group = {
  title: 'Desarrollo',
  items: [
    { keys: 'Ctrl + Shift + Alt + N', label: 'Generar 300 notas de prueba' },
    { keys: '—', label: 'El contador de la esquina muestra renders por frame' },
  ],
};

export function ShortcutsModal(): JSX.Element | null {
  const open = useUiStore((state) => state.helpOpen);
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
  const groups = isDevBuild ? [...GROUPS, DEV_GROUP] : GROUPS;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Atajos de teclado" onClick={close}>
      <div className="modal__panel" onClick={(event) => event.stopPropagation()}>
        <header className="modal__head">
          <h2 className="modal__title">Atajos de teclado</h2>
          <button type="button" className="icon-button" title="Cerrar" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="modal__body">
          {groups.map((group) => (
            <section key={group.title} className="shortcuts">
              <h3 className="shortcuts__title">{group.title}</h3>
              <ul className="shortcuts__list">
                {group.items.map((item) => (
                  <li key={`${group.title}-${item.keys}`} className="shortcuts__item">
                    <kbd className="shortcuts__keys">{item.keys}</kbd>
                    <span className="shortcuts__label">{item.label}</span>
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

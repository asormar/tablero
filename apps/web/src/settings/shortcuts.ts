/**
 * Lista canónica de atajos (punto 5 de la fase 4: «lista de atajos, que también
 * abre `?`»). Los textos viven en el diccionario de i18n; acá va la estructura
 * para que la ayuda (`?`) y los ajustes muestren exactamente lo mismo.
 */

export type ShortcutItem = { keys: string; labelKey: string };
export type ShortcutGroup = { titleKey: string; items: ShortcutItem[] };

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'shortcuts.groupGeneral',
    items: [
      { keys: 'Ctrl/Cmd + K', labelKey: 'shortcut.palette' },
      { keys: 'Ctrl/Cmd + F', labelKey: 'shortcut.boardSearch' },
      { keys: 'Ctrl/Cmd + Shift + N', labelKey: 'shortcut.capture' },
      { keys: '?', labelKey: 'shortcut.help' },
      { keys: 'Esc', labelKey: 'shortcut.escape' },
    ],
  },
  {
    titleKey: 'shortcuts.groupCanvas',
    items: [
      { keys: 'Wheel', labelKey: 'shortcut.scrollCanvas' },
      { keys: 'Ctrl/Cmd + wheel', labelKey: 'shortcut.zoomCursor' },
      { keys: 'Space + drag', labelKey: 'shortcut.pan' },
      { keys: '+ / −', labelKey: 'shortcut.zoomSteps' },
      { keys: 'Ctrl/Cmd + 0', labelKey: 'shortcut.zoom100' },
      { keys: 'Shift + 1', labelKey: 'shortcut.fit' },
    ],
  },
  {
    titleKey: 'shortcuts.groupSelection',
    items: [
      { keys: 'Click', labelKey: 'shortcut.selectOne' },
      { keys: 'Shift + click', labelKey: 'shortcut.selectToggle' },
      { keys: 'Drag on empty', labelKey: 'shortcut.marquee' },
      { keys: 'Ctrl/Cmd + A', labelKey: 'shortcut.selectAll' },
      { keys: 'Arrows', labelKey: 'shortcut.nudge' },
      { keys: 'Del / Backspace', labelKey: 'shortcut.delete' },
      { keys: 'Ctrl/Cmd + D', labelKey: 'shortcut.duplicate' },
    ],
  },
  {
    titleKey: 'shortcuts.groupText',
    items: [
      { keys: 'Double click', labelKey: 'shortcut.edit' },
      { keys: 'N', labelKey: 'shortcut.newNote' },
      { keys: 'B', labelKey: 'shortcut.newBoard' },
      { keys: 'C', labelKey: 'shortcut.newColumn' },
      { keys: 'Ctrl/Cmd + C / X / V', labelKey: 'shortcut.clipboard' },
      { keys: 'Ctrl/Cmd + Z', labelKey: 'shortcut.undo' },
      { keys: 'Ctrl/Cmd + Shift + Z', labelKey: 'shortcut.redo' },
      { keys: 'Right click', labelKey: 'shortcut.contextMenu' },
    ],
  },
];

/** Grupo extra que solo se muestra en compilaciones de desarrollo. */
export const DEV_SHORTCUT_GROUP: ShortcutGroup = {
  titleKey: 'shortcuts.groupDev',
  items: [
    { keys: 'Ctrl + Shift + Alt + N', labelKey: 'shortcut.seedNotes' },
    { keys: '—', labelKey: 'shortcut.perfOverlay' },
  ],
};

/**
 * Plataforma y etiquetas de atajos.
 *
 * En macOS el modificador de los atajos es `⌘` (`Cmd`); en el resto, `Ctrl`.
 * Las etiquetas de tooltips y ayudas salen de acá para no incrustar «Ctrl K»
 * a mano: `shortcutLabel('K')` da «⌘K» en Mac y «Ctrl+K» en Windows y Linux.
 */

/** Lo mínimo del `navigator` que hace falta (permite probarlo sin DOM). */
export type NavigatorLike = {
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
};

/** ¿El navegador corre en macOS (o iPadOS en modo escritorio)? */
export function detectMac(nav?: NavigatorLike): boolean {
  const source = nav ?? (typeof navigator === 'undefined' ? undefined : (navigator as NavigatorLike));
  if (!source) return false;
  const platform = source.userAgentData?.platform || source.platform || '';
  if (platform.length > 0) return /mac|iphone|ipad|ipod/i.test(platform);
  return /mac os|iphone|ipad/i.test(source.userAgent ?? '');
}

let cachedMac: boolean | null = null;

/** Memoizado: la plataforma no cambia durante la sesión. */
export function isMac(): boolean {
  if (cachedMac === null) cachedMac = detectMac();
  return cachedMac;
}

/** Etiqueta del modificador principal: `⌘` en Mac y `Ctrl` en el resto. */
export function modKeyLabel(mac: boolean = isMac()): string {
  return mac ? '⌘' : 'Ctrl';
}

export type ShortcutModifiers = { shift?: boolean; alt?: boolean };

/**
 * Etiqueta de un atajo con el modificador principal: `shortcutLabel('Z', { shift: true })`
 * → «⌘⇧Z» en Mac y «Ctrl+Shift+Z» en el resto.
 */
export function shortcutLabel(key: string, modifiers: ShortcutModifiers = {}, mac: boolean = isMac()): string {
  if (mac) {
    // Orden de Apple: ⌥ ⇧ ⌘ y la tecla.
    return `${modifiers.alt ? '⌥' : ''}${modifiers.shift ? '⇧' : ''}⌘${key}`;
  }
  const parts = ['Ctrl'];
  if (modifiers.alt) parts.push('Alt');
  if (modifiers.shift) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/**
 * Adapta un texto de atajo escrito para PC («Ctrl/Cmd + Shift + Z») a la
 * plataforma: en Mac usa los símbolos `⌘ ⇧ ⌥`; en el resto deja `Ctrl`.
 */
export function platformKeys(keys: string, mac: boolean = isMac()): string {
  if (mac) {
    return keys
      .replace(/Ctrl\/Cmd|Cmd\/Ctrl|Ctrl|Cmd/g, '⌘')
      .replace(/Shift/g, '⇧')
      .replace(/Alt/g, '⌥');
  }
  return keys.replace(/Ctrl\/Cmd|Cmd\/Ctrl|Cmd/g, 'Ctrl');
}

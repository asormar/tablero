import { describe, expect, it } from 'vitest';

import { detectMac, modKeyLabel, platformKeys, shortcutLabel } from './platform';

describe('detectMac', () => {
  it('prefiere userAgentData.platform', () => {
    expect(detectMac({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe(true);
    expect(detectMac({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe(false);
  });

  it('cae a navigator.platform y, si falta, al userAgent', () => {
    expect(detectMac({ platform: 'MacIntel' })).toBe(true);
    expect(detectMac({ platform: 'Linux x86_64' })).toBe(false);
    expect(detectMac({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(true);
    expect(detectMac({})).toBe(false);
  });

  it('cuenta iPad como plataforma de Apple', () => {
    expect(detectMac({ platform: 'iPad' })).toBe(true);
  });
});

describe('etiquetas de atajos', () => {
  it('modKeyLabel', () => {
    expect(modKeyLabel(true)).toBe('⌘');
    expect(modKeyLabel(false)).toBe('Ctrl');
  });

  it('shortcutLabel en Mac y en PC', () => {
    expect(shortcutLabel('K', {}, true)).toBe('⌘K');
    expect(shortcutLabel('K', {}, false)).toBe('Ctrl+K');
    expect(shortcutLabel('Z', { shift: true }, true)).toBe('⇧⌘Z');
    expect(shortcutLabel('Z', { shift: true }, false)).toBe('Ctrl+Shift+Z');
    expect(shortcutLabel('N', { shift: true, alt: true }, false)).toBe('Ctrl+Alt+Shift+N');
  });

  it('platformKeys traduce el texto de ayuda', () => {
    expect(platformKeys('Ctrl/Cmd + Shift + Z', true)).toBe('⌘ + ⇧ + Z');
    expect(platformKeys('Ctrl/Cmd + Shift + Z', false)).toBe('Ctrl + Shift + Z');
    expect(platformKeys('Ctrl + Shift + Alt + N', true)).toBe('⌘ + ⇧ + ⌥ + N');
    expect(platformKeys('Esc', true)).toBe('Esc');
  });
});

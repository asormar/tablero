/**
 * `Esc` dentro de un aviso: solo cierra el aviso y no llega a los demás
 * manejadores de `window` (diálogos, paneles, lienzo).
 */

import { describe, expect, it, vi } from 'vitest';

import { installToastEscape, toastCardOf } from './toastEscape';

/** Raíz de eventos que además responde a `closest`, como un nodo del DOM. */
class FakeNode extends EventTarget {
  constructor(
    private readonly inToastStack: boolean,
    private readonly card: { querySelector(selector: string): unknown } | null,
  ) {
    super();
  }

  closest(selector: string): unknown {
    if (selector === '.toast-stack') return this.inToastStack ? {} : null;
    if (selector === '.toast') return this.card;
    return null;
  }
}

function press(root: EventTarget, key: string): Event {
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key, isComposing: false });
  root.dispatchEvent(event);
  return event;
}

describe('toastCardOf', () => {
  it('devuelve la tarjeta solo si el destino está en la pila de avisos', () => {
    const card = { querySelector: () => null };
    expect(toastCardOf(new FakeNode(true, card))).toBe(card);
    expect(toastCardOf(new FakeNode(false, card))).toBeNull();
    expect(toastCardOf({})).toBeNull();
    expect(toastCardOf(null)).toBeNull();
  });
});

describe('installToastEscape', () => {
  it('cierra el aviso con su botón y corta el evento antes que otros oyentes', () => {
    const click = vi.fn();
    const card = { querySelector: (selector: string) => (selector === '.toast__close' ? { click } : null) };
    const root = new FakeNode(true, card);
    const stop = installToastEscape(root);
    const downstream = vi.fn();
    root.addEventListener('keydown', downstream, true);
    const event = press(root, 'Escape');
    expect(click).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(downstream).not.toHaveBeenCalled();
    stop();
  });

  it('deja pasar Esc cuando el foco no está en un aviso', () => {
    const root = new FakeNode(false, null);
    const stop = installToastEscape(root);
    const downstream = vi.fn();
    root.addEventListener('keydown', downstream, true);
    const event = press(root, 'Escape');
    expect(downstream).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    stop();
  });

  it('ignora otras teclas y deja de actuar tras desinstalarse', () => {
    const click = vi.fn();
    const root = new FakeNode(true, { querySelector: () => ({ click }) });
    const stop = installToastEscape(root);
    press(root, 'Enter');
    expect(click).not.toHaveBeenCalled();
    stop();
    press(root, 'Escape');
    expect(click).not.toHaveBeenCalled();
  });
});

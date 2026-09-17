/**
 * Pruebas de la trampa de foco (fase 6, accesibilidad).
 *
 * La lógica se prueba sin DOM real: alcanza con objetos que respondan a
 * `querySelectorAll`, `getAttribute` y `getClientRects`, que es lo único que
 * usan las funciones.
 */

import { describe, expect, it } from 'vitest';

import {
  FOCUSABLE_SELECTOR,
  activeTrapIndex,
  focusablesWithin,
  initialFocusTarget,
  isHiddenCandidate,
  nextTrapIndex,
} from './focusTrap';

type FakeAttrs = Record<string, string | undefined>;

function fakeElement(attrs: FakeAttrs = {}): HTMLElement {
  const present = (name: string): boolean => attrs[name] !== undefined;
  return {
    getAttribute: (name: string) => (present(name) ? (attrs[name] as string) : null),
    hasAttribute: present,
    getClientRects: () => [{ width: 10, height: 10 }],
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
  } as unknown as HTMLElement;
}

function fakeRoot(elements: HTMLElement[]): ParentNode {
  return {
    querySelectorAll: () => elements,
    querySelector: () => null,
  } as unknown as ParentNode;
}

describe('nextTrapIndex', () => {
  it('avanza y da la vuelta al llegar al final', () => {
    expect(nextTrapIndex(3, 0)).toBe(1);
    expect(nextTrapIndex(3, 1)).toBe(2);
    expect(nextTrapIndex(3, 2)).toBe(0);
  });

  it('retrocede y salta al último desde el primero', () => {
    expect(nextTrapIndex(3, 0, true)).toBe(2);
    expect(nextTrapIndex(3, 2, true)).toBe(1);
  });

  it('sin foco dentro del contenedor entra por el principio (o el final con Shift)', () => {
    expect(nextTrapIndex(4, -1)).toBe(0);
    expect(nextTrapIndex(4, -1, true)).toBe(3);
  });

  it('sin elementos devuelve -1', () => {
    expect(nextTrapIndex(0, 0)).toBe(-1);
  });
});

describe('focusablesWithin', () => {
  it('descarta lo oculto y lo que tiene aria-hidden', () => {
    const visible = fakeElement();
    const hidden = fakeElement({ hidden: '' });
    const ariaHidden = fakeElement({ 'aria-hidden': 'true' });
    const typeHidden = fakeElement({ type: 'hidden' });
    const list = focusablesWithin(fakeRoot([visible, hidden, ariaHidden, typeHidden]));
    expect(list).toEqual([visible]);
  });

  it('aplica el predicado de visibilidad cuando se pasa', () => {
    const a = fakeElement();
    const b = fakeElement();
    const list = focusablesWithin(fakeRoot([a, b]), (element) => element === b);
    expect(list).toEqual([b]);
  });

  it('el selector cubre controles y tabindex, y excluye tabindex=-1', () => {
    expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])');
    expect(FOCUSABLE_SELECTOR).toContain('a[href]');
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
    expect(FOCUSABLE_SELECTOR).toContain('[contenteditable="true"]');
  });
});

describe('isHiddenCandidate', () => {
  it('trata como oculto lo marcado con hidden o aria-hidden', () => {
    expect(isHiddenCandidate(fakeElement({ hidden: '' }))).toBe(true);
    expect(isHiddenCandidate(fakeElement({ 'aria-hidden': 'true' }))).toBe(true);
    expect(isHiddenCandidate(fakeElement())).toBe(false);
  });
});

describe('initialFocusTarget', () => {
  it('prefiere el marcado con data-autofocus', () => {
    const first = fakeElement();
    const preferred = fakeElement({ 'data-autofocus': '' });
    const root = {
      querySelectorAll: () => [first, preferred],
      querySelector: (selector: string) => (selector === '[data-autofocus]' ? preferred : null),
    } as unknown as ParentNode;
    expect(initialFocusTarget(root)).toBe(preferred);
  });

  it('sin marcado usa el primer enfocable', () => {
    const first = fakeElement();
    expect(initialFocusTarget(fakeRoot([first]))).toBe(first);
  });

  it('sin enfocables devuelve null', () => {
    expect(initialFocusTarget(fakeRoot([]))).toBeNull();
  });
});

describe('activeTrapIndex', () => {
  it('devuelve el índice del elemento activo y -1 si no está en la lista', () => {
    const a = fakeElement();
    const b = fakeElement();
    expect(activeTrapIndex([a, b], b)).toBe(1);
    expect(activeTrapIndex([a, b], fakeElement())).toBe(-1);
    expect(activeTrapIndex([a, b], null)).toBe(-1);
  });
});

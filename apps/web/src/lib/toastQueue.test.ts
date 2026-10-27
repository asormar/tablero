import { describe, expect, it } from 'vitest';

import {
  MAX_VISIBLE_TOASTS,
  TOAST_DURATIONS,
  classifyNotice,
  existingToastId,
  pushToast,
  removeToast,
  toastDuration,
  type ToastItem,
} from './toastQueue';

function item(id: string, patch: Partial<ToastItem> = {}): ToastItem {
  return { id, kind: 'info', message: `mensaje ${id}`, duration: 4000, token: 1, ...patch };
}

describe('toastDuration', () => {
  it('usa 4 s para éxito e info y 8 s para errores', () => {
    expect(toastDuration('success')).toBe(4000);
    expect(toastDuration('info')).toBe(4000);
    expect(toastDuration('error')).toBe(8000);
    expect(TOAST_DURATIONS.error).toBeGreaterThan(TOAST_DURATIONS.success);
  });

  it('respeta una duración propia y deja fijo con null', () => {
    expect(toastDuration('info', 1500)).toBe(1500);
    expect(toastDuration('error', null)).toBeNull();
  });

  it('ignora duraciones inválidas', () => {
    expect(toastDuration('success', 0)).toBe(4000);
    expect(toastDuration('success', -5)).toBe(4000);
    expect(toastDuration('error', Number.NaN)).toBe(8000);
  });
});

describe('pushToast', () => {
  it('pone el más nuevo arriba', () => {
    const list = pushToast(pushToast([], item('a')), item('b'));
    expect(list.map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('muestra como máximo 3 y descarta el más antiguo', () => {
    let list: ToastItem[] = [];
    for (const id of ['a', 'b', 'c', 'd']) list = pushToast(list, item(id));
    expect(list).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(list.map((entry) => entry.id)).toEqual(['d', 'c', 'b']);
  });

  it('conserva los fijos mientras haya otro que descartar', () => {
    let list: ToastItem[] = [];
    list = pushToast(list, item('fijo', { duration: null }));
    for (const id of ['a', 'b', 'c']) list = pushToast(list, item(id));
    expect(list.map((entry) => entry.id)).toEqual(['c', 'b', 'fijo']);
  });

  it('si todos son fijos, descarta el más antiguo', () => {
    let list: ToastItem[] = [];
    for (const id of ['a', 'b', 'c', 'd']) list = pushToast(list, item(id, { duration: null }));
    expect(list.map((entry) => entry.id)).toEqual(['d', 'c', 'b']);
  });

  it('un id repetido reemplaza al anterior y sube a la cima', () => {
    let list = pushToast(pushToast([], item('a')), item('b'));
    list = pushToast(list, item('a', { message: 'nuevo', token: 2 }));
    expect(list.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(list[0]?.message).toBe('nuevo');
  });

  it('el mismo tipo y texto no se apila', () => {
    let list = pushToast([], item('a', { message: 'Guardado' }));
    list = pushToast(list, item('b', { message: 'Guardado', token: 2 }));
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('b');
  });

  it('el mismo texto con otro tipo sí convive', () => {
    let list = pushToast([], item('a', { message: 'Hola', kind: 'info' }));
    list = pushToast(list, item('b', { message: 'Hola', kind: 'error' }));
    expect(list).toHaveLength(2);
  });
});

describe('removeToast y existingToastId', () => {
  it('quita por id', () => {
    const list = pushToast(pushToast([], item('a')), item('b'));
    expect(removeToast(list, 'a').map((entry) => entry.id)).toEqual(['b']);
  });

  it('devuelve la misma lista si el id no está', () => {
    const list = pushToast([], item('a'));
    expect(removeToast(list, 'zzz')).toBe(list);
  });

  it('encuentra el id de un aviso repetido', () => {
    const list = pushToast([], item('a', { message: 'Hola', kind: 'success' }));
    expect(existingToastId(list, 'success', 'Hola')).toBe('a');
    expect(existingToastId(list, 'error', 'Hola')).toBeNull();
  });
});

describe('classifyNotice', () => {
  it('trata los fallos claros como error', () => {
    expect(classifyNotice('No se pudo cambiar el favorito.')).toBe('error');
    expect(classifyNotice('Invitar: la API no responde.')).toBe('error');
    expect(classifyNotice('Tu rol en este tablero (Lector) no permite editar.')).toBe('error');
    expect(classifyNotice('Mover entre tableros necesita conexión con el servidor.')).toBe('error');
    expect(classifyNotice('El navegador no dejó copiar al portapapeles.')).toBe('error');
  });

  it('el resto es info', () => {
    expect(classifyNotice('Nota guardada en «Sin ordenar».')).toBe('info');
    expect(classifyNotice('Se restauró 1 elemento.')).toBe('info');
    expect(classifyNotice('Sin resultados para esa búsqueda.')).toBe('info');
  });
});

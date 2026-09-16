/**
 * Medición de alturas.
 *
 * Un único `ResizeObserver` compartido para todas las tarjetas montadas (no uno
 * por tarjeta) que agrupa las mediciones en un frame y las publica de una sola
 * vez en el store: así el DOM no provoca una cascada de renders.
 */

import { useUiStore } from '@/state/uiStore';

let observer: ResizeObserver | null = null;
let frame = 0;
const pending = new Map<string, number>();

function heightOf(entry: ResizeObserverEntry): number {
  const box = entry.borderBoxSize as unknown;
  if (Array.isArray(box) && box.length > 0) {
    const first = box[0] as ResizeObserverSize | undefined;
    if (first && typeof first.blockSize === 'number' && first.blockSize > 0) return first.blockSize;
  } else if (box && typeof box === 'object') {
    const single = box as ResizeObserverSize;
    if (typeof single.blockSize === 'number' && single.blockSize > 0) return single.blockSize;
  }
  const target = entry.target as HTMLElement;
  // Reserva: `offsetHeight` ya incluye padding y borde (border-box).
  return target.offsetHeight;
}

function schedule(): void {
  if (frame !== 0) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (pending.size === 0) return;
    const entries = [...pending.entries()].map(([id, height]) => ({ id, height }));
    pending.clear();
    useUiStore.getState().reportHeights(entries);
  });
}

function ensureObserver(): ResizeObserver {
  if (observer) return observer;
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).dataset.elementId;
      if (!id) continue;
      pending.set(id, heightOf(entry));
    }
    schedule();
  });
  return observer;
}

export function observeHeight(node: HTMLElement): void {
  ensureObserver().observe(node);
}

export function unobserveHeight(node: HTMLElement): void {
  const id = node.dataset.elementId;
  if (id) pending.delete(id);
  observer?.unobserve(node);
}

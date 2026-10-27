/**
 * Lógica pura de la cola de avisos (toasts): tipos, duraciones, tope de avisos
 * visibles y clasificación de los textos heredados de `setNotice`.
 *
 * El estado vive en `lib/toast.ts`; acá no hay React ni DOM para poder probarlo.
 */

export type ToastKind = 'success' | 'error' | 'info';

export type ToastAction = {
  label: string;
  onClick(): void;
};

export type ToastOptions = {
  /** Id estable: un aviso nuevo con el mismo id reemplaza al anterior. */
  id?: string;
  /** Milisegundos hasta que se descarta solo; `null` lo deja fijo. */
  duration?: number | null;
  /** Botón de acción dentro del aviso (por ejemplo «Recargar»). */
  action?: ToastAction;
};

export type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
  /** `null` = no se descarta solo. */
  duration: number | null;
  action?: ToastAction;
  /** Cambia cada vez que el aviso se vuelve a emitir (reinicia el temporizador). */
  token: number;
};

/** Avisos visibles a la vez; el más nuevo va arriba. */
export const MAX_VISIBLE_TOASTS = 3;

/** Duración por defecto según el tipo: los errores se quedan más tiempo. */
export const TOAST_DURATIONS: Record<ToastKind, number> = {
  success: 4000,
  info: 4000,
  error: 8000,
};

/** Duración efectiva de un aviso (`null` = fijo). */
export function toastDuration(kind: ToastKind, duration?: number | null): number | null {
  if (duration === null) return null;
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) return duration;
  return TOAST_DURATIONS[kind];
}

/**
 * Añade un aviso a la cola (lista con el más nuevo primero).
 *
 * - Mismo `id`, o mismo tipo y mismo texto: se reemplaza el anterior (sube a la
 *   cima y reinicia el temporizador en vez de apilar duplicados).
 * - Pasado el tope se descarta el más antiguo que se cierre solo; los fijos
 *   (como el de «nueva versión») se conservan mientras haya otro que sacar.
 */
export function pushToast(list: readonly ToastItem[], item: ToastItem, max: number = MAX_VISIBLE_TOASTS): ToastItem[] {
  const rest = list.filter(
    (existing) => existing.id !== item.id && !(existing.kind === item.kind && existing.message === item.message),
  );
  const next = [item, ...rest];
  while (next.length > Math.max(1, max)) {
    let evict = -1;
    for (let index = next.length - 1; index >= 1; index -= 1) {
      if (next[index]!.duration !== null) {
        evict = index;
        break;
      }
    }
    next.splice(evict === -1 ? next.length - 1 : evict, 1);
  }
  return next;
}

/** Quita un aviso por id (si no está, devuelve la misma lista). */
export function removeToast(list: readonly ToastItem[], id: string): ToastItem[] {
  if (!list.some((item) => item.id === id)) return list as ToastItem[];
  return list.filter((item) => item.id !== id);
}

/** Id de un aviso que repite el contenido de otro ya visible (para reutilizarlo). */
export function existingToastId(list: readonly ToastItem[], kind: ToastKind, message: string): string | null {
  return list.find((item) => item.kind === kind && item.message === message)?.id ?? null;
}

// Sin `\b`: en JS no reconoce las letras acentuadas como parte de una palabra.
const ERROR_PATTERN =
  /(no se pudo|no se pudieron|no pudo|no se puede|no puedes|fall[óo]|error|no se movi[óo]|no tienes permiso|tu rol|necesita conexi[óo]n|no respondi[óo]|hay que iniciar sesi[óo]n|la api (todav[ií]a no|no responde)|el navegador no dej[óo]|sin conexi[óo]n con el servidor|couldn['’]t|could not|failed|unable)/i;

/**
 * Los avisos heredados llegan como un texto sin tipo (`setNotice`). Se tratan
 * como `info` salvo que el texto sea claramente un fallo.
 */
export function classifyNotice(message: string): ToastKind {
  return ERROR_PATTERN.test(message) ? 'error' : 'info';
}

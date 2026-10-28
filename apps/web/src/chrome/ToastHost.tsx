/**
 * Pila de avisos (toasts) y puente con el `setNotice` heredado.
 *
 * - Hasta 3 avisos visibles, el más nuevo arriba (la cola está en `lib/toastQueue`).
 * - Se descartan solos (éxito e info 4 s, error 8 s); el temporizador se pausa
 *   con el puntero encima o con el foco dentro, y los fijos no se cierran solos.
 * - `role="status"` (`alert` en los errores), botón de cerrar y `Esc` cuando el
 *   foco está dentro del aviso.
 * - Por encima de los diálogos (`--z-toast`): un error lanzado desde un modal
 *   se ve.
 *
 * Todo lo que llama a `useAppStore.setNotice(texto)` sigue funcionando: el texto
 * entra aquí como `info` (o `error` si es un fallo claro) y el store queda libre.
 */

import { useEffect, useRef, useState } from 'react';

import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

import { useT } from '@/i18n';
import { toast, useToastStore } from '@/lib/toast';
import { classifyNotice, createExitTimer, type ExitTimer, type ToastItem, type ToastKind } from '@/lib/toastQueue';
import { useAppStore } from '@/state/appStore';

/** Duración de la salida: coincide con `toast-out` en la hoja de estilos. */
const EXIT_MS = 150;

const ICONS: Record<ToastKind, JSX.Element> = {
  success: <CheckCircle2 size={16} aria-hidden="true" />,
  error: <TriangleAlert size={16} aria-hidden="true" />,
  info: <Info size={16} aria-hidden="true" />,
};

/** Reenvía los avisos de `setNotice` a la cola de toasts y vacía el store. */
function useNoticeBridge(): void {
  useEffect(() => {
    const forward = (notice: string | null): void => {
      if (!notice) return;
      toast[classifyNotice(notice)](notice);
      useAppStore.getState().setNotice(null);
    };
    // Un aviso que ya estaba puesto antes de montar la pila (arranque, recarga).
    forward(useAppStore.getState().notice);
    return useAppStore.subscribe((state, previous) => {
      if (state.notice !== previous.notice) forward(state.notice);
    });
  }, []);
}

export function ToastHost(): JSX.Element {
  useNoticeBridge();
  const t = useT();
  const toasts = useToastStore((state) => state.toasts);

  return (
    <section className="toast-stack" aria-label={t('toast.region')}>
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </section>
  );
}

function ToastCard({ item }: { item: ToastItem }): JSX.Element {
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const remaining = useRef<number>(item.duration ?? 0);
  const startedAt = useRef(0);
  const exitTimer = useRef<ExitTimer | null>(null);
  const lastToken = useRef(item.token);
  const idRef = useRef(item.id);
  idRef.current = item.id;

  const dismiss = (): void => {
    exitTimer.current ??= createExitTimer(EXIT_MS, () => toast.dismiss(idRef.current));
    if (exitTimer.current.start()) setLeaving(true);
  };

  // Un aviso que se vuelve a emitir (mismo id) recupera su tiempo completo y,
  // si estaba saliendo, se queda: la salida pendiente se cancela.
  useEffect(() => {
    remaining.current = item.duration ?? 0;
    if (lastToken.current === item.token) return;
    lastToken.current = item.token;
    exitTimer.current?.cancel();
    setLeaving(false);
  }, [item.token, item.duration]);

  // Cuenta atrás con pausa: al pausar se guarda lo que falta y al seguir se
  // retoma desde ahí.
  useEffect(() => {
    if (item.duration === null || paused || leaving) return undefined;
    startedAt.current = Date.now();
    const timer = setTimeout(dismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
    // `dismiss` solo depende del id, que no cambia durante la vida de la tarjeta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.token, item.duration, paused, leaving]);

  useEffect(
    () => () => {
      exitTimer.current?.cancel();
    },
    [],
  );

  const isError = item.kind === 'error';

  return (
    <div
      className={`toast toast--${item.kind}${leaving ? ' is-leaving' : ''}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      data-toast-kind={item.kind}
      // Solo el ratón pausa: en táctil `mouseleave` puede no llegar nunca y el
      // aviso se quedaría fijo.
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        dismiss();
      }}
    >
      <span className="toast__icon">{ICONS[item.kind]}</span>
      <span className="toast__text">{item.message}</span>
      {item.action ? (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            item.action?.onClick();
            dismiss();
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button type="button" className="toast__close" title={t('toast.close')} aria-label={t('toast.close')} onClick={dismiss}>
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

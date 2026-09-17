/**
 * Acceso a la sesión del tablero desde React.
 *
 * Todas las suscripciones pasan por `useSyncExternalStore`:
 * - una tarjeta se suscribe solo a su `Y.Map` (y a su texto),
 * - la capa visible se suscribe al layout,
 * - el indicador de sincronización, al estado de conexión.
 */

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react';

import type { CanvasElement, Connector } from '@tablero/shared';

import type { TextBlock } from '@/lib/textBlocks';
import type { ElementLayout } from '@/lib/layout';

import type { BoardSession, SessionStatus } from './BoardSession';

const SessionContext = createContext<BoardSession | null>(null);

export function SessionProvider({ session, children }: { session: BoardSession; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): BoardSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession() requiere <SessionProvider>');
  return session;
}

/** Datos de un elemento: solo se re-renderiza cuando cambia ese elemento. */
export function useSessionElement(id: string): CanvasElement | null {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribeElement(id, onStoreChange),
    [session, id],
  );
  const getSnapshot = useCallback(() => session.getElement(id), [session, id]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Texto normalizado del elemento (vista previa de la tarjeta). */
export function useSessionText(id: string): TextBlock[] {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribeElement(id, onStoreChange),
    [session, id],
  );
  const getSnapshot = useCallback(() => session.getTextBlocks(id), [session, id]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Layout completo en orden de apilado. */
export function useSessionLayout(): ElementLayout[] {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribeLayout(onStoreChange),
    [session],
  );
  const getSnapshot = useCallback(() => session.getLayout(), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Conectores del documento (flechas y líneas). */
export function useSessionConnectors(): Connector[] {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribeConnectors(onStoreChange),
    [session],
  );
  const getSnapshot = useCallback(() => session.getConnectors(), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useSessionStatus(): SessionStatus {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribeStatus(onStoreChange),
    [session],
  );
  const getSnapshot = useCallback(() => session.getStatus(), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useCanUndo(): boolean {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribeUndo(onStoreChange),
    [session],
  );
  const getSnapshot = useCallback(() => session.canUndo(), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useCanRedo(): boolean {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribeUndo(onStoreChange),
    [session],
  );
  const getSnapshot = useCallback(() => session.canRedo(), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Elementos en la papelera del documento (cambia al borrar, restaurar o purgar). */
export function useTrashedElements(): CanvasElement[] {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribeTrash(onStoreChange),
    [session],
  );
  const getSnapshot = useCallback(() => session.getTrashed(), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Todos los elementos del documento (con los hijos de columnas), en orden de
 * apilado. Se usa para la búsqueda del tablero y la vista de lista.
 */
export function useSessionElements(): CanvasElement[] {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const stopLayout = session.subscribeLayout(onStoreChange);
      const stopContent = session.subscribeContent(onStoreChange);
      return () => {
        stopLayout();
        stopContent();
      };
    },
    [session],
  );
  const getSnapshot = useCallback(() => session.getAllElements(), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const EMPTY_LAYOUT: ElementLayout[] = [];

/**
 * Layout de una sesión que no vive en el contexto (la bandeja «Sin ordenar» de
 * la fase 3 abre la suya propia). Con `null` devuelve una lista vacía estable.
 */
export function useExternalSessionLayout(session: BoardSession | null): ElementLayout[] {
  const subscribe = useCallback(
    (onStoreChange: () => void) => (session ? session.subscribeLayout(onStoreChange) : () => undefined),
    [session],
  );
  const getSnapshot = useCallback(() => (session ? session.getLayout() : EMPTY_LAYOUT), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

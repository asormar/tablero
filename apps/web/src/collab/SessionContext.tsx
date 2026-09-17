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
  useMemo,
  useSyncExternalStore,
} from 'react';

import { type CanvasElement, type Connector, type EffectiveRole } from '@tablero/shared';

import { elementCommentCount, type CommentEntry } from '@/collab/comments';
import type { RemotePresence } from '@/collab/presence';
import { type Capability, can as canCapability } from '@/collab/roles';
import type { TextBlock } from '@/lib/textBlocks';
import type { ElementLayout } from '@/lib/layout';

import type { BoardSession, PermissionSnapshot, SessionStatus } from './BoardSession';

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

// --- Colaboración (fase 5) --------------------------------------------------

/** Foto del permiso: rol, solo lectura y motivo del rechazo del socket. */
export function useSessionPermission(): PermissionSnapshot {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribePermission(onStoreChange),
    [session],
  );
  const getSnapshot = useCallback(() => session.getPermission(), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Rol efectivo en el tablero (`null` si todavía se desconoce). */
export function useSessionRole(): EffectiveRole | null {
  return useSessionPermission().role;
}

/** ¿El rol habilita esta capacidad? */
export function useCan(capability: Capability): boolean {
  const session = useSession();
  const permission = useSessionPermission();
  // El permiso entra como dependencia para recalcular al cambiar de rol.
  return useMemo(
    () => canCapability(permission.role, capability),
    [permission.role, capability, session],
  );
}

/** Presencias ajenas: cursores, selección y quién está mirando. */
export function useRemotePresence(): RemotePresence[] {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribePresence(onStoreChange),
    [session],
  );
  const getSnapshot = useCallback(() => session.getPresence(), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Comentarios del documento (llegan por el mismo canal que el contenido). */
export function useSessionComments(): CommentEntry[] {
  const session = useSession();
  const subscribe = useCallback(
    (onStoreChange: () => void) => session.subscribeComments(onStoreChange),
    [session],
  );
  const getSnapshot = useCallback(() => session.getComments(), [session]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Comentarios abiertos de una tarjeta (contador del icono). */
export function useElementCommentCount(elementId: string): number {
  const comments = useSessionComments();
  return useMemo(() => elementCommentCount(comments, elementId), [comments, elementId]);
}

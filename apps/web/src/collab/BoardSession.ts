/**
 * Sesión de un tablero: documento Yjs + proveedor de colaboración + deshacer.
 *
 * Decisiones de la fase 1:
 * - Un `Y.Doc` por tablero, con el nombre del documento = id del tablero.
 * - `Y.UndoManager` limitado a `localOrigin`: deshacer solo toca lo que hizo
 *   este usuario, nunca lo que llegó de otros clientes.
 * - Suscripciones por elemento para que mover una tarjeta no re-renderice las
 *   demás: la capa visible se suscribe al layout y cada tarjeta a su propio
 *   `Y.Map` (más el `Y.XmlFragment` de su texto).
 * - Si el servidor no responde, la sesión sigue funcionando en local y el
 *   estado se publica como `offline`; el documento se persiste en localStorage.
 * - Restaurar una versión reescribe el documento en el servidor y cierra las
 *   conexiones del tablero (4205): el cliente descarta su copia local y
 *   reconstruye desde el remoto. Fusionar reviviría lo restaurado, porque la
 *   unión de CRDTs solo agrega.
 */

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import {
  type CanvasElement,
  type Connector,
  type ConnectorStore,
  type EffectiveRole,
  type ElementMap,
  type Point,
  type Rect,
  type Size,
  connectorsOf,
  createBoardDoc,
  createUndoManager,
  elementsOf,
  ensureTextFragment,
  getOrderedElements,
  getTrashedElements,
  localOrigin,
  orderOf,
  readElement,
} from '@tablero/shared';

import { fetchBoardDocument } from '@/api/boards';
import { pingApi } from '@/api/client';
import { readConnector } from '@/lib/connectors';
import { type ElementLayout, targetRects, topLevelLayoutOf } from '@/lib/layout';
import { type TextBlock, textBlocksOf } from '@/lib/textBlocks';

import {
  type CommentDraft,
  type CommentEntry,
  addComment as addCommentToDoc,
  commentsOf,
  elementCommentCount,
  readComments,
  removeComment as removeCommentFromDoc,
  resolveComment as resolveCommentInDoc,
} from './comments';
import { clearLocalDocument, loadLocalDocument, startLocalPersistence } from './localPersistence';
import {
  type RemotePresence,
  cursorColorFor,
  livePresence,
  readRemotePresence,
} from './presence';
import { type Capability, can as canCapability, effectiveUiRole } from './roles';

export type SyncState = 'connecting' | 'saved' | 'saving' | 'offline' | 'error';

export type SessionStatus = {
  state: SyncState;
  /** Hay cambios locales que el servidor todavía no confirmó. */
  unsynced: boolean;
  lastChangeAt: number | null;
  lastSavedAt: number | null;
};

export type BoardSessionOptions = {
  boardId: string;
  /** Colaboración activada; con `false` la sesión es estrictamente local. */
  connect?: boolean;
  collabUrl?: string;
  /** Milisegundos entre reintentos de conexión cuando el servidor no está. */
  retryDelayMs?: number;
  /** Rol del usuario en el tablero según la API (`BoardSummary.role`). */
  role?: EffectiveRole | null;
  /**
   * Fuerza el solo lectura sin importar el rol: lo usa la vista pública
   * (`/p/:slug`), que no tiene sesión ni socket.
   */
  readOnly?: boolean;
  /** Identidad para la presencia: nombre y color del cursor ajeno. */
  user?: { id: string; name: string } | null;
  /** Carga el documento de otra fuente (vista pública: sin sesión). */
  documentSource?: (boardId: string) => Promise<{ state: string; updatedAt: number | null } | null>;
};

/** Foto del permiso que la interfaz consume (`useSyncExternalStore`). */
export type PermissionSnapshot = {
  role: EffectiveRole | null;
  readOnly: boolean;
  socketRejected: boolean;
  /** Motivo del rechazo (aviso en la barra), si lo hubo. */
  reason: string | null;
};

export const DEFAULT_COLLAB_URL = 'ws://localhost:8787/collab';

/**
 * URL del servidor de colaboración. Se puede apuntar a otro servidor con
 * `VITE_COLLAB_URL` (mismo criterio que `VITE_API_BASE_URL` en `api/client.ts`):
 * sirve para probar el rechazo por permisos contra un servidor que cierre con
 * código propio sin tocar el código.
 */
export function resolveCollabUrl(): string {
  const configured = import.meta.env.VITE_COLLAB_URL as string | undefined;
  if (configured && configured.length > 0) return configured;
  return DEFAULT_COLLAB_URL;
}

/**
 * `@hocuspocus/provider` solo envía el mensaje de autenticación si `token` no
 * está vacío (`isAuthenticationRequired` en la librería); sin él la conexión se
 * queda esperando y el tablero nunca sincroniza. La credencial real es la
 * cookie de sesión httpOnly, que viaja en el handshake del WebSocket, así que
 * este valor es únicamente el disparador del handshake: el servidor descarta
 * cualquier token de menos de 32 caracteres.
 */
export const BROWSER_AUTH_TRIGGER = 'cookie-session';

/**
 * Espera antes de reconectar tras un cierre 4205 sin nada que descartar: la
 * guardia de restauración del servidor rechaza las reconexiones durante unos
 * segundos (8 s), así que reconectar en el acto solo encadena cierres.
 */
const RESET_RECONNECT_MS = 2_000;

/**
 * ¿El documento tiene contenido que el estado remoto no tenga? Es exactamente
 * la actualización que este cliente le enviaría al servidor (la unión de CRDTs
 * solo agrega) y, por lo tanto, lo que una restauración de versión tendría que
 * descartar. Una actualización vacía ocupa dos bytes.
 */
export function hasLocalOnlyContent(doc: Y.Doc, remoteState: Uint8Array): boolean {
  try {
    const remoteVector = Y.encodeStateVectorFromUpdate(remoteState);
    return Y.encodeStateAsUpdate(doc, remoteVector).byteLength > 2;
  } catch {
    // Sin poder calcularlo se asume que sí: descartar de más no revive nada;
    // descartar de menos revive lo restaurado.
    return true;
  }
}


const POSITIONAL_KEYS = new Set(['x', 'y', 'width', 'height', 'parentId']);

type CacheEntry<T> = { version: number; value: T };

export class BoardSession {
  readonly boardId: string;
  readonly doc: Y.Doc;
  readonly origin = localOrigin;
  readonly undoManager: Y.UndoManager;

  provider: HocuspocusProvider | null = null;

  private readonly elementStore: Y.Map<ElementMap>;
  private readonly order: Y.Array<string>;
  private readonly connectorStore: ConnectorStore;
  private readonly elementVersions = new Map<string, number>();
  private readonly elementCache = new Map<string, CacheEntry<CanvasElement | null>>();
  private readonly connectorCache = new Map<string, CacheEntry<Connector | null>>();
  private connectorVersion = 0;
  private connectorsCache: CacheEntry<Connector[]> = { version: -1, value: [] };
  private readonly textCache = new Map<string, CacheEntry<TextBlock[]>>();
  private readonly elementListeners = new Map<string, Set<() => void>>();
  private readonly layoutListeners = new Set<() => void>();
  private readonly connectorListeners = new Set<() => void>();
  private readonly statusListeners = new Set<() => void>();
  private readonly undoListeners = new Set<() => void>();
  private readonly trashListeners = new Set<() => void>();
  /** Cambios de contenido (texto o campos) de cualquier elemento. */
  private readonly contentListeners = new Set<() => void>();
  private contentVersion = 0;
  private allCache: { layout: number; content: number; value: CanvasElement[] } | null = null;
  private trashVersion = 0;
  private trashCache: { version: number; value: CanvasElement[] } | null = null;
  private readonly fragmentWatches = new Map<string, { fragment: Y.XmlFragment; handler: () => void }>();

  // --- Colaboración (fase 5) -------------------------------------------------

  private role: EffectiveRole | null;
  private socketRejected = false;
  private socketRejectReason: string | null = null;
  private readonly forcedReadOnly: boolean;
  private user: { id: string; name: string } | null;
  private userColor: string | null;
  private readonly roleListeners = new Set<() => void>();
  /** Pedidos de reconstrucción de la sesión (el tablero se restauró). */
  private readonly resetListeners = new Set<() => void>();
  private roleSnapshot: PermissionSnapshot;
  private readonly presenceListeners = new Set<() => void>();
  private presenceSnapshot: RemotePresence[] = [];
  private presenceVersion = -1;
  private cursor: Point | null = null;
  private cursorSentAt = 0;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly commentListeners = new Set<() => void>();
  private commentVersion = 0;
  private commentCache: { version: number; value: CommentEntry[] } | null = null;
  private readonly awarenessHandler = (): void => {
    this.refreshPresence();
  };

  private layoutVersion = 0;
  private layoutCacheVersion = -1;
  private layoutCache: ElementLayout[] = [];
  private status: SessionStatus = {
    state: 'connecting',
    unsynced: false,
    lastChangeAt: null,
    lastSavedAt: null,
  };
  private statusSnapshot: SessionStatus = this.status;
  private destroyed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Reconexión diferida tras un cierre 4205 sin nada que descartar. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private syncDeadline: ReturnType<typeof setTimeout> | null = null;
  private stopPersistence: (() => void) | null = null;
  private remoteLoaded = false;

  constructor(private readonly options: BoardSessionOptions) {
    this.boardId = options.boardId;
    this.doc = createBoardDoc();
    this.elementStore = elementsOf(this.doc);
    this.order = orderOf(this.doc);
    this.connectorStore = connectorsOf(this.doc);
    this.undoManager = createUndoManager(this.doc, {
      trackedOrigins: new Set([localOrigin]),
      captureTimeout: 400,
    });

    this.role = options.role ?? null;
    this.forcedReadOnly = options.readOnly === true;
    this.user = options.user ?? null;
    this.userColor = this.user ? cursorColorFor(this.user.id) : null;
    this.roleSnapshot = this.computePermission();

    const local = loadLocalDocument(this.boardId);
    if (local) {
      try {
        Y.applyUpdate(this.doc, local, 'local-persistence');
      } catch {
        // Estado local corrupto: se ignora y manda el del servidor.
      }
    }

    this.elementStore.observeDeep(this.onStoreDeep);
    this.order.observe(this.onOrderChange);
    this.connectorStore.observeDeep(this.onConnectorsChange);
    this.doc.on('afterTransaction', this.onAfterTransaction);
    this.undoManager.on('stack-item-added', this.onUndoStackChange);
    this.undoManager.on('stack-item-popped', this.onUndoStackChange);
    this.undoManager.on('stack-cleared', this.onUndoStackChange);
    this.observeComments();

    for (const id of this.elementStore.keys()) this.watchFragments(id);
    this.stopPersistence = startLocalPersistence(this.boardId, this.doc);
    this.setState('connecting');
  }

  // --- Ciclo de vida ---------------------------------------------------------

  /**
   * Carga el estado del servidor y abre la conexión de colaboración.
   * Nunca lanza: sin servidor la sesión queda en modo local.
   */
  async init(): Promise<void> {
    if (this.destroyed) return;
    // Un tablero local (`bd_…`) no existe en el servidor: no hay documento que
    // descargar ni conexión que abrir. El rechazo 4401 del socket solo dejaría
    // la interfaz en solo lectura; el contenido vive en el documento local que
    // el constructor cargó de `localStorage`.
    if (this.boardId.startsWith('bd_')) {
      this.setState('offline');
      return;
    }
    if (this.options.connect === false && !this.forcedReadOnly) {
      this.setState('offline');
      return;
    }
    if (this.forcedReadOnly) {
      // Vista pública: solo REST, sin ping y sin socket.
      await this.loadRemoteDocument();
      if (!this.destroyed) this.setState(this.remoteLoaded ? 'saved' : 'offline');
      return;
    }

    await this.loadRemoteDocument();
    if (this.destroyed) return;

    const reachable = await pingApi(2500);
    if (this.destroyed) return;
    if (!reachable) {
      // Sin servidor: se sigue trabajando en local y se reintenta más tarde.
      this.setState('offline');
      this.scheduleRetry();
      return;
    }
    this.startProvider();
  }

  private async loadRemoteDocument(): Promise<void> {
    if (this.remoteLoaded) return;
    try {
      const remote = this.options.documentSource
        ? await this.options.documentSource(this.boardId)
        : await fetchBoardDocument(this.boardId);
      if (!remote || this.destroyed) return;
      const bytes = Uint8Array.from(atob(remote.state), (char) => char.charCodeAt(0));
      // La unión de CRDTs es conmutativa: lo local y lo remoto se fusionan.
      Y.applyUpdate(this.doc, bytes, 'server-bootstrap');
      this.remoteLoaded = true;
    } catch {
      // API caída o tablero sin documento todavía: se trabaja en local.
    }
  }

  /**
   * Recarga el documento del servidor (vista pública: refresco cada 15 s).
   * La unión de CRDTs hace que repetirlo sea inocuo.
   */
  async refreshDocument(): Promise<boolean> {
    if (this.destroyed) return false;
    const hadDocument = this.remoteLoaded;
    this.remoteLoaded = false;
    await this.loadRemoteDocument();
    return this.remoteLoaded || hadDocument;
  }

  /**
   * Descarta el documento local del tablero: corta la persistencia (así nada
   * lo vuelve a escribir) y borra la copia guardada en el navegador.
   *
   * Es el paso obligatorio antes de reconstruir el estado desde el servidor
   * tras restaurar una versión. La unión de CRDTs solo agrega: si la copia
   * local sobrevive, revive el contenido que la restauración había quitado y
   * el proveedor lo vuelve a subir al servidor.
   */
  discardLocalDocument(): void {
    this.stopPersistence?.();
    this.stopPersistence = null;
    clearLocalDocument(this.boardId);
  }

  /**
   * La sesión pide que su dueño la reconstruya desde el remoto: el servidor
   * restauró una versión (cierre 4205) y el estado local quedó obsoleto. El
   * dueño destruye esta sesión y crea otra; con la copia local ya descartada,
   * el documento nuevo se arma solo con lo que devuelve el servidor.
   */
  subscribeReset(listener: () => void): () => void {
    this.resetListeners.add(listener);
    return () => {
      this.resetListeners.delete(listener);
    };
  }

  private requestReset(): void {
    for (const listener of this.resetListeners) listener();
  }

  /**
   * Recuperación tras un cierre 4205 (el servidor restauró una versión y cerró
   * las conexiones del tablero).
   *
   * Si el documento aporta contenido que el estado restaurado ya no tiene (una
   * copia local vieja, cambios sin sincronizar), se descarta la copia local y
   * se pide reconstruir la sesión desde el remoto: fusionarlo lo reviviría y el
   * proveedor lo volvería a subir. Si no aporta nada —por ejemplo una sesión
   * recién reconstruida a la que la guardia todavía le rechaza reconexiones—
   * no hay nada que descartar: se rearma la copia local con el estado actual y
   * se reconecta cuando la guardia afloje.
   */
  private async recoverFromRestore(): Promise<void> {
    const stale = await this.contributesContent();
    if (this.destroyed) return;
    if (!stale) {
      this.rearmLocalPersistence();
      this.scheduleReconnect();
      return;
    }
    this.discardLocalDocument();
    this.requestReset();
  }

  /**
   * ¿El documento aporta algo que el estado del servidor no tenga? Se compara
   * contra el documento remoto actual, que ya es el estado restaurado.
   */
  private async contributesContent(): Promise<boolean> {
    try {
      const remote = this.options.documentSource
        ? await this.options.documentSource(this.boardId)
        : await fetchBoardDocument(this.boardId);
      if (!remote) return true;
      const bytes = Uint8Array.from(atob(remote.state), (char) => char.charCodeAt(0));
      return hasLocalOnlyContent(this.doc, bytes);
    } catch {
      // Sin poder comparar se descarta (lado seguro).
      return true;
    }
  }

  /** Rearma la copia local con el estado actual, que ya es el del servidor. */
  private rearmLocalPersistence(): void {
    this.discardLocalDocument();
    if (this.destroyed) return;
    this.stopPersistence = startLocalPersistence(this.boardId, this.doc);
  }

  /** Reconecta más tarde: la guardia de restauración rechaza por unos segundos. */
  private scheduleReconnect(delayMs = RESET_RECONNECT_MS): void {
    if (this.destroyed) return;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.destroyed) return;
      // El proveedor reintenta solo; un fallo de conexión no debe escapar.
      void this.provider?.connect().catch(() => undefined);
    }, delayMs);
  }

  private startProvider(): void {
    if (this.destroyed || this.provider) return;
    // La vista pública es de solo lectura y sin socket: no hay sesión que
    // autenticar y el refresco llega por REST cada 15 s.
    if (this.forcedReadOnly) {
      this.setState('offline');
      return;
    }
    try {
      const provider = new HocuspocusProvider({
        url: this.options.collabUrl ?? resolveCollabUrl(),
        name: this.boardId,
        document: this.doc,
        connect: true,
        token: BROWSER_AUTH_TRIGGER,
        // El servidor autentica por la cookie de sesión, que el navegador envía
        // en el propio handshake del WebSocket (no hay opción `withCredentials`
        // en este proveedor: no hace falta).
        onConnect: () => {
          this.publishPresence();
          this.setState(this.status.unsynced ? 'saving' : 'connecting');
        },
        onAuthenticated: () => {
          // El servidor reconoció la sesión: si antes había rechazado, se limpia.
          this.clearSocketRejection();
        },
        onSynced: () => {
          this.clearSyncDeadline();
          this.status = { ...this.status, unsynced: false, lastSavedAt: Date.now() };
          this.setState('saved');
        },
        onStatus: ({ status }) => {
          if (status === 'connected') {
            this.setState(this.status.unsynced ? 'saving' : 'connecting');
          } else if (status === 'disconnected') {
            this.setState('offline');
          } else {
            this.setState('connecting');
          }
        },
        onDisconnect: () => {
          this.setState('offline');
        },
        onClose: ({ event }) => {
          this.handleSocketClose(event.code, event.reason);
        },
        onAuthenticationFailed: ({ reason }) => {
          this.handleSocketRejection(reason || 'El servidor rechazó la conexión de colaboración');
        },
        onStateless: ({ payload }) => {
          this.handleStateless(payload);
        },
      });
      this.provider = provider;
      this.attachAwareness(provider);
      // Si el servidor no completa el handshake (sin sesión, sin permisos, sin
      // servidor), la app se queda en local: el indicador no puede quedarse en
      // "conectando" para siempre.
      this.syncDeadline = setTimeout(() => {
        this.syncDeadline = null;
        if (this.destroyed) return;
        if (provider.isSynced) return;
        this.setState('offline');
      }, 4000);
    } catch {
      this.setState('offline');
      this.scheduleRetry();
    }
  }

  private clearSyncDeadline(): void {
    if (this.syncDeadline === null) return;
    clearTimeout(this.syncDeadline);
    this.syncDeadline = null;
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.init();
    }, this.options.retryDelayMs ?? 20000);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    if (this.cursorTimer !== null) clearTimeout(this.cursorTimer);
    this.clearPresence();
    this.detachAwareness();
    this.clearSyncDeadline();
    this.retryTimer = null;
    this.reconnectTimer = null;
    this.saveTimer = null;
    this.stopPersistence?.();
    this.stopPersistence = null;
    this.provider?.destroy();
    this.provider = null;
    this.elementStore.unobserveDeep(this.onStoreDeep);
    this.order.unobserve(this.onOrderChange);
    this.connectorStore.unobserveDeep(this.onConnectorsChange);
    this.doc.off('afterTransaction', this.onAfterTransaction);
    this.undoManager.off('stack-item-added', this.onUndoStackChange);
    this.undoManager.off('stack-item-popped', this.onUndoStackChange);
    this.undoManager.off('stack-cleared', this.onUndoStackChange);
    for (const [, watch] of this.fragmentWatches) {
      watch.fragment.unobserveDeep(watch.handler);
    }
    this.fragmentWatches.clear();
    this.undoManager.destroy();
    this.doc.destroy();
    for (const listeners of this.elementListeners.values()) listeners.clear();
    this.elementListeners.clear();
    this.layoutListeners.clear();
    this.connectorListeners.clear();
    this.statusListeners.clear();
    this.undoListeners.clear();
    this.trashListeners.clear();
    this.contentListeners.clear();
    this.presenceListeners.clear();
    this.roleListeners.clear();
    this.commentListeners.clear();
  }

  get destroyed_(): boolean {
    return this.destroyed;
  }

  // --- Lecturas --------------------------------------------------------------

  getElement(id: string): CanvasElement | null {
    const version = this.elementVersions.get(id) ?? 0;
    const cached = this.elementCache.get(id);
    if (cached && cached.version === version) return cached.value;
    const map = this.elementStore.get(id);
    const value = map ? readElement(map) : null;
    this.elementCache.set(id, { version, value });
    return value;
  }

  getTextBlocks(id: string): TextBlock[] {
    const version = this.elementVersions.get(id) ?? 0;
    const cached = this.textCache.get(id);
    if (cached && cached.version === version) return cached.value;
    const fragment = this.getTextFragment(id);
    const value = textBlocksOf(fragment);
    this.textCache.set(id, { version, value });
    return value;
  }

  getTextFragment(id: string): Y.XmlFragment | null {
    const map = this.elementStore.get(id);
    const fragment = map?.get('text');
    return fragment instanceof Y.XmlFragment ? fragment : null;
  }

  ensureTextFragment(id: string): Y.XmlFragment | null {
    const fragment = ensureTextFragment(this.doc, id, localOrigin);
    if (fragment) this.watchFragments(id);
    return fragment;
  }

  /**
   * Todos los elementos vivos del documento, en orden de apilado (incluye los
   * hijos de columnas, que no están en el layout absoluto). Es la materia prima
   * de la búsqueda del tablero y de la vista de lista; se cachea hasta el
   * próximo cambio de layout o de contenido.
   */
  getAllElements(): CanvasElement[] {
    if (
      this.allCache &&
      this.allCache.layout === this.layoutVersion &&
      this.allCache.content === this.contentVersion
    ) {
      return this.allCache.value;
    }
    const value = getOrderedElements(this.doc);
    this.allCache = { layout: this.layoutVersion, content: this.contentVersion, value };
    return value;
  }

  /**
   * Cambios de contenido de cualquier elemento (texto, campos JSON, papelera).
   * La búsqueda dentro del tablero se suscribe acá para refrescar mientras se
   * escribe.
   */
  subscribeContent(listener: () => void): () => void {
    this.contentListeners.add(listener);
    return () => {
      this.contentListeners.delete(listener);
    };
  }

  // --- Conectores ------------------------------------------------------------

  /** Conectores del documento (cacheado hasta el próximo cambio). */
  getConnectors(): Connector[] {
    if (this.connectorsCache.version === this.connectorVersion) return this.connectorsCache.value;
    const value: Connector[] = [];
    this.connectorStore.forEach((map) => {
      const connector = readConnector(map);
      if (connector) value.push(connector);
    });
    this.connectorsCache = { version: this.connectorVersion, value };
    return value;
  }

  getConnector(id: string): Connector | null {
    const cached = this.connectorCache.get(id);
    if (cached && cached.version === this.connectorVersion) return cached.value;
    const map = this.connectorStore.get(id);
    const value = map ? readConnector(map) : null;
    this.connectorCache.set(id, { version: this.connectorVersion, value });
    return value;
  }

  subscribeConnectors(listener: () => void): () => void {
    this.connectorListeners.add(listener);
    return () => {
      this.connectorListeners.delete(listener);
    };
  }

  /** Layout completo en orden de apilado (cacheado hasta el próximo cambio). */
  getLayout(): ElementLayout[] {
    if (this.layoutCacheVersion === this.layoutVersion) return this.layoutCache;
    this.layoutCache = topLevelLayoutOf(getOrderedElements(this.doc));
    this.layoutCacheVersion = this.layoutVersion;
    return this.layoutCache;
  }

  /** Rectángulos de referencia para las guías magnéticas. */
  getTargetRects(
    measured: ReadonlyMap<string, number> | undefined,
    excluded: ReadonlySet<string>,
    view: Rect,
  ): Rect[] {
    return targetRects(this.getLayout(), measured, excluded, view);
  }

  /** Caja envolvente del tablero con las alturas medidas (para "ajustar a pantalla"). */
  bounds(measured?: ReadonlyMap<string, number>): Rect | null {
    const layout = this.getLayout();
    if (layout.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of layout) {
      const height = item.autoHeight ? (measured?.get(item.id) ?? item.height) : item.height;
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + item.width);
      maxY = Math.max(maxY, item.y + height);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  sizeOf(id: string): Size | null {
    const element = this.getElement(id);
    return element ? { width: element.width, height: element.height ?? 0 } : null;
  }

  getStatus(): SessionStatus {
    return this.statusSnapshot;
  }

  getSyncState(): SyncState {
    return this.status.state;
  }

  get isConnected(): boolean {
    return this.provider?.isConnected === true;
  }

  // --- Suscripciones (useSyncExternalStore) ---------------------------------

  subscribeLayout(listener: () => void): () => void {
    this.layoutListeners.add(listener);
    return () => {
      this.layoutListeners.delete(listener);
    };
  }

  subscribeElement(id: string, listener: () => void): () => void {
    let listeners = this.elementListeners.get(id);
    if (!listeners) {
      listeners = new Set();
      this.elementListeners.set(id, listeners);
    }
    listeners.add(listener);
    return () => {
      const current = this.elementListeners.get(id);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.elementListeners.delete(id);
    };
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribeUndo(listener: () => void): () => void {
    this.undoListeners.add(listener);
    return () => {
      this.undoListeners.delete(listener);
    };
  }

  /**
   * Cambios de la papelera: un elemento que entra o sale de ella (o que se
   * elimina definitivamente). El panel de papelera se suscribe acá.
   */
  subscribeTrash(listener: () => void): () => void {
    this.trashListeners.add(listener);
    return () => {
      this.trashListeners.delete(listener);
    };
  }

  /** Elementos en la papelera del documento (del más reciente al más viejo). */
  getTrashed(): CanvasElement[] {
    // Cacheado: `useSyncExternalStore` compara la instantánea por identidad.
    if (this.trashCache && this.trashCache.version === this.trashVersion) return this.trashCache.value;
    const value = getTrashedElements(this.doc);
    this.trashCache = { version: this.trashVersion, value };
    return value;
  }

  // --- Permisos (fase 5) -----------------------------------------------------

  private computePermission(): PermissionSnapshot {
    const role = effectiveUiRole({
      role: this.role,
      socketRejected: this.socketRejected,
      forcedReadOnly: this.forcedReadOnly,
    });
    return {
      role,
      readOnly: this.forcedReadOnly || !canCapability(role, 'edit'),
      socketRejected: this.socketRejected,
      reason: this.socketRejectReason,
    };
  }

  private publishPermission(): void {
    const next = this.computePermission();
    const current = this.roleSnapshot;
    if (
      current.role === next.role &&
      current.readOnly === next.readOnly &&
      current.socketRejected === next.socketRejected &&
      current.reason === next.reason
    ) {
      return;
    }
    this.roleSnapshot = next;
    for (const listener of this.roleListeners) listener();
  }

  /** Foto del permiso: rol efectivo, solo lectura y motivo del rechazo. */
  getPermission(): PermissionSnapshot {
    return this.roleSnapshot;
  }

  getRole(): EffectiveRole | null {
    return this.roleSnapshot.role;
  }

  get isReadOnly(): boolean {
    return this.roleSnapshot.readOnly;
  }

  /** ¿El rol habilita esta capacidad de la interfaz? */
  can(capability: Capability): boolean {
    return canCapability(this.roleSnapshot.role, capability);
  }

  get socketWasRejected(): boolean {
    return this.socketRejected;
  }

  subscribePermission(listener: () => void): () => void {
    this.roleListeners.add(listener);
    return () => {
      this.roleListeners.delete(listener);
    };
  }

  /** Actualiza el rol cuando la API lo dice (por ejemplo al abrir el tablero). */
  setRole(role: EffectiveRole | null): void {
    if (this.role === role) return;
    this.role = role;
    this.publishPermission();
  }

  /**
   * El servidor rechazó la conexión de colaboración (sin permiso, sesión
   * vencida o tablero cerrado). **Nunca** deja la pantalla en blanco: el
   * documento que llegó por REST sigue visible y la interfaz pasa a solo lectura
   * con el aviso del motivo.
   */
  private handleSocketRejection(reason: string): void {
    this.socketRejected = true;
    this.socketRejectReason = reason;
    if (this.role === null) this.role = 'viewer';
    this.publishPermission();
    this.setState('error');
  }

  private clearSocketRejection(): void {
    if (!this.socketRejected) return;
    this.socketRejected = false;
    this.socketRejectReason = null;
    this.publishPermission();
  }

  /**
   * Cierres con código del servidor. `Reset Connection` (4205) es la guardia de
   * restauración: el servidor reescribió el documento del tablero, así que el
   * estado local de este cliente quedó obsoleto (no es un rechazo de permiso).
   * `Unauthorized` (4401) y `Forbidden` (4403) — y cualquier cierre propio
   * ≥ 4400 — pasan a solo lectura con aviso.
   */
  private handleSocketClose(code: number, reason: string): void {
    if (code === 4205) {
      this.remoteLoaded = false;
      // El servidor restauró una versión: reconectar con el documento viejo en
      // memoria (o dejar que el proveedor lo haga solo) reviviría lo restaurado.
      // El proveedor para y la decisión —descartar la copia local y reconstruir
      // la sesión, o solo reconectar— se toma comparando con el remoto.
      this.provider?.disconnect();
      void this.recoverFromRestore();
      return;
    }
    if (code >= 4400 && code < 4500) {
      this.handleSocketRejection(reason || 'El servidor cerró la conexión de colaboración');
    }
  }

  /**
   * Mensajes sin documento. La API puede anunciar el rol de la conexión; si no
   * lo hace, el rol sigue viniendo de la REST y del rechazo del socket.
   */
  private handleStateless(payload: string): void {
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (!parsed || typeof parsed !== 'object') return;
      const record = parsed as Record<string, unknown>;
      if (record['type'] === 'role' || 'role' in record) {
        const role = typeof record['role'] === 'string' ? record['role'] : null;
        if (role === 'owner' || role === 'editor' || role === 'commenter' || role === 'viewer') {
          this.setRole(role);
        }
      }
    } catch {
      // Un mensaje que no es JSON no cambia nada.
    }
  }

  // --- Presencia y cursores (fase 5) -----------------------------------------

  private attachAwareness(provider: HocuspocusProvider): void {
    const awareness = provider?.awareness;
    if (!awareness) return;
    awareness.on('change', this.awarenessHandler);
    this.publishPresence();
  }

  private detachAwareness(): void {
    const awareness = this.provider?.awareness;
    if (!awareness) return;
    awareness.off('change', this.awarenessHandler);
  }

  /** Estado local de presencia: quién soy, dónde está mi puntero y qué miro. */
  private publishPresence(): void {
    const awareness = this.provider?.awareness;
    if (!awareness) return;
    const state: Record<string, unknown> = {
      user: this.user
        ? { id: this.user.id, name: this.user.name, color: this.userColor }
        : { id: 'anon', name: 'Alguien', color: null },
      cursor: this.cursor,
      selection: this.selectionSnapshot(),
      editingId: this.editingSnapshot(),
      boardId: this.boardId,
      at: Date.now(),
    };
    // `setLocalState` reemplaza el estado entero: es lo que queremos, porque
    // todas las claves las mantenemos nosotros.
    awareness.setLocalState(state);
  }

  /** Selección actual: la escribe la capa de interfaz (evita acoplar el store). */
  private selectionSnapshot: () => string[] = () => [];
  private editingSnapshot: () => string | null = () => null;

  /** Enlaza la sesión con el estado efímero de la interfaz. */
  bindUiState(read: { selection: () => string[]; editingId: () => string | null }): void {
    this.selectionSnapshot = read.selection;
    this.editingSnapshot = read.editingId;
  }

  /**
   * Publica la posición del puntero (en coordenadas de mundo). Va con un
   * pequeño throttle: el cursor ajeno no necesita 120 Hz.
   */
  setPresenceCursor(point: Point | null): void {
    this.cursor = point;
    if (!this.provider?.awareness) return;
    const now = Date.now();
    if (now - this.cursorSentAt < 40) {
      if (this.cursorTimer !== null) return;
      this.cursorTimer = setTimeout(() => {
        this.cursorTimer = null;
        this.publishPresence();
      }, 40);
      return;
    }
    this.cursorSentAt = now;
    this.publishPresence();
  }

  /** Publica selección y edición (lo llama la capa de interfaz al cambiar). */
  refreshPresenceState(): void {
    if (!this.provider?.awareness) return;
    this.publishPresence();
  }

  /**
   * Fija (o cambia) la identidad con la que se publica la presencia. La sesión
   * se crea antes de que la API confirme el usuario, así que esto llega después.
   */
  setPresenceUser(user: { id: string; name: string } | null): void {
    if (!user) return;
    if (this.user && this.user.id === user.id && this.user.name === user.name) return;
    this.user = user;
    this.userColor = cursorColorFor(user.id);
    this.publishPresence();
  }

  /** Avisa a los demás que este cliente se va (sin esperar al timeout). */
  clearPresence(): void {
    const awareness = this.provider?.awareness;
    if (!awareness) return;
    this.cursor = null;
    try {
      awareness.setLocalState(null);
    } catch {
      // sin awareness no hay nada que limpiar
    }
  }

  private refreshPresence(): void {
    const provider = this.provider;
    const awareness = provider?.awareness;
    const states = awareness ? awareness.getStates() : new Map<number, unknown>();
    const next = livePresence(readRemotePresence(states, this.doc.clientID));
    const changed =
      this.presenceVersion === -1 ||
      next.length !== this.presenceSnapshot.length ||
      next.some((entry, index) => {
        const previous = this.presenceSnapshot[index];
        if (!previous) return true;
        return (
          previous.clientId !== entry.clientId ||
          previous.userId !== entry.userId ||
          previous.name !== entry.name ||
          previous.cursor?.x !== entry.cursor?.x ||
          previous.cursor?.y !== entry.cursor?.y ||
          previous.editingId !== entry.editingId ||
          previous.selection.length !== entry.selection.length ||
          previous.selection.some((id, at) => entry.selection[at] !== id)
        );
      });
    this.presenceVersion += 1;
    if (!changed) return;
    this.presenceSnapshot = next;
    for (const listener of this.presenceListeners) listener();
  }

  /** Presencias ajenas (sin este cliente). */
  getPresence(): RemotePresence[] {
    return this.presenceSnapshot;
  }

  subscribePresence(listener: () => void): () => void {
    this.presenceListeners.add(listener);
    return () => {
      this.presenceListeners.delete(listener);
    };
  }

  // --- Comentarios (fase 5) --------------------------------------------------

  private observeComments(): void {
    const store = commentsOf(this.doc);
    store.observeDeep(() => {
      this.commentVersion += 1;
      this.commentCache = null;
      for (const listener of this.commentListeners) listener();
    });
  }

  /** Comentarios del documento (vivos: llegan por el mismo canal que el resto). */
  getComments(): CommentEntry[] {
    if (this.commentCache && this.commentCache.version === this.commentVersion) return this.commentCache.value;
    const value = readComments(this.doc);
    this.commentCache = { version: this.commentVersion, value };
    return value;
  }

  subscribeComments(listener: () => void): () => void {
    this.commentListeners.add(listener);
    return () => {
      this.commentListeners.delete(listener);
    };
  }

  /** Comentarios abiertos anclados a una tarjeta (contador del icono). */
  commentCountFor(elementId: string): number {
    return elementCommentCount(this.getComments(), elementId);
  }

  /** Identidad del autor para los comentarios y la actividad. */
  get author(): { id: string; name: string } {
    return this.user ?? { id: 'local-user', name: 'Local' };
  }

  /** Añade un comentario al documento (raíz o respuesta) y devuelve su id. */
  addComment(draft: Omit<CommentDraft, 'authorId' | 'authorName'>): string | null {
    if (!this.can('comment')) return null;
    const id = addCommentToDoc(
      this.doc,
      { ...draft, authorId: this.author.id, authorName: this.author.name },
      localOrigin,
    );
    this.bumpComments();
    return id;
  }

  setCommentResolved(id: string, resolved: boolean): void {
    if (!this.can('comment')) return;
    resolveCommentInDoc(this.doc, id, resolved, this.author.id, localOrigin);
    this.bumpComments();
  }

  removeComment(id: string): string[] {
    if (!this.can('comment')) return [];
    const removed = removeCommentFromDoc(this.doc, id, localOrigin);
    this.bumpComments();
    return removed;
  }

  private bumpComments(): void {
    this.commentVersion += 1;
    this.commentCache = null;
    for (const listener of this.commentListeners) listener();
  }

  // --- Deshacer / rehacer ----------------------------------------------------

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  // --- Observadores internos -------------------------------------------------

  private readonly onStoreDeep = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    let layoutChanged = false;
    let trashChanged = false;
    const touched = new Set<string>();

    for (const event of events) {
      if (event instanceof Y.YMapEvent) {
        for (const key of event.keysChanged) {
          const name = String(key);
          if (event.path.length === 0) {
            touched.add(name);
            layoutChanged = true;
            trashChanged = true;
            if (this.elementStore.get(name)) this.watchFragments(name);
            else this.unwatchFragments(name);
          } else if (event.path.length === 1) {
            const id = String(event.path[0]);
            touched.add(id);
            if (POSITIONAL_KEYS.has(name)) layoutChanged = true;
            // La papelera también decide qué se ve: `getOrderedElements` oculta
            // lo marcado, así que el layout tiene que invalidarse.
            if (name === 'deletedAt' || name === 'deletedBy') {
              trashChanged = true;
              layoutChanged = true;
            }
            if (name === 'text') this.watchFragments(id);
          } else {
            touched.add(String(event.path[0]));
          }
        }
        continue;
      }
      // Cambios en tipos anidados (por ejemplo dentro de una columna).
      if (event.path.length > 0) touched.add(String(event.path[0]));
      layoutChanged = true;
    }

    for (const id of touched) this.touchElement(id);
    if (layoutChanged) this.invalidateLayout();
    if (trashChanged) {
      this.trashVersion += 1;
      this.trashCache = null;
      for (const listener of this.trashListeners) listener();
    }
  };

  private readonly onOrderChange = (): void => {
    this.invalidateLayout();
  };

  private readonly onConnectorsChange = (): void => {
    this.connectorVersion += 1;
    this.connectorCache.clear();
    for (const listener of this.connectorListeners) listener();
  };

  private readonly onAfterTransaction = (transaction: Y.Transaction): void => {
    if (transaction.origin !== localOrigin && transaction.origin !== this.undoManager) return;
    this.markDirty();
  };

  private readonly onUndoStackChange = (): void => {
    for (const listener of this.undoListeners) listener();
  };

  private touchElement(id: string): void {
    this.elementVersions.set(id, (this.elementVersions.get(id) ?? 0) + 1);
    this.elementCache.delete(id);
    this.textCache.delete(id);
    this.contentVersion += 1;
    for (const listener of this.contentListeners) listener();
    const listeners = this.elementListeners.get(id);
    if (!listeners) return;
    for (const listener of listeners) listener();
  }

  private invalidateLayout(): void {
    this.layoutVersion += 1;
    for (const listener of this.layoutListeners) listener();
  }

  private watchFragments(id: string): void {
    const map = this.elementStore.get(id);
    const fragment = map?.get('text');
    if (!(fragment instanceof Y.XmlFragment)) return;
    const existing = this.fragmentWatches.get(id);
    if (existing && existing.fragment === fragment) return;
    this.unwatchFragments(id);
    const handler = () => {
      this.touchElement(id);
    };
    fragment.observeDeep(handler);
    this.fragmentWatches.set(id, { fragment, handler });
  }

  private unwatchFragments(id: string): void {
    const existing = this.fragmentWatches.get(id);
    if (!existing) return;
    existing.fragment.unobserveDeep(existing.handler);
    this.fragmentWatches.delete(id);
  }

  private markDirty(): void {
    const now = Date.now();
    this.status = { ...this.status, unsynced: true, lastChangeAt: now };
    if (!this.isConnected) {
      // Sin servidor no hay nada que confirmar: lo que se guarda es local y el
      // indicador tiene que decirlo en lugar de quedarse en "guardando".
      this.setState(this.status.state === 'connecting' ? 'connecting' : 'offline');
      return;
    }
    this.setState('saving');
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.destroyed) return;
      if (!this.isConnected) {
        this.setState('offline');
        return;
      }
      const provider = this.provider;
      if (provider && provider.hasUnsyncedChanges) return;
      this.status = { ...this.status, unsynced: false, lastSavedAt: Date.now() };
      this.setState('saved');
    }, 500);
  }

  private setState(state: SyncState): void {
    this.status = { ...this.status, state };
    const previous = this.statusSnapshot;
    if (
      previous.state === this.status.state &&
      previous.unsynced === this.status.unsynced &&
      previous.lastSavedAt === this.status.lastSavedAt &&
      previous.lastChangeAt === this.status.lastChangeAt
    ) {
      return;
    }
    this.statusSnapshot = { ...this.status };
    for (const listener of this.statusListeners) listener();
  }
}

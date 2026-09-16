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
 */

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import {
  type CanvasElement,
  type Connector,
  type ConnectorStore,
  type ElementMap,
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

import { loadLocalDocument, startLocalPersistence } from './localPersistence';

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
};

export const DEFAULT_COLLAB_URL = 'ws://localhost:8787/collab';

/**
 * `@hocuspocus/provider` solo envía el mensaje de autenticación si `token` no
 * está vacío (`isAuthenticationRequired` en la librería); sin él la conexión se
 * queda esperando y el tablero nunca sincroniza. La credencial real es la
 * cookie de sesión httpOnly, que viaja en el handshake del WebSocket, así que
 * este valor es únicamente el disparador del handshake: el servidor descarta
 * cualquier token de menos de 32 caracteres.
 */
export const BROWSER_AUTH_TRIGGER = 'cookie-session';


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
  private trashVersion = 0;
  private trashCache: { version: number; value: CanvasElement[] } | null = null;
  private readonly fragmentWatches = new Map<string, { fragment: Y.XmlFragment; handler: () => void }>();

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
    if (this.options.connect === false) {
      this.setState('offline');
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
      const remote = await fetchBoardDocument(this.boardId);
      if (!remote || this.destroyed) return;
      const bytes = Uint8Array.from(atob(remote.state), (char) => char.charCodeAt(0));
      // La unión de CRDTs es conmutativa: lo local y lo remoto se fusionan.
      Y.applyUpdate(this.doc, bytes, 'server-bootstrap');
      this.remoteLoaded = true;
    } catch {
      // API caída o tablero sin documento todavía: se trabaja en local.
    }
  }

  private startProvider(): void {
    if (this.destroyed || this.provider) return;
    try {
      const provider = new HocuspocusProvider({
        url: this.options.collabUrl ?? DEFAULT_COLLAB_URL,
        name: this.boardId,
        document: this.doc,
        connect: true,
        token: BROWSER_AUTH_TRIGGER,
        // El servidor autentica por la cookie de sesión, que el navegador envía
        // en el propio handshake del WebSocket (no hay opción `withCredentials`
        // en este proveedor: no hace falta).
        onConnect: () => {
          this.setState(this.status.unsynced ? 'saving' : 'connecting');
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
        onAuthenticationFailed: () => {
          this.setState('error');
        },
      });
      this.provider = provider;
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
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.clearSyncDeadline();
    this.retryTimer = null;
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

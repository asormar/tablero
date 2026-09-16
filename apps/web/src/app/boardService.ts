/**
 * Arranque y navegación entre tableros.
 *
 * Reglas de la fase 1:
 * - La app tiene que ser usable aunque la API no responda: si no hay servidor se
 *   crea/recupera un tablero local y se sigue trabajando.
 * - El tablero abierto vive en la URL (`?board=…`) para que recargar lo
 *   restituya.
 */

import {
  type BoardSummary,
  ROOT_BOARD_TITLE,
  buildBreadcrumbPath,
  createBoardId,
} from '@tablero/shared';

import { ApiError, pingApi } from '@/api/client';
import {
  createBoard,
  fetchBreadcrumbs,
  fetchMe,
  getBoard,
  listBoards,
  updateBoard,
} from '@/api/boards';
import { clearLocalDocument, mergeLocalDocuments } from '@/collab/localPersistence';
import { LOCAL_USER, boardById, localBoard, readLastBoardId, useAppStore } from '@/state/appStore';

const DEFAULT_BOARD_ICON = '📋';

export function readBoardIdFromUrl(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get('board');
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeBoardIdToUrl(boardId: string): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('board', boardId);
    window.history.replaceState(null, '', url.toString());
  } catch {
    // sin History API: la navegación sigue funcionando en memoria
  }
}

function byRecency(a: BoardSummary, b: BoardSummary): number {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

/** Fusiona lo que devuelve la API con lo que ya teníamos (la API manda). */
function mergeBoards(local: BoardSummary[], remote: BoardSummary[]): BoardSummary[] {
  const byId = new Map<string, BoardSummary>();
  for (const board of local) byId.set(board.id, board);
  for (const board of remote) {
    const previous = byId.get(board.id);
    byId.set(board.id, previous ? { ...previous, ...board } : board);
  }
  return [...byId.values()].sort(byRecency);
}

/**
 * Adopta en el servidor un tablero creado sin conexión (y sus antecesores).
 *
 * Un tablero local no existe en la API: si se intenta abrir como tablero
 * activo, su documento da 404 y el WebSocket no tiene permisos, así que el
 * contenido queda aislado en el navegador. Adoptarlo significa crear el tablero
 * en el servidor, pasar su documento Yjs al id definitivo y reemplazar el
 * marcador local por el del servidor.
 *
 * Devuelve el id definitivo, o `null` si no se pudo adoptar (se sigue en local).
 */
async function adoptLocalBoard(boardId: string, remoteIds: Set<string>, depth = 0): Promise<string | null> {
  if (depth > 8) return null;
  const store = useAppStore.getState();
  const board = boardById(store.boards, boardId);
  if (!board) return null;
  if (remoteIds.has(board.id)) return board.id;

  // Raíz local: si el servidor ya tiene una raíz con el mismo título, el
  // documento se fusiona ahí (una unión de CRDTs, así que no pisa nada) en vez
  // de crear otro tablero: la API anida por defecto cuando el padre es null, así
  // que sin esto aparecería un "Inicio" dentro de "Inicio".
  if (!board.parentBoardId) {
    const twin = store.boards.find(
      (candidate) =>
        candidate.id !== board.id &&
        remoteIds.has(candidate.id) &&
        candidate.parentBoardId === null &&
        candidate.trashedAt === null &&
        candidate.title === board.title,
    );
    if (twin) {
      mergeLocalDocuments(board.id, twin.id);
      clearLocalDocument(board.id);
      store.removeBoard(board.id);
      return twin.id;
    }
  }

  let parentId = board.parentBoardId;
  if (parentId) {
    const mappedParent = await adoptLocalBoard(parentId, remoteIds, depth + 1);
    // Sin padre adoptado no se adopta el hijo: quedaría descolgado del árbol.
    if (mappedParent === null) return null;
    parentId = mappedParent;
  }

  try {
    const created = await createBoard({
      title: board.title,
      parentBoardId: parentId,
      icon: board.icon,
      color: board.color,
    });
    mergeLocalDocuments(board.id, created.id);
    clearLocalDocument(board.id);
    store.removeBoard(board.id);
    store.upsertBoard(created);
    remoteIds.add(created.id);
    return created.id;
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'No se pudo pasar el tablero local al servidor';
    store.setNotice(`${message}. Se continúa en local.`);
    return null;
  }
}

/**
 * Decide qué tablero del servidor abrir: primero el pedido por URL o el último
 * abierto, y si no, la raíz más reciente. Un tablero que solo existe en local
 * se adopta antes de descartarlo, para que su contenido no quede aislado.
 */
async function resolveOnlineBoardId(
  preferred: (string | null)[],
  boards: BoardSummary[],
  remoteIds: Set<string>,
): Promise<string | null> {
  const candidates = preferred.filter((id): id is string => typeof id === 'string');

  const remote = candidates.find((id) => remoteIds.has(id));
  if (remote) return remote;

  for (const id of candidates) {
    if (boardById(boards, id) === undefined) continue;
    const adopted = await adoptLocalBoard(id, remoteIds);
    if (adopted) return adopted;
  }

  const roots = boards
    .filter((board) => remoteIds.has(board.id) && board.parentBoardId === null && board.trashedAt === null)
    .sort(byRecency);
  return roots[0]?.id ?? null;
}

export async function ensureBoardInRegistry(boardId: string): Promise<BoardSummary> {
  const store = useAppStore.getState();
  const existing = boardById(store.boards, boardId);
  if (existing) return existing;
  if (store.apiOnline) {
    try {
      const { board } = await getBoard(boardId);
      store.upsertBoard(board);
      return board;
    } catch {
      // sigue abajo con el marcador local
    }
  }
  const placeholder = localBoard(boardId, 'Tablero');
  store.upsertBoard(placeholder);
  return placeholder;
}

export type BootstrapResult = { boardId: string; online: boolean };

/**
 * Decide qué tablero abrir y deja el catálogo cargado. Nunca lanza: como mucho
 * deja un aviso en el store.
 *
 * La promesa se memoriza: el arranque es idempotente y no se duplica cuando
 * React monta dos veces los efectos (StrictMode en desarrollo).
 */
export function bootstrap(): Promise<BootstrapResult> {
  bootstrapPromise ??= runBootstrap();
  return bootstrapPromise;
}

/**
 * Rearranca después de iniciar sesión o crear la cuenta.
 *
 * Sin esto, la promesa memorizada devolvería el resultado del arranque en modo
 * local y el catálogo del servidor no se cargaría hasta recargar la página.
 */
export function resumeAfterAuth(): Promise<BootstrapResult> {
  bootstrapPromise = null;
  return bootstrap();
}

let bootstrapPromise: Promise<BootstrapResult> | null = null;

async function runBootstrap(): Promise<BootstrapResult> {
  const store = useAppStore.getState();
  const urlBoardId = readBoardIdFromUrl();
  const lastBoardId = readLastBoardId();
  const online = await pingApi(2500);
  store.setApiOnline(online);

  if (online) {
    try {
      const me = await fetchMe();
      store.setUser(me.user);
      const remoteIds = new Set(me.boards.map((board) => board.id));
      const boards = mergeBoards(store.boards, me.boards);
      store.setBoards(boards);

      // Solo un tablero del servidor puede ser el activo (los locales de una
      // sesión sin conexión no tienen documento ni permisos en la API); si el
      // tablero pedido solo existe en local, se adopta antes de descartarlo.
      let boardId = await resolveOnlineBoardId([urlBoardId, lastBoardId], boards, remoteIds);

      if (!boardId) {
        // Usuario sin ningún tablero en el servidor: se crea el raíz.
        const created = await createBoard({
          title: ROOT_BOARD_TITLE,
          parentBoardId: null,
          icon: DEFAULT_BOARD_ICON,
        });
        store.upsertBoard(created);
        remoteIds.add(created.id);
        boardId = created.id;
      }
      if (boardId && !boards.some((board) => board.id === boardId)) {
        await ensureBoardInRegistry(boardId);
      }
      store.setNotice(null);
      store.setAuthRequired(false);
      if (!boardId) throw new Error('sin tableros');
      store.setCurrentBoard(boardId);
      writeBoardIdToUrl(boardId);
      return { boardId, online: true };
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        // Hay servidor pero no hay sesión: en vez de caer a local en silencio
        // (y que el trabajo no llegue nunca al servidor), se pide el acceso.
        // El trabajo local no se pierde: sigue en el catálogo y se adopta.
        store.setAuthRequired(true);
      } else {
        const message = error instanceof ApiError ? error.message : 'No se pudo cargar el catálogo de tableros';
        store.setNotice(`${message}. Se continúa en local.`);
      }
    }
  } else {
    store.setNotice('Sin conexión con el servidor. Los cambios se guardan en este navegador.');
  }

  // --- Modo local -----------------------------------------------------------
  store.setApiOnline(false);
  if (store.user.id === LOCAL_USER.id && store.user.name === LOCAL_USER.name) {
    store.setUser(LOCAL_USER);
  }
  let boardId = urlBoardId ?? lastBoardId;
  if (!boardId) {
    const existing = [...store.boards].sort(byRecency)[0];
    boardId = existing?.id ?? null;
  }
  if (!boardId) {
    boardId = createBoardId();
  }
  if (!store.boards.some((board) => board.id === boardId)) {
    store.upsertBoard(localBoard(boardId, ROOT_BOARD_TITLE, null));
  }
  store.setCurrentBoard(boardId);
  writeBoardIdToUrl(boardId);
  return { boardId, online: false };
}

/** Crea un tablero (hijo del actual, si se indica) y devuelve sus metadatos. */
export async function createNestedBoard(
  parentBoardId: string | null,
  title = 'Tablero sin título',
  icon: string | null = null,
): Promise<BoardSummary> {
  const store = useAppStore.getState();
  if (store.apiOnline) {
    try {
      const created = await createBoard({ title, parentBoardId, icon });
      store.upsertBoard(created);
      return created;
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'No se pudo crear el tablero';
      store.setNotice(`${message}. Se creó solo en local.`);
    }
  }
  const board = localBoard(createBoardId(), title, parentBoardId);
  const withIcon: BoardSummary = { ...board, icon };
  store.upsertBoard(withIcon);
  return withIcon;
}

/** Renombra un tablero (API si se puede, local si no). */
export async function renameBoard(boardId: string, title: string): Promise<void> {
  const store = useAppStore.getState();
  const trimmed = title.trim();
  if (trimmed.length === 0) return;
  const current = boardById(store.boards, boardId);
  if (current && current.title === trimmed) return;
  if (store.apiOnline) {
    try {
      const updated = await updateBoard(boardId, { title: trimmed });
      store.upsertBoard(updated);
      return;
    } catch {
      // cae al camino local
    }
  }
  const fallback = current ?? localBoard(boardId, trimmed);
  store.upsertBoard({ ...fallback, title: trimmed, updatedAt: Date.now() });
}

/**
 * Ruta de migas de pan. Se calcula con el catálogo local; si está incompleta y
 * hay servidor, se pide al backend.
 */
export async function breadcrumbsFor(boardId: string): Promise<BoardSummary[]> {
  const store = useAppStore.getState();
  const local = buildBreadcrumbPath(store.boards, boardId);
  const board = boardById(store.boards, boardId);
  const incomplete = local.length === 0 || (board?.parentBoardId != null && local.length < 2);
  if (!incomplete) return local;
  if (store.apiOnline) {
    try {
      const remote = await fetchBreadcrumbs(boardId);
      if (remote.length > 0) return remote;
    } catch {
      // se devuelve lo local
    }
  }
  if (local.length > 0) return local;
  const fallback = board ?? (await ensureBoardInRegistry(boardId));
  return [fallback];
}

export async function refreshBoards(): Promise<void> {
  const store = useAppStore.getState();
  try {
    const boards = await listBoards('recent');
    store.setBoards(mergeBoards(store.boards, boards));
  } catch {
    // silencio: el catálogo local sigue siendo válido
  }
}

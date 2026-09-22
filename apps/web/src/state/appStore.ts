/**
 * Estado de aplicación: usuario, catálogo de tableros, estado de sincronización
 * y avisos sobrios sobre la API.
 *
 * El catálogo vive aquí (y en localStorage) para que las tarjetas de tablero
 * muestren su título aunque la API no esté disponible: se trabaja igual.
 */

import { create } from 'zustand';

import { type BoardSummary, ROOT_BOARD_TITLE, childrenOf } from '@tablero/shared';

import type { SyncState } from '@/collab/BoardSession';

const BOARDS_KEY = 'tablero:boards:v1';
const LAST_BOARD_KEY = 'tablero:lastBoard:v1';
const USER_KEY = 'tablero:user:v1';

export type AppUser = { id: string; email: string; name: string };

export const LOCAL_USER: AppUser = { id: 'local-user', email: '', name: 'Local' };

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sin almacenamiento: el estado sigue vivo en memoria
  }
}

export function loadPersistedBoards(): BoardSummary[] {
  const stored = readStorage<BoardSummary[]>(BOARDS_KEY, []);
  return Array.isArray(stored) ? stored.filter((board) => !!board && typeof board.id === 'string') : [];
}

export function persistBoards(boards: BoardSummary[]): void {
  writeStorage(BOARDS_KEY, boards);
}

export function loadPersistedUser(): AppUser {
  const stored = readStorage<AppUser | null>(USER_KEY, null);
  return stored && typeof stored.id === 'string' ? stored : LOCAL_USER;
}

export function persistUser(user: AppUser): void {
  writeStorage(USER_KEY, user);
}

export function readLastBoardId(): string | null {
  const value = readStorage<string | null>(LAST_BOARD_KEY, null);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function writeLastBoardId(boardId: string): void {
  writeStorage(LAST_BOARD_KEY, boardId);
}

export type AppState = {
  user: AppUser;
  boards: BoardSummary[];
  currentBoardId: string | null;
  apiOnline: boolean;
  syncState: SyncState;
  /** Aviso sobrio (por ejemplo, la API no responde). Nunca bloquea la app. */
  notice: string | null;
  booting: boolean;
  /** La API está viva pero pide sesión: toca mostrar el acceso. */
  authRequired: boolean;

  setUser(user: AppUser): void;
  setBoards(boards: BoardSummary[]): void;
  upsertBoard(board: BoardSummary): void;
  removeBoard(boardId: string): void;
  setCurrentBoard(boardId: string | null): void;
  setApiOnline(online: boolean): void;
  setSyncState(state: SyncState): void;
  setNotice(notice: string | null): void;
  setBooting(booting: boolean): void;
  setAuthRequired(authRequired: boolean): void;
};

export const useAppStore = create<AppState>()((set, get) => ({
  user: loadPersistedUser(),
  boards: loadPersistedBoards(),
  currentBoardId: null,
  apiOnline: false,
  syncState: 'connecting',
  notice: null,
  booting: true,
  authRequired: false,

  setUser(user) {
    persistUser(user);
    set({ user });
  },
  setBoards(boards) {
    persistBoards(boards);
    set({ boards });
  },
  upsertBoard(board) {
    const boards = get().boards;
    const index = boards.findIndex((item) => item.id === board.id);
    const next = index >= 0 ? boards.map((item) => (item.id === board.id ? { ...item, ...board } : item)) : [...boards, board];
    persistBoards(next);
    set({ boards: next });
  },
  removeBoard(boardId) {
    const next = get().boards.filter((board) => board.id !== boardId);
    persistBoards(next);
    set({ boards: next });
  },
  setCurrentBoard(boardId) {
    if (boardId) writeLastBoardId(boardId);
    set({ currentBoardId: boardId });
  },
  setApiOnline(online) {
    if (get().apiOnline === online) return;
    set({ apiOnline: online });
  },
  setSyncState(state) {
    if (get().syncState === state) return;
    set({ syncState: state });
  },
  setNotice(notice) {
    if (get().notice === notice) return;
    set({ notice });
  },
  setBooting(booting) {
    set({ booting });
  },
  setAuthRequired(authRequired) {
    if (get().authRequired === authRequired) return;
    set({ authRequired });
  },
}));

export function boardById(boards: BoardSummary[], boardId: string | null): BoardSummary | null {
  if (!boardId) return null;
  return boards.find((board) => board.id === boardId) ?? null;
}

export function childBoards(boards: BoardSummary[], parentId: string | null): BoardSummary[] {
  return childrenOf(boards, parentId);
}

/** Tablero raíz creado localmente cuando no hay servidor. */
export function localBoard(id: string, title = ROOT_BOARD_TITLE, parentBoardId: string | null = null): BoardSummary {
  const now = Date.now();
  return {
    id,
    ownerId: LOCAL_USER.id,
    parentBoardId,
    title,
    icon: null,
    color: null,
    coverImageId: null,
    isTemplate: false,
    publishedSlug: null,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    // Un tablero creado en este navegador (`bd_…`) es del usuario local: su rol
    // es dueño, o la matriz de capacidades lo dejaría solo lectura por `role`
    // ausente. Los tableros del servidor que aún no se pudieron leer conservan
    // el rol desconocido (no se presume propiedad ajena).
    role: id.startsWith('bd_') ? 'owner' : undefined,
  };
}

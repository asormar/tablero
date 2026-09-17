/**
 * Vista pública de un tablero: `/p/:slug` (punto 3 de la fase 5).
 *
 * Decisiones de la fase que se ven acá:
 *   - **Solo lectura y sin sesión**: se lee `GET /api/public/boards/:slug` (con
 *     `?password=` cuando haga falta) y `…/document`; no hay barra de
 *     herramientas, ni edición, ni selección, ni socket.
 *   - **Refresco cada 15 s**: el documento se vuelve a pedir y se fusiona (es una
 *     unión de CRDTs, así que repetirlo no pisa nada).
 *   - **Subtableros navegables** si el ajuste de la publicación los incluye.
 *   - La ruta manda `noindex`.
 */

import { Suspense, lazy, useEffect, useRef, useState } from 'react';

import { Eye, Globe, Lock, RefreshCw } from 'lucide-react';

import { fetchPublicBoard, fetchPublicDocument, type PublicBoard } from '@/api/sharing';
import { Canvas } from '@/canvas/Canvas';
import { BoardSession } from '@/collab/BoardSession';
import { SessionProvider, useSessionLayout, useSessionStatus } from '@/collab/SessionContext';
import { useNoindex } from '@/lib/noindex';
import { publicBoardUrl } from '@/lib/routes';
import { useUiStore } from '@/state/uiStore';

const LazyZoomControl = lazy(async () => {
  const module = await import('@/chrome/ZoomControl');
  return { default: module.ZoomControl };
});

const REFRESH_MS = 15_000;

export function PublicBoardPage({ slug }: { slug: string }): JSX.Element {
  useNoindex();
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  // La carga inicial (y cada reintento) resuelve los metadatos; la contraseña se
  // manda solo si el usuario la escribió.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchPublicBoard(slug, submitted || undefined)
      .then((result) => {
        if (cancelled) return;
        setBoard(result);
        setNeedsPassword(result.requiresPassword);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setBoard(null);
        const message = cause instanceof Error ? cause.message : 'No se pudo abrir el tablero publicado';
        // 401/403 con contraseña pedida, 404 si no existe o está despublicado.
        if (/contrase|password|401|403/i.test(message)) setNeedsPassword(true);
        else setNeedsPassword(false);
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, submitted, reloadToken]);

  if (needsPassword && !board) {
    return (
      <div className="public-page public-page--gate">
        <form
          className="public-gate"
          data-public-gate
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(password);
          }}
        >
          <h1 className="public-gate__title">
            <Lock size={16} /> Tablero protegido
          </h1>
          <p className="public-gate__text">
            Esta publicación pide contraseña. Escribila para verla en solo lectura.
          </p>
          <input
            className="public-gate__input"
            type="password"
            aria-label="Contraseña de la publicación"
            data-public-password
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
          <button type="submit" className="public-gate__submit" data-public-submit>
            Ver el tablero
          </button>
          {error ? <p className="public-gate__error" data-public-error>{error}</p> : null}
        </form>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="public-page public-page--empty">
        <div className="public-empty" data-public-missing>
          <Globe size={18} />
          <h1 className="public-empty__title">Este tablero no está disponible</h1>
          <p className="public-empty__text">
            {error ?? 'El enlace puede estar mal, o el tablero dejó de estar publicado.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <PublicBoardView
      key={`${board.slug}`}
      board={board}
      password={submitted}
      onRefresh={() => setReloadToken((token) => token + 1)}
      refreshing={loading}
    />
  );
}

function PublicBoardView({
  board,
  password,
  onRefresh,
  refreshing,
}: {
  board: PublicBoard;
  password: string;
  onRefresh: () => void;
  refreshing: boolean;
}): JSX.Element {
  // La sesión se arma dentro del efecto (y no con `useMemo`) para que el doble
  // montaje de React en desarrollo no deje una sesión destruida: cada montaje
  // crea la suya y la descarta al desmontarse. Con `useMemo`, el primer cleanup
  // destruía la sesión y el segundo `init()` salía por `destroyed`, así que la
  // vista pública se quedaba en «Cargando el tablero publicado…».
  const [session, setSession] = useState<BoardSession | null>(null);

  useEffect(() => {
    const created = new BoardSession({
      boardId: `public:${board.slug}`,
      connect: false,
      readOnly: true,
      documentSource: () => fetchPublicDocument(board.slug, password || undefined),
    });
    setSession(created);
    void created.init();
    return () => {
      created.destroy();
      setSession(null);
    };
  }, [board.slug, password]);

  // Refresco cada 15 s: la vista pública no tiene socket (decisión de la fase).
  useEffect(() => {
    if (!session) return undefined;
    const timer = setInterval(() => {
      void session.refreshDocument();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    useUiStore.getState().resetWorkspace();
  }, [session]);

  if (!session) return <></>;

  return (
    <SessionProvider session={session}>
      <div className="public-page" data-public-board={board.slug}>
        <header className="public-topbar">
          <span className="public-topbar__title">
            {board.icon ? <span className="public-topbar__icon">{board.icon}</span> : null}
            {board.title}
          </span>
          <span className="public-topbar__badge" data-public-readonly>
            <Eye size={13} /> Solo lectura
          </span>
          <button
            type="button"
            className="public-topbar__refresh"
            title="Refrescar ahora"
            data-public-refresh
            onClick={onRefresh}
          >
            <RefreshCw size={13} className={refreshing ? 'spin' : undefined} />
          </button>
          {board.requiresPassword ? (
            <span className="public-topbar__lock" title="Publicación protegida con contraseña">
              <Lock size={12} />
            </span>
          ) : null}
        </header>

        {board.children.length > 0 ? (
          <nav className="public-subboards" aria-label="Subtableros publicados" data-public-children={board.children.length}>
            {board.children.map((child) => (
              <a key={child.slug} className="public-subboards__link" href={publicBoardUrl(child.slug)}>
                {child.icon ? `${child.icon} ` : ''}
                {child.title}
              </a>
            ))}
          </nav>
        ) : null}

        <div className="public-canvas" data-public-canvas>
          <PublicCanvas session={session} />
          <Suspense fallback={null}>
            <LazyZoomControl session={session} />
          </Suspense>
          <PublicStatus />
        </div>
      </div>
    </SessionProvider>
  );
}

function PublicCanvas({ session }: { session: BoardSession }): JSX.Element {
  const layout = useSessionLayout();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || layout.length === 0) return;
    fitted.current = true;
    const node = document.querySelector('[data-public-canvas]') as HTMLElement | null;
    const width = node?.clientWidth ?? 1280;
    const height = node?.clientHeight ?? 720;
    const bounds = session.bounds();
    if (!bounds) return;
    const scale = Math.min(1.4, Math.max(0.1, Math.min(width / bounds.width, height / bounds.height) * 0.92));
    useUiStore.getState().setViewport({
      x: bounds.x + bounds.width / 2 - width / (2 * scale),
      y: bounds.y + bounds.height / 2 - height / (2 * scale),
      scale,
    });
  }, [layout.length, session]);

  return <Canvas session={session} onOpenBoard={() => undefined} readOnly />;
}

/** Estado de carga/error de la vista pública (nunca deja la pantalla vacía sin explicar). */
function PublicStatus(): JSX.Element | null {
  const status = useSessionStatus();
  if (status.state === 'saved') return null;
  const label =
    status.state === 'connecting' ? 'Cargando el tablero publicado…' : 'Sin conexión: se muestra la última copia recibida.';
  return (
    <p className="public-status" role="status" data-public-status={status.state}>
      {label}
    </p>
  );
}

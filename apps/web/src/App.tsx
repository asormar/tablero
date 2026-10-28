/**
 * Raíz de la aplicación: decide qué pantalla montar según la ruta.
 *
 *   /              → espacio de trabajo (o el acceso, si la API pide sesión)
 *   /p/:slug       → vista pública en solo lectura, sin sesión (fase 5)
 *   /invite/:token → aceptación de una invitación (fase 5)
 *
 * La ruta se resuelve una sola vez, antes de montar el espacio de trabajo: la
 * vista pública y la invitación no comparten estado con él (y no deben montarlo).
 */

import { Suspense, useMemo } from 'react';

import { Workspace } from '@/app/Workspace';
import { ToastHost } from '@/chrome/ToastHost';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { parseRoute } from '@/lib/routes';
import { useAppStore } from '@/state/appStore';

// Las pantallas que no son el espacio de trabajo (vista pública, invitación y
// acceso) se descargan solo cuando la ruta o la API las pide.
const LazyPublicBoardPage = lazyWithReload(async () => {
  const module = await import('@/public/PublicBoardPage');
  return { default: module.PublicBoardPage };
});
const LazyAcceptInvitePage = lazyWithReload(async () => {
  const module = await import('@/invite/AcceptInvitePage');
  return { default: module.AcceptInvitePage };
});
const LazyAuthPanel = lazyWithReload(async () => {
  const module = await import('@/chrome/AuthPanel');
  return { default: module.AuthPanel };
});

/** Pantalla de carga mientras llega el chunk (misma pieza que el arranque del tablero). */
function LoadingFallback(): JSX.Element {
  return (
    <div className="boot" role="status">
      <div className="boot__card">
        <span className="boot__spinner" aria-hidden="true" />
        <p className="boot__text">Cargando…</p>
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  // Los avisos viven en la raíz: así también se ven en la vista pública, en la
  // invitación y en el panel de acceso, no solo en el espacio de trabajo.
  return (
    <>
      <RoutedScreen />
      <ToastHost />
    </>
  );
}

function RoutedScreen(): JSX.Element {
  const route = useMemo(() => parseRoute(window.location.pathname), []);

  if (route.kind === 'public') {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <LazyPublicBoardPage slug={route.slug} />
      </Suspense>
    );
  }
  if (route.kind === 'invite') {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <LazyAcceptInvitePage token={route.token} />
      </Suspense>
    );
  }

  // El panel de acceso solo aparece cuando la API está viva y pide sesión. Sin
  // servidor no tiene sentido pedir credenciales: la app arranca en local.
  return <WorkspaceOrAuth />;
}

function WorkspaceOrAuth(): JSX.Element {
  const authRequired = useAppStore((state) => state.authRequired);
  if (!authRequired) return <Workspace />;
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LazyAuthPanel />
    </Suspense>
  );
}

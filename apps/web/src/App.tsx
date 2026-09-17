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

import { useMemo } from 'react';

import { Workspace } from '@/app/Workspace';
import { AuthPanel } from '@/chrome/AuthPanel';
import { AcceptInvitePage } from '@/invite/AcceptInvitePage';
import { parseRoute } from '@/lib/routes';
import { PublicBoardPage } from '@/public/PublicBoardPage';
import { useAppStore } from '@/state/appStore';

export function App(): JSX.Element {
  const route = useMemo(() => parseRoute(window.location.pathname), []);

  if (route.kind === 'public') return <PublicBoardPage slug={route.slug} />;
  if (route.kind === 'invite') return <AcceptInvitePage token={route.token} />;

  // El panel de acceso solo aparece cuando la API está viva y pide sesión. Sin
  // servidor no tiene sentido pedir credenciales: la app arranca en local.
  return <WorkspaceOrAuth />;
}

function WorkspaceOrAuth(): JSX.Element {
  const authRequired = useAppStore((state) => state.authRequired);
  return authRequired ? <AuthPanel /> : <Workspace />;
}

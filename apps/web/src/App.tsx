import { Workspace } from '@/app/Workspace';
import { AuthPanel } from '@/chrome/AuthPanel';
import { useAppStore } from '@/state/appStore';

export function App(): JSX.Element {
  // El panel de acceso solo aparece cuando la API está viva y pide sesión. Sin
  // servidor no tiene sentido pedir credenciales: la app arranca en local.
  const authRequired = useAppStore((state) => state.authRequired);
  return authRequired ? <AuthPanel /> : <Workspace />;
}

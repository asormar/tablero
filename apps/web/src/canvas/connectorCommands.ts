/**
 * Comandos de conectores (fase 7).
 *
 * Borrar el conector seleccionado vivía dentro de `ConnectorLayer.tsx` (un
 * componente): acá queda como lógica pura —sin DOM ni React— para poder
 * probarla. El borrado va en **una sola** transacción de Yjs: un `Deshacer`
 * devuelve la flecha entera, no a medias.
 */

import { removeConnectors } from '@/lib/connectors';
import type { BoardSession } from '@/collab/BoardSession';
import { useUiStore } from '@/state/uiStore';

/**
 * Borra el conector seleccionado (lo usan `Supr`/`Backspace` y la barra del
 * conector). Devuelve `false` si no había ninguno seleccionado, para que el
 * llamante pueda seguir con el borrado normal de tarjetas.
 */
export function deleteSelectedConnector(session: BoardSession): boolean {
  const id = useUiStore.getState().selectedConnectorId;
  if (!id) return false;
  removeConnectors(session.doc, [id], session.origin);
  useUiStore.getState().setSelectedConnector(null);
  return true;
}

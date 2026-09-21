/**
 * Comandos de conectores (fase 7).
 *
 * Borrar los conectores seleccionados vivía dentro de `ConnectorLayer.tsx` (un
 * componente): acá queda como lógica pura —sin DOM ni React— para poder
 * probarla. El borrado va en **una sola** transacción de Yjs: un `Deshacer`
 * devuelve las flechas enteras, no a medias. La selección puede traer varios
 * (el lazo del lienzo selecciona por geometría): se borran todos juntos.
 */

import { removeConnectors } from '@/lib/connectors';
import type { BoardSession } from '@/collab/BoardSession';
import { useUiStore } from '@/state/uiStore';

/**
 * Borra los conectores seleccionados (lo usan `Supr`/`Backspace` y la barra del
 * conector). Devuelve cuántos borró, para que el llamante pueda seguir con el
 * borrado normal de tarjetas.
 */
export function deleteSelectedConnectors(session: BoardSession): number {
  const ids = useUiStore.getState().selectedConnectorIds;
  if (ids.length === 0) return 0;
  removeConnectors(session.doc, ids, session.origin);
  useUiStore.getState().setSelectedConnectors([]);
  return ids.length;
}

/**
 * Igual que `deleteSelectedConnectors`, con el contrato booleano de siempre
 * (`true` si había algo seleccionado y se borró).
 */
export function deleteSelectedConnector(session: BoardSession): boolean {
  return deleteSelectedConnectors(session) > 0;
}

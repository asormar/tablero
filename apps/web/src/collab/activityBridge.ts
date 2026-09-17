/**
 * Puente de actividad: reporta lo que se hace en el tablero (punto 7).
 *
 * Las superficies del lienzo no deberían conocer la API ni el store de avisos;
 * acá se resuelve el id del tablero a partir de la sesión y se llama al
 * reportador por lotes. Nunca lanza y nunca bloquea: el registro es para leer.
 */

import { reportActivity, type ReportActivityInput } from '@/api/activity';
import type { BoardSession } from '@/collab/BoardSession';
import { useAppStore } from '@/state/appStore';

/** Reporta una acción del tablero de la sesión. */
export function reportBoardActivity(session: BoardSession, entry: ReportActivityInput): void {
  reportActivity(session.boardId, entry, (message) => useAppStore.getState().setNotice(message));
}

/** Reporta una acción sobre un tablero concreto (sin sesión a mano). */
export function reportBoardActivityById(
  boardId: string | null | undefined,
  entry: ReportActivityInput,
): void {
  reportActivity(boardId ?? null, entry, (message) => useAppStore.getState().setNotice(message));
}

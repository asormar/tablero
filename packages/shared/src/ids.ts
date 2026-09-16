/** Identificadores de elementos, tableros y conectores. */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Id corto, ordenable por tiempo (prefijo timestamp base36) y único en la práctica. */
export function createId(prefix?: string): string {
  const time = Date.now().toString(36);
  let rand = '';
  for (let i = 0; i < 8; i += 1) {
    rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return prefix ? `${prefix}_${time}${rand}` : `${time}${rand}`;
}

export const createElementId = () => createId('el');
export const createConnectorId = () => createId('cn');
export const createBoardId = () => createId('bd');

/** Identidad de origen de las transacciones locales (undo/rehacer propio). */
export const localOrigin = Symbol('tablero/local');
export type LocalOrigin = typeof localOrigin;

/**
 * Aviso que sobrevive a la recarga del historial de versiones.
 *
 * Restaurar una instantánea recarga la página (el documento vivo se reconstruye
 * desde el estado persistido), así que el mensaje de confirmación se guarda acá
 * y el espacio de trabajo lo muestra al volver. Vive en su propio módulo para
 * que el panel (carga diferida) y el espacio de trabajo no se importen entre sí.
 */

export const RELOAD_NOTICE_KEY = 'tablero:reload-notice';

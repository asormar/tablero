/**
 * Selector de archivos del sistema.
 *
 * Un `<input type="file">` temporal (nunca añadido al DOM visible) evita el
 * diálogo nativo desde la interfaz: el mismo camino sirve para el clic de la
 * barra lateral y para el botón «Elegir archivo» de una tarjeta vacía.
 */

export type PickKind = 'image' | 'video' | 'audio' | 'file' | 'any';

const ACCEPT: Record<PickKind, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  file: '*/*',
  any: '*/*',
};

/** Abre el diálogo y resuelve con los archivos elegidos ([] si se cancela). */
export function pickFiles(kind: PickKind = 'any', multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT[kind];
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.style.opacity = '0';
    document.body.appendChild(input);

    let settled = false;
    const finish = (files: File[]): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => {
      finish(Array.from(input.files ?? []));
    });
    // `cancel` no está en todos los navegadores: se limpia al perder el foco.
    input.addEventListener('cancel', () => finish([]));
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!settled && (input.files?.length ?? 0) === 0) finish([]);
        }, 400);
      },
      { once: true },
    );

    input.click();
  });
}

/**
 * Contadores de rendimiento (solo desarrollo).
 *
 * El overlay de desarrollo muestra cuántas tarjetas se han renderizado en el
 * último frame y cuántas siguen montadas: es la forma de comprobar que mover
 * una nota no re-renderiza las otras 299.
 */

type Stats = {
  elementRenders: number;
  layerRenders: number;
  mounted: number;
  visible: number;
  frames: number;
  fps: number;
  lastFrameRenders: number;
};

export const renderStats: Stats = {
  elementRenders: 0,
  layerRenders: 0,
  mounted: 0,
  visible: 0,
  frames: 0,
  fps: 0,
  lastFrameRenders: 0,
};

export const isDevBuild = import.meta.env.DEV;

/** Llamado por cada tarjeta en cada render (no-op en producción). */
export function countElementRender(): void {
  if (!isDevBuild) return;
  renderStats.elementRenders += 1;
}

export function countLayerRender(): void {
  if (!isDevBuild) return;
  renderStats.layerRenders += 1;
}

export function setMounted(visible: number, mounted: number): void {
  if (!isDevBuild) return;
  renderStats.visible = visible;
  renderStats.mounted = mounted;
}

/** Cierra el frame: fija renders/frame y FPS. Devuelve el resumen. */
export function endFrame(deltaMs: number): Stats {
  if (!isDevBuild) return renderStats;
  renderStats.lastFrameRenders = renderStats.elementRenders;
  renderStats.elementRenders = 0;
  renderStats.frames += 1;
  if (deltaMs > 0) {
    const instant = 1000 / deltaMs;
    renderStats.fps = renderStats.fps === 0 ? instant : renderStats.fps * 0.85 + instant * 0.15;
  }
  return renderStats;
}

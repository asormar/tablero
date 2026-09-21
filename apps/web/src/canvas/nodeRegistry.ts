/**
 * Registro de nodos del DOM por id de elemento.
 *
 * Durante un arrastre se escribe directamente sobre estos nodos (transform,
 * width) sin pasar por el estado de React: así 300 tarjetas se mueven a 60 fps
 * y solo se commitea a Yjs al soltar.
 */

const nodes = new Map<string, HTMLElement>();

export function registerNode(id: string, node: HTMLElement | null): void {
  if (node) nodes.set(id, node);
  else nodes.delete(id);
}

export function getNode(id: string): HTMLElement | null {
  return nodes.get(id) ?? null;
}

export function mountedNodeCount(): number {
  return nodes.size;
}

export function setNodeTransform(id: string, x: number, y: number): void {
  const node = nodes.get(id);
  if (!node) return;
  node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

export function setNodeWidth(id: string, width: number): void {
  const node = nodes.get(id);
  if (!node) return;
  node.style.width = `${width}px`;
}

/**
 * Alto en vivo del tirador de esquina. Solo se escribe en tarjetas con alto
 * propio en el documento (mapa, dibujo): las de alto automático lo sacan de su
 * contenido y escribir un alto a mano lo dejaría pegado tras el gesto.
 */
export function setNodeHeight(id: string, height: number): void {
  const node = nodes.get(id);
  if (!node) return;
  node.style.height = `${height}px`;
}

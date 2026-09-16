/**
 * Paleta de una imagen: cuantización a cubos de color con recuento.
 *
 * La parte pura (`paletteFromPixels`) recibe los píxeles ya leídos; la parte de
 * navegador (`extractPalette`) dibuja la imagen en un canvas fuera de pantalla y
 * le pasa los píxeles. Nada de esto viaja al documento: solo los HEX que el
 * usuario decide convertir en muestras.
 */

import { normalizeColor } from '@tablero/shared';

export type PaletteEntry = { hex: string; count: number; ratio: number };

type Bucket = { r: number; g: number; b: number; count: number };

function toHex(r: number, g: number, b: number): string {
  const part = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/** Cubo de 5 bits por canal: agrupa tonos parecidos sin fundir colores distintos. */
function bucketKey(r: number, g: number, b: number): number {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

/**
 * Colores dominantes de una lista de píxeles (RGBA plano). Se descartan los
 * casi transparentes y los grises muy claros u oscuros solo si no aportan nada
 * (`keepNeutrals` permite conservarlos: una foto en blanco y negro tiene paleta).
 */
export function paletteFromPixels(
  data: ArrayLike<number>,
  options: { count?: number; step?: number; alphaThreshold?: number } = {},
): PaletteEntry[] {
  const wanted = Math.max(1, options.count ?? 5);
  const alphaThreshold = options.alphaThreshold ?? 16;
  const totalPixels = Math.floor(data.length / 4);
  if (totalPixels === 0) return [];
  // Muestreo: en imágenes grandes no hace falta mirar todos los píxeles.
  const requested = options.step ?? Math.max(1, Math.floor(totalPixels / 12000));

  const buckets = new Map<number, Bucket>();
  let counted = 0;
  for (let index = 0; index < totalPixels; index += requested) {
    const offset = index * 4;
    const alpha = data[offset + 3] ?? 255;
    if (alpha < alphaThreshold) continue;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    const key = bucketKey(r, g, b);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
    counted += 1;
  }
  if (counted === 0) return [];

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  const merged: Bucket[] = [];
  for (const bucket of sorted) {
    const r = bucket.r / bucket.count;
    const g = bucket.g / bucket.count;
    const b = bucket.b / bucket.count;
    // Tonos casi idénticos se funden en uno medio: una foto no necesita cinco
    // chips que se ven igual.
    const near = merged.find((entry) => {
      const dr = entry.r / entry.count - r;
      const dg = entry.g / entry.count - g;
      const db = entry.b / entry.count - b;
      return Math.sqrt(dr * dr + dg * dg + db * db) < 28;
    });
    if (near) {
      near.r += bucket.r;
      near.g += bucket.g;
      near.b += bucket.b;
      near.count += bucket.count;
      continue;
    }
    merged.push({ ...bucket });
    if (merged.length > wanted * 4) break;
  }
  merged.sort((a, b) => b.count - a.count);

  const result: PaletteEntry[] = [];
  for (const bucket of merged) {
    if (result.length >= wanted) break;
    const hex = toHex(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count);
    result.push({ hex, count: bucket.count, ratio: bucket.count / counted });
  }
  return result;
}

/** Paleta de una imagen ya cargada (navegador). Devuelve [] si no se puede leer. */
export function extractPalette(
  source: HTMLImageElement | HTMLCanvasElement,
  count = 5,
): PaletteEntry[] {
  try {
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    if (width <= 0 || height <= 0) return [];
    const maxSide = 160;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return paletteFromPixels(image.data, { count, step: 1 });
  } catch {
    // Imagen de otro origen sin CORS: el canvas queda contaminado.
    return [];
  }
}

/** Paleta a partir de una URL (para la tarjeta y el visor). Nunca lanza. */
export async function paletteFromUrl(url: string, count = 5): Promise<PaletteEntry[]> {
  const image = await loadImage(url);
  if (!image) return [];
  return extractPalette(image, count);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Normaliza un HEX de la paleta (guarda contra datos raros del canvas). */
export function safePaletteHex(hex: string): string {
  return normalizeColor(hex) ?? '#000000';
}

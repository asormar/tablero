/**
 * Iconos de la extensión, sin dependencias.
 *
 * Se dibuja a mano (cuadrado redondeado azul con una flecha que cae en una
 * bandeja) y se codifica un PNG RGBA con `node:zlib`. Se generan una vez y
 * quedan versionados en `icons/`; `pnpm --filter @tablero/extension icons` los
 * rehace si hace falta.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

/** Tamaños que pide el manifiesto. */
export const ICON_SIZES = [16, 32, 48, 128];

/** Color de marca de la web de Tablero (`theme_color` de la PWA). */
const BRAND = [47, 111, 201];
const WHITE = [255, 255, 255];

/** Muestras por eje: 4x4 por píxel para que los bordes no queden dentados. */
const SAMPLES = 4;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filtro «None»
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Cuadrado redondeado con un margen chico, en coordenadas 0..1. */
function insideBackground(u, v) {
  const margin = 0.02;
  const min = margin;
  const max = 1 - margin;
  if (u < min || u > max || v < min || v > max) return false;
  const radius = 0.2;
  const dx = Math.max(min + radius - u, 0, u - (max - radius));
  const dy = Math.max(min + radius - v, 0, v - (max - radius));
  return dx * dx + dy * dy <= radius * radius;
}

/** Flecha hacia abajo que entra en una bandeja (el gesto de «guardar acá»). */
function insideGlyph(u, v) {
  // Bandeja: base y dos paredes cortas.
  if (u >= 0.22 && u <= 0.78 && v >= 0.66 && v <= 0.74) return true;
  if (v >= 0.5 && v <= 0.74 && ((u >= 0.22 && u <= 0.3) || (u >= 0.7 && u <= 0.78))) return true;
  // Asta de la flecha.
  if (u >= 0.45 && u <= 0.55 && v >= 0.2 && v <= 0.46) return true;
  // Punta de la flecha: triángulo con vértice abajo, apoyado en la bandeja.
  const apex = { u: 0.5, v: 0.6 };
  const left = { u: 0.3, v: 0.42 };
  const right = { u: 0.7, v: 0.42 };
  const sign = (a, b, c) => (a.u - c.u) * (b.v - c.v) - (b.u - c.u) * (a.v - c.v);
  const point = { u, v };
  const d1 = sign(point, left, apex);
  const d2 = sign(point, right, left);
  const d3 = sign(point, apex, right);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function sampleColor(u, v) {
  if (!insideBackground(u, v)) return [0, 0, 0, 0];
  if (insideGlyph(u, v)) return [...WHITE, 255];
  return [...BRAND, 255];
}

export function renderIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  const total = SAMPLES * SAMPLES;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const u = (x + (sx + 0.5) / SAMPLES) / size;
          const v = (y + (sy + 0.5) / SAMPLES) / size;
          const [cr, cg, cb, ca] = sampleColor(u, v);
          r += cr;
          g += cg;
          b += cb;
          a += ca;
        }
      }
      const index = (y * size + x) * 4;
      rgba[index] = Math.round(r / total);
      rgba[index + 1] = Math.round(g / total);
      rgba[index + 2] = Math.round(b / total);
      rgba[index + 3] = Math.round(a / total);
    }
  }
  return encodePng(size, size, rgba);
}

/** Escribe los cuatro PNG en `targetDir` (los crea si no existen). */
export function writeIcons(targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const written = [];
  for (const size of ICON_SIZES) {
    const file = join(targetDir, `icon-${size}.png`);
    writeFileSync(file, renderIcon(size));
    written.push(file);
  }
  return written;
}

const here = dirname(fileURLToPath(import.meta.url));
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  for (const file of writeIcons(join(here, '..', 'icons'))) {
    console.log(`icono escrito: ${file}`);
  }
}

/**
 * Genera los iconos PNG de la PWA (sin dependencias de imagen): dibuja el
 * símbolo del tablero (tarjetas blancas sobre el azul de acento) y arma el PNG
 * a mano con `zlib`. Se corre con `node scripts/generate-icons.mjs`.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');

const ACCENT = [47, 111, 201];
const CARD = [255, 255, 255];
const CARD_SOFT = [222, 234, 251];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filtro None
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeCanvas(size) {
  return { size, pixels: Buffer.alloc(size * size * 4) };
}

function blend(canvas, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const index = (y * canvas.size + x) * 4;
  const a = Math.max(0, Math.min(1, alpha));
  const current = canvas.pixels;
  for (let channel = 0; channel < 3; channel += 1) {
    current[index + channel] = Math.round(
      current[index + channel] * (1 - a) + color[channel] * a,
    );
  }
  current[index + 3] = Math.max(current[index + 3], Math.round(255 * a));
}

function roundedRect(canvas, rect, radius, color) {
  const { x, y, width, height } = rect;
  for (let py = Math.floor(y); py < Math.ceil(y + height); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + width); px += 1) {
      const dx = Math.max(x + radius - px, 0, px - (x + width - radius - 1));
      const dy = Math.max(y + radius - py, 0, py - (y + height - radius - 1));
      const distance = Math.max(dx, dy);
      if (distance <= 0) {
        blend(canvas, px, py, color, 1);
        continue;
      }
      const inside = Math.hypot(dx, dy) <= radius;
      if (inside) blend(canvas, px, py, color, 1);
    }
  }
}

/** Dibuja el símbolo: fondo redondeado + tres tarjetas. */
function drawIcon(size, { maskable = false } = {}) {
  const canvas = makeCanvas(size);
  const pad = maskable ? size * 0.18 : size * 0.06;
  roundedRect(canvas, { x: pad, y: pad, width: size - pad * 2, height: size - pad * 2 }, size * 0.2, ACCENT);

  const scale = size * (maskable ? 0.5 : 0.62);
  const left = (size - scale) / 2;
  const top = (size - scale) / 2 + size * 0.02;
  const cardW = scale * 0.46;
  const cardH = scale * 0.34;
  const gap = scale * 0.08;
  const radius = Math.max(2, scale * 0.06);

  roundedRect(canvas, { x: left, y: top, width: cardW, height: cardH }, radius, CARD);
  roundedRect(canvas, { x: left + cardW + gap, y: top, width: cardW, height: cardH }, radius, CARD_SOFT);
  roundedRect(canvas, { x: left, y: top + cardH + gap, width: scale, height: cardH * 0.8 }, radius, CARD);
  return encodePng(size, size, canvas.pixels);
}

mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
];
for (const [name, size, options] of targets) {
  const png = drawIcon(size, options);
  writeFileSync(join(outDir, name), png);
  console.log(`${name}: ${png.length} bytes`);
}

/**
 * Copia los estáticos al `dist/` que deja `tsc`: manifiesto, popup (HTML y CSS)
 * e iconos. Al terminar, `dist/` es una extensión sin empaquetar cargable.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ICON_SIZES, writeIcons } from './make-icons.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const iconsDir = join(root, 'icons');

const STATIC_FILES = ['manifest.json', 'popup.html', 'popup.css'];

function ensureIcons() {
  const missing = ICON_SIZES.filter((size) => !existsSync(join(iconsDir, `icon-${size}.png`)));
  if (missing.length === 0) return;
  console.log(`generando iconos faltantes: ${missing.join(', ')}`);
  writeIcons(iconsDir);
}

function listFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...listFiles(full));
    else found.push(relative(dist, full).replaceAll('\\', '/'));
  }
  return found.sort();
}

if (!existsSync(dist)) {
  console.error(`Falta ${dist}: corré primero «tsc -p tsconfig.build.json» (lo hace «pnpm build»).`);
  process.exit(1);
}

mkdirSync(dist, { recursive: true });
for (const file of STATIC_FILES) {
  const source = join(root, file);
  if (!existsSync(source)) {
    console.error(`Falta ${source}`);
    process.exit(1);
  }
  cpSync(source, join(dist, file));
  console.log(`copiado: ${file}`);
}

ensureIcons();
cpSync(iconsDir, join(dist, 'icons'), { recursive: true });
console.log('copiado: icons/');

const files = listFiles(dist);
console.log(`\nExtensión lista para cargar sin empaquetar: ${dist}`);
console.log(`Archivos (${files.length}):`);
for (const file of files) console.log(`  - ${file}`);

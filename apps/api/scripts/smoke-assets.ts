/**
 * Prueba de humo de los archivos de la fase 2 (queda en el repo).
 *
 *   # con la API, Postgres y MinIO levantados:
 *   pnpm --filter @tablero/api smoke:assets
 *
 * Verifica, con ejecución real (HTTP + S3 + Postgres):
 *   1. Subida multipart de imagen, vídeo, audio, PDF, texto, SVG y GIF, con sus
 *      metadatos (tipo, MIME, tamaño, medidas, duración) y miniatura WEBP.
 *   2. Orientación EXIF (una imagen con orientación 6 responde con medidas
 *      intercambiadas y miniatura vertical).
 *   3. `/raw` responde 302 a una URL firmada y los bytes descargados son
 *      idénticos; `?download=1` fuerza `Content-Disposition: attachment`.
 *   4. `/thumb` responde 302 (miniatura propia u original) y la miniatura de
 *      imagen es WEBP de 480 px de ancho.
 *   5. Dedupe: el mismo archivo dos veces → 201 y después 200 con el mismo id.
 *   6. Aislamiento entre usuarios: otro usuario recibe 404 en detalle, raw, thumb
 *      y delete.
 *   7. Rechazo 413 de un archivo que supera MAX_UPLOAD_MB (con `Content-Length`
 *      y también por streaming sin `Content-Length`), y 400 sin archivo.
 *   8. DELETE borra la fila y los objetos del almacenamiento.
 *
 * Los archivos de prueba se generan al vuelo con `ffmpeg` y `sharp` y se borran
 * al terminar. Necesita `ffmpeg`/`ffprobe` en el PATH.
 *
 * OJO con MAX_UPLOAD_MB: la prueba de tamaño genera un archivo 1,5 veces más
 * grande que el límite. Con el valor por defecto (500) son ~750 MB de disco; para
 * una prueba rápida arrancá la API con un límite chico:
 *
 *   MAX_UPLOAD_MB=2 pnpm --filter @tablero/api start
 *   pnpm --filter @tablero/api smoke:assets
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { assetRoutes } from '@tablero/shared';
import sharp from 'sharp';

import { env, loadDotEnv } from '../src/env.js';
import { deleteObject, headObject } from '../src/lib/storage.js';

loadDotEnv();

const API_URL = process.env.API_URL ?? 'http://localhost:8787';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';
/** Límite del `.env`; el vigente lo publica `GET /api/health`. */
const ENV_MAX_UPLOAD_MB = env.maxUploadMb;
const KEEP_FIXTURES = process.env.KEEP_FIXTURES === '1';
const STAMP = Date.now();

const prisma = new PrismaClient();
const checks: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
}

function ok(name: string, detail = ''): void {
  record(name, true, detail);
}

function fail(name: string, detail = ''): void {
  record(name, false, detail);
}

/** Ejecuta una comprobación y registra el resultado (una excepción = FAIL). */
async function check(name: string, run: () => Promise<string> | string): Promise<void> {
  try {
    const detail = await run();
    record(name, true, detail);
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// ---------------------------------------------------------------------------
// Cliente HTTP con cookie de sesión
// ---------------------------------------------------------------------------

type HttpResult = { status: number; headers: Headers; body: Buffer; json: unknown };

class SessionClient {
  private cookie: string | null = null;

  constructor(readonly label: string) {}

  /** Cookie de sesión tal como viaja en la cabecera (para cuerpos a mano). */
  get cookieHeader(): string {
    return this.cookie ?? '';
  }

  async fetch(path: string, init: RequestInit = {}): Promise<HttpResult> {
    const headers = new Headers(init.headers);
    headers.set('origin', APP_ORIGIN);
    if (this.cookie) headers.set('cookie', this.cookie);
    const response = await fetch(`${API_URL}${path}`, { ...init, headers, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    const session = setCookie.find((value) => value.startsWith(env.sessionCookieName));
    if (session) this.cookie = session.split(';')[0] ?? this.cookie;
    const body = Buffer.from(await response.arrayBuffer());
    let json: unknown = null;
    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      try {
        json = JSON.parse(body.toString('utf8'));
      } catch {
        json = null;
      }
    }
    return { status: response.status, headers: response.headers, body, json };
  }

  async json<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
    const result = await this.fetch(path, init);
    return { status: result.status, data: (result.json ?? {}) as T };
  }

  async register(email: string, name: string): Promise<string> {
    const { status, data } = await this.json<{ user?: { id: string } }>('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name, password: 'smoke-assets-2026' }),
    });
    assert.equal(status, 201, `registro de ${email} → ${status}`);
    const id = data.user?.id;
    assert.ok(id, 'el registro no devolvió user.id');
    return id;
  }

  upload(path: string, bytes: Buffer, fileName: string, mime: string, fields: Record<string, string> = {}): Promise<HttpResult> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), fileName);
    return this.fetch(path, { method: 'POST', body: form });
  }
}

// ---------------------------------------------------------------------------
// Archivos de prueba
// ---------------------------------------------------------------------------

function ffmpeg(args: string[]): void {
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`ffmpeg falló (${args.join(' ')}): ${result.error?.message ?? result.stderr}`);
  }
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#2563eb"/></svg>\n`;
const PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj
trailer << /Root 1 0 R >>
%%EOF
`;

type Fixtures = {
  workDir: string;
  png: Buffer;
  jpg: Buffer;
  orientedJpg: Buffer;
  mp4: Buffer;
  wav: Buffer;
  mp3WithCover: Buffer;
  gif: Buffer;
  svg: Buffer;
  pdf: Buffer;
  txt: Buffer;
  oversize: Buffer;
};

async function buildFixtures(maxUploadMb: number): Promise<Fixtures> {
  const workDir = await mkdtemp(join(tmpdir(), 'tablero-smoke-assets-'));
  const at = (name: string) => join(workDir, name);

  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=1', '-frames:v', '1', at('prueba.png')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=1', '-frames:v', '1', at('prueba.jpg')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15', '-t', '2', '-pix_fmt', 'yuv420p', at('prueba.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', at('audio.wav')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=200x150:rate=5', '-t', '1', at('prueba.gif')]);
  // MP3 con portada incrustada (ID3 APIC): el audio también puede tener miniatura.
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame', at('audio.mp3')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=600x600:rate=1', '-frames:v', '1', at('cover.jpg')]);
  ffmpeg([
    '-i', at('audio.mp3'),
    '-i', at('cover.jpg'),
    '-map', '0:a',
    '-map', '1:v',
    '-c:a', 'copy',
    '-c:v', 'copy',
    '-id3v2_version', '3',
    at('con-portada.mp3'),
  ]);

  // JPEG con orientación EXIF 6 (girada 90°): el servidor debe devolver
  // 480x640 al orientarla y una miniatura vertical.
  const jpg = await readFile(at('prueba.jpg'));
  const orientedJpg = await sharp(jpg).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  await writeFile(at('orientada.jpg'), orientedJpg);

  await writeFile(at('logo.svg'), SVG, 'utf8');
  await writeFile(at('documento.pdf'), PDF, 'utf8');
  await writeFile(at('notas.txt'), 'Apuntes del tablero\n', 'utf8');

  // Archivo por encima del límite (1,5 veces + 512 KB) para las pruebas de
  // rechazo: supera el corte temprano por `Content-Length` y, sin cabecera, el
  // corte del flujo en vivo.
  const oversizeBytes = Math.ceil(maxUploadMb * 1.5 * 1024 * 1024) + 512 * 1024;
  console.log(`Archivos de prueba en ${workDir} (el archivo grande ocupa ${(oversizeBytes / 1024 / 1024).toFixed(1)} MB)`);
  const oversize = randomBytes(oversizeBytes);
  await writeFile(at('grande.bin'), oversize);

  return {
    workDir,
    png: await readFile(at('prueba.png')),
    jpg,
    orientedJpg,
    mp4: await readFile(at('prueba.mp4')),
    wav: await readFile(at('audio.wav')),
    mp3WithCover: await readFile(at('con-portada.mp3')),
    gif: await readFile(at('prueba.gif')),
    svg: Buffer.from(SVG, 'utf8'),
    pdf: Buffer.from(PDF, 'utf8'),
    txt: Buffer.from('Apuntes del tablero\n', 'utf8'),
    oversize,
  };
}

// ---------------------------------------------------------------------------
// Helpers de aserción
// ---------------------------------------------------------------------------

type AssetJson = {
  id: string;
  type: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  originalName: string;
  createdAt: number;
  url: string;
  thumbnailUrl: string | null;
};

function assetOf(body: unknown): AssetJson {
  const asset = (body as { asset?: AssetJson }).asset;
  assert.ok(asset && typeof asset.id === 'string', `respuesta sin asset: ${JSON.stringify(body).slice(0, 200)}`);
  return asset;
}

function errorCode(body: unknown): string {
  return String((body as { code?: unknown }).code ?? '');
}

async function signedRedirect(client: SessionClient, path: string): Promise<string> {
  const result = await client.fetch(path);
  assert.equal(result.status, 302, `${path} → ${result.status} (se esperaba 302)`);
  const location = result.headers.get('location');
  assert.ok(location, `${path} sin cabecera location`);
  assert.ok(location.includes('X-Amz-Signature'), `la URL de ${path} no está firmada: ${location.slice(0, 120)}`);
  assert.ok(location.startsWith(env.s3.endpoint), `la URL de ${path} no apunta al almacenamiento: ${location.slice(0, 120)}`);
  return location;
}

async function download(url: string): Promise<{ status: number; contentType: string; body: Buffer }> {
  const response = await fetch(url, { redirect: 'follow' });
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body: Buffer.from(await response.arrayBuffer()),
  };
}

// ---------------------------------------------------------------------------
// Programa
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const health = await fetch(`${API_URL}/api/health`);
  assert.equal(health.status, 200, 'la API no responde en /api/health');
  const healthData = (await health.json()) as { maxUploadMb?: number };
  // El límite vigente lo publica la propia API: el smoke no lo duplica a mano.
  const maxUploadMb = typeof healthData.maxUploadMb === 'number' ? healthData.maxUploadMb : ENV_MAX_UPLOAD_MB;
  console.log(`API: ${API_URL} · límite de subida: ${maxUploadMb} MB · origen: ${APP_ORIGIN}`);
  if (maxUploadMb > 20) {
    console.log('OJO: con este límite la prueba de rechazo genera un archivo grande; para una corrida rápida arrancá la API con MAX_UPLOAD_MB=2');
  }

  const fixtures = await buildFixtures(maxUploadMb);
  const alice = new SessionClient('alice');
  const bob = new SessionClient('bob');
  const aliceId = await alice.register(`smoke-assets-a-${STAMP}@tablero.test`, 'Alice Smoke');
  const bobId = await bob.register(`smoke-assets-b-${STAMP}@tablero.test`, 'Bob Smoke');
  ok('registro de dos usuarios', `alice=${aliceId} bob=${bobId}`);

  // --- imagen PNG ---------------------------------------------------------
  let pngAsset!: AssetJson;
  await check('subida PNG (201, metadatos y medidas)', async () => {
    const result = await alice.upload('/api/assets', fixtures.png, 'prueba.png', 'image/png');
    assert.equal(result.status, 201, `respuesta ${result.status}: ${result.body.toString('utf8').slice(0, 200)}`);
    const asset = assetOf(result.json);
    assert.equal(asset.type, 'image');
    assert.equal(asset.mime, 'image/png');
    assert.equal(asset.size, fixtures.png.length);
    assert.equal(asset.width, 640);
    assert.equal(asset.height, 480);
    assert.equal(asset.duration, null);
    assert.equal(asset.originalName, 'prueba.png');
    assert.equal(asset.url, assetRoutes.raw(asset.id));
    assert.equal(asset.thumbnailUrl, assetRoutes.thumb(asset.id));
    assert.ok(asset.createdAt > 0);
    pngAsset = asset;
    return `id=${asset.id} ${asset.mime} ${asset.size} B ${asset.width}x${asset.height}`;
  });

  await check('fila en Postgres con sha256 y claves de S3', async () => {
    const row = await prisma.asset.findUniqueOrThrow({ where: { id: pngAsset.id } });
    assert.equal(row.ownerId, aliceId);
    assert.equal(row.sha256, sha256(fixtures.png));
    assert.equal(row.storageKey, `assets/${aliceId}/${pngAsset.id}.png`);
    assert.equal(row.thumbnailKey, `thumbs/${aliceId}/${pngAsset.id}.webp`);
    const head = await headObject(row.storageKey);
    assert.ok(head, 'el objeto original no está en S3');
    assert.equal(head.size, fixtures.png.length);
    return `storageKey=${row.storageKey} sha256=${row.sha256?.slice(0, 12)}…`;
  });

  await check('/raw → 302 firmado y bytes idénticos', async () => {
    const location = await signedRedirect(alice, `/api/assets/${pngAsset.id}/raw`);
    const downloaded = await download(location);
    assert.equal(downloaded.status, 200);
    assert.equal(sha256(downloaded.body), sha256(fixtures.png));
    return `${downloaded.body.length} B idénticos (${downloaded.contentType})`;
  });

  await check('/raw?download=1 fuerza la descarga', async () => {
    const location = await signedRedirect(alice, `/api/assets/${pngAsset.id}/raw?download=1`);
    assert.ok(
      decodeURIComponent(location).includes('response-content-disposition=attachment'),
      'la URL firmada no lleva Content-Disposition de descarga',
    );
    const downloaded = await download(location);
    assert.equal(downloaded.status, 200);
    return 'Content-Disposition presente en la URL firmada';
  });

  await check('/thumb → 302 y miniatura WEBP de 480 px', async () => {
    const location = await signedRedirect(alice, `/api/assets/${pngAsset.id}/thumb`);
    assert.ok(location.includes('/thumbs/'), `la miniatura no sale de thumbs/: ${location.slice(0, 120)}`);
    const downloaded = await download(location);
    assert.equal(downloaded.status, 200);
    assert.ok(downloaded.contentType.includes('image/webp'), `content-type ${downloaded.contentType}`);
    const metadata = await sharp(downloaded.body).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 480);
    assert.equal(metadata.height, 360);
    return `webp ${metadata.width}x${metadata.height} ${downloaded.body.length} B`;
  });

  await check('GET /api/assets/:id devuelve el mismo resumen', async () => {
    const { status, data } = await alice.json<{ asset: AssetJson }>(`/api/assets/${pngAsset.id}`);
    assert.equal(status, 200);
    assert.deepEqual(data.asset, pngAsset);
    return 'coincide con la subida';
  });

  await check('dedupe: la segunda subida responde 200 con el mismo id', async () => {
    const result = await alice.upload('/api/assets', fixtures.png, 'prueba.png', 'image/png');
    assert.equal(result.status, 200, `respuesta ${result.status}`);
    assert.equal(assetOf(result.json).id, pngAsset.id);
    const count = await prisma.asset.count({ where: { ownerId: aliceId, sha256: sha256(fixtures.png) } });
    assert.equal(count, 1, `hay ${count} filas para el mismo contenido`);
    return 'sin fila duplicada';
  });

  await check('dedupe: con dedupe=false sube otra copia', async () => {
    const result = await alice.upload('/api/assets', fixtures.png, 'prueba.png', 'image/png', { dedupe: 'false' });
    assert.equal(result.status, 201, `respuesta ${result.status}`);
    const copy = assetOf(result.json);
    assert.notEqual(copy.id, pngAsset.id);
    await prisma.asset.delete({ where: { id: copy.id } }); // limpieza de la copia
    return `copia=${copy.id}`;
  });

  // --- JPEG con orientación EXIF -----------------------------------------
  let orientedAsset!: AssetJson;
  await check('JPEG con orientación EXIF 6 (medidas intercambiadas + miniatura vertical)', async () => {
    const result = await alice.upload('/api/assets', fixtures.orientedJpg, 'orientada.jpg', 'image/jpeg');
    assert.equal(result.status, 201, `respuesta ${result.status}: ${result.body.toString('utf8').slice(0, 200)}`);
    orientedAsset = assetOf(result.json);
    assert.equal(orientedAsset.width, 480);
    assert.equal(orientedAsset.height, 640);
    const location = await signedRedirect(alice, `/api/assets/${orientedAsset.id}/thumb`);
    const downloaded = await download(location);
    const metadata = await sharp(downloaded.body).metadata();
    assert.equal(metadata.width, 480);
    assert.equal(metadata.height, 640);
    return `resumen ${orientedAsset.width}x${orientedAsset.height}, miniatura ${metadata.width}x${metadata.height}`;
  });

  // --- vídeo y audio ------------------------------------------------------
  let videoAsset!: AssetJson;
  await check('vídeo MP4 (duración con ffprobe y miniatura con ffmpeg)', async () => {
    const result = await alice.upload('/api/assets', fixtures.mp4, 'prueba.mp4', 'video/mp4');
    assert.equal(result.status, 201, `respuesta ${result.status}: ${result.body.toString('utf8').slice(0, 200)}`);
    videoAsset = assetOf(result.json);
    assert.equal(videoAsset.type, 'video');
    assert.equal(videoAsset.width, 320);
    assert.equal(videoAsset.height, 240);
    assert.ok(videoAsset.duration !== null && Math.abs(videoAsset.duration - 2) < 0.2, `duración ${videoAsset.duration}`);
    assert.equal(videoAsset.thumbnailUrl, assetRoutes.thumb(videoAsset.id));
    const location = await signedRedirect(alice, `/api/assets/${videoAsset.id}/thumb`);
    const downloaded = await download(location);
    const metadata = await sharp(downloaded.body).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 320);
    return `duración=${videoAsset.duration}s miniatura ${metadata.width}x${metadata.height} webp`;
  });

  let audioAsset!: AssetJson;
  await check('audio WAV (duración sin miniatura)', async () => {
    const result = await alice.upload('/api/assets', fixtures.wav, 'audio.wav', 'audio/wav');
    assert.equal(result.status, 201, `respuesta ${result.status}: ${result.body.toString('utf8').slice(0, 200)}`);
    audioAsset = assetOf(result.json);
    assert.equal(audioAsset.type, 'audio');
    assert.ok(audioAsset.duration !== null && Math.abs(audioAsset.duration - 3) < 0.2, `duración ${audioAsset.duration}`);
    assert.equal(audioAsset.thumbnailUrl, null);
    // Sin miniatura, /thumb sirve el original (302, nunca 404).
    const location = await signedRedirect(alice, `/api/assets/${audioAsset.id}/thumb`);
    const downloaded = await download(location);
    assert.equal(sha256(downloaded.body), sha256(fixtures.wav));
    return `duración=${audioAsset.duration}s y /thumb devuelve el original`;
  });

  await check('audio MP3 con portada incrustada (miniatura con ffmpeg)', async () => {
    const result = await alice.upload('/api/assets', fixtures.mp3WithCover, 'con-portada.mp3', 'audio/mpeg');
    assert.equal(result.status, 201, `respuesta ${result.status}: ${result.body.toString('utf8').slice(0, 200)}`);
    const asset = assetOf(result.json);
    assert.equal(asset.type, 'audio');
    assert.ok(asset.duration !== null && Math.abs(asset.duration - 2) < 0.2, `duración ${asset.duration}`);
    assert.equal(asset.thumbnailUrl, assetRoutes.thumb(asset.id));
    const location = await signedRedirect(alice, `/api/assets/${asset.id}/thumb`);
    assert.ok(location.includes('/thumbs/'), `la portada no sale de thumbs/: ${location.slice(0, 120)}`);
    const downloaded = await download(location);
    const metadata = await sharp(downloaded.body).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 480);
    return `duración=${asset.duration}s miniatura ${metadata.width}x${metadata.height} webp`;
  });

  // --- archivos sin procesamiento ----------------------------------------
  await check('PDF y TXT: tipo file, sin medidas ni duración', async () => {
    const pdf = await alice.upload('/api/assets', fixtures.pdf, 'documento.pdf', 'application/pdf');
    assert.equal(pdf.status, 201);
    const pdfAsset = assetOf(pdf.json);
    assert.equal(pdfAsset.type, 'file');
    assert.equal(pdfAsset.mime, 'application/pdf');
    assert.equal(pdfAsset.width, null);
    assert.equal(pdfAsset.thumbnailUrl, null);
    const location = await signedRedirect(alice, `/api/assets/${pdfAsset.id}/thumb`);
    const downloaded = await download(location);
    assert.equal(sha256(downloaded.body), sha256(fixtures.pdf));

    // Sin `type` en la parte: el MIME se deduce del nombre (curl haría lo mismo).
    const txt = await alice.upload('/api/assets', fixtures.txt, 'notas.txt', 'application/octet-stream');
    assert.equal(txt.status, 201);
    const txtAsset = assetOf(txt.json);
    assert.equal(txtAsset.type, 'file');
    assert.equal(txtAsset.mime, 'text/plain');
    return `pdf=${pdfAsset.id} txt=${txtAsset.id} (mime deducido: ${txtAsset.mime})`;
  });

  await check('SVG y GIF: se guardan tal cual y /thumb devuelve el original', async () => {
    const svg = assetOf((await alice.upload('/api/assets', fixtures.svg, 'logo.svg', 'image/svg+xml')).json);
    assert.equal(svg.type, 'image');
    assert.equal(svg.mime, 'image/svg+xml');
    assert.equal(svg.thumbnailUrl, assetRoutes.thumb(svg.id));
    const svgRow = await prisma.asset.findUniqueOrThrow({ where: { id: svg.id } });
    assert.equal(svgRow.thumbnailKey, null, 'el SVG no debe tener miniatura propia');
    const svgDownload = await download(await signedRedirect(alice, `/api/assets/${svg.id}/thumb`));
    assert.equal(sha256(svgDownload.body), sha256(fixtures.svg));
    assert.ok(svgDownload.contentType.includes('image/svg+xml'), `content-type ${svgDownload.contentType}`);
    // El original de un SVG se sirve como descarga: un SVG puede traer <script>
    // y abrirlo en una pestaña lo ejecutaría en el origen del almacenamiento.
    const svgRaw = await signedRedirect(alice, `/api/assets/${svg.id}/raw`);
    assert.ok(
      svgRaw.includes('response-content-disposition=') && svgRaw.includes('attachment'),
      `el original del SVG debería forzar descarga: ${svgRaw.slice(0, 140)}`,
    );

    const gif = assetOf((await alice.upload('/api/assets', fixtures.gif, 'prueba.gif', 'image/gif')).json);
    assert.equal(gif.type, 'image');
    const gifRow = await prisma.asset.findUniqueOrThrow({ where: { id: gif.id } });
    assert.equal(gifRow.thumbnailKey, null, 'el GIF no debe tener miniatura propia');
    const gifDownload = await download(await signedRedirect(alice, `/api/assets/${gif.id}/thumb`));
    assert.equal(sha256(gifDownload.body), sha256(fixtures.gif));
    assert.ok(gifDownload.contentType.includes('image/gif'), `content-type ${gifDownload.contentType}`);
    const gifRaw = await signedRedirect(alice, `/api/assets/${gif.id}/raw`);
    assert.ok(!gifRaw.includes('response-content-disposition'), 'el GIF sí se sirve en línea');
    return `svg medidas=${svg.width}x${svg.height} (original como descarga) · gif medidas=${gif.width}x${gif.height}`;
  });

  // --- listado y boardId --------------------------------------------------
  await check('listado por usuario, filtros de tipo y de tablero', async () => {
    const board = await alice.json<{ board: { id: string } }>('/api/boards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Smoke assets' }),
    });
    const boardId = board.data.board.id;
    // Contenido único: si no, el dedupe devolvería el TXT subido antes.
    const taggedBytes = Buffer.from(`Apuntes del tablero\nSubida con tablero ${STAMP}\n`, 'utf8');
    const tagged = await alice.upload('/api/assets', taggedBytes, 'con-tablero.txt', 'text/plain', { boardId });
    assert.equal(tagged.status, 201, `subida con boardId → ${tagged.status}`);
    assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: assetOf(tagged.json).id } })).boardId, boardId);

    const all = await alice.json<{ assets: AssetJson[] }>('/api/assets');
    assert.equal(all.status, 200);
    assert.ok(all.data.assets.length >= 6, `solo ${all.data.assets.length} assets`);
    const ids = all.data.assets.map((asset) => asset.id);
    assert.ok(ids.includes(pngAsset.id), 'falta el PNG en el listado');
    for (let index = 1; index < all.data.assets.length; index += 1) {
      const previous = all.data.assets[index - 1]!;
      const current = all.data.assets[index]!;
      assert.ok(previous.createdAt >= current.createdAt, 'el listado no está ordenado por fecha descendente');
    }

    const images = await alice.json<{ assets: AssetJson[] }>('/api/assets?type=image');
    assert.ok(images.data.assets.length > 0 && images.data.assets.every((asset) => asset.type === 'image'));

    const byBoard = await alice.json<{ assets: AssetJson[] }>(`/api/assets?boardId=${boardId}`);
    assert.equal(byBoard.data.assets.length, 1);
    assert.equal(byBoard.data.assets[0]!.id, assetOf(tagged.json).id);
    return `${all.data.assets.length} assets · ${images.data.assets.length} imágenes · ${byBoard.data.assets.length} del tablero`;
  });

  await check('boardId ajeno → 404', async () => {
    const bobBoards = await bob.json<{ boards: { id: string }[] }>('/api/auth/me');
    const bobRoot = bobBoards.data.boards[0]?.id;
    assert.ok(bobRoot, 'Bob no tiene tableros');
    const result = await alice.upload('/api/assets', fixtures.txt, 'ajeno.txt', 'text/plain', { boardId: bobRoot });
    assert.equal(result.status, 404, `respuesta ${result.status}`);
    return errorCode(result.json);
  });

  // --- aislamiento entre usuarios ----------------------------------------
  await check('otro usuario: 404 en detalle, raw, thumb y delete', async () => {
    const statuses: number[] = [];
    for (const path of [
      `/api/assets/${pngAsset.id}`,
      `/api/assets/${pngAsset.id}/raw`,
      `/api/assets/${pngAsset.id}/thumb`,
    ]) {
      statuses.push((await bob.fetch(path)).status);
    }
    statuses.push((await bob.fetch(`/api/assets/${pngAsset.id}`, { method: 'DELETE' })).status);
    assert.deepEqual(statuses, [404, 404, 404, 404], `status ${statuses.join(', ')}`);
    assert.ok(await prisma.asset.findUnique({ where: { id: pngAsset.id } }), 'el asset ajeno se borró');
    const bobList = await bob.json<{ assets: AssetJson[] }>('/api/assets');
    assert.ok(!bobList.data.assets.some((asset) => asset.id === pngAsset.id), 'Bob ve un asset de Alice');
    return `status ${statuses.join(', ')} · el asset sigue existiendo`;
  });

  // --- límites de la subida ----------------------------------------------
  await check(`rechazo 413 del archivo de ${(fixtures.oversize.length / 1024 / 1024).toFixed(1)} MB (declara Content-Length)`, async () => {
    // Con un cuerpo grande `fetch` se queda sin respuesta (el servidor corta la
    // conexión al rechazar), así que acá se usa curl, que negocia el cuerpo con
    // `Expect: 100-continue` y recibe el 413 limpio.
    const payloadPath = join(fixtures.workDir, 'rechazo.json');
    const curl = spawnSync(
      'curl',
      [
        '-s',
        '-o',
        payloadPath,
        '-w',
        '%{http_code}',
        '-b',
        alice.cookieHeader,
        '-H',
        `origin: ${APP_ORIGIN}`,
        '-F',
        `file=@${join(fixtures.workDir, 'grande.bin')};type=application/octet-stream`,
        `${API_URL}/api/assets`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(curl.status, 0, `curl falló: ${curl.stderr}`);
    const status = Number.parseInt(curl.stdout.trim(), 10);
    const payload = await readFile(payloadPath, 'utf8').catch(() => '');
    assert.equal(status, 413, `respuesta ${status}: ${payload.slice(0, 200)}`);
    assert.ok(payload.includes('file_too_large'), `cuerpo ${payload.slice(0, 200)}`);
    return (JSON.parse(payload) as { error?: string }).error ?? '';
  });

  await check('rechazo 413 por streaming (sin Content-Length, cuerpo en trozos)', async () => {
    const boundary = '----tablero-smoke-boundary';
    const head = Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="stream.bin"\r\ncontent-type: application/octet-stream\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const chunk = Buffer.alloc(64 * 1024, 7);
    const chunks = Math.ceil(fixtures.oversize.length / chunk.length);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(head);
        for (let index = 0; index < chunks; index += 1) controller.enqueue(chunk);
        controller.enqueue(tail);
        controller.close();
      },
    });
    let status = 0;
    let payload = '';
    try {
      const response = await fetch(`${API_URL}/api/assets`, {
        method: 'POST',
        headers: {
          origin: APP_ORIGIN,
          cookie: alice.cookieHeader,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        duplex: 'half',
        redirect: 'manual',
      } as RequestInit);
      status = response.status;
      payload = await response.text();
    } catch (error) {
      throw new Error(`la petición falló antes de leer la respuesta: ${error instanceof Error ? error.message : String(error)}`);
    }
    assert.equal(status, 413, `respuesta ${status}: ${payload.slice(0, 200)}`);
    assert.ok(payload.includes('file_too_large'), `cuerpo ${payload.slice(0, 200)}`);
    return `${chunks} trozos de 64 KB`;
  });

  await check('subida sin archivo → 400 file_missing', async () => {
    const form = new FormData();
    form.set('boardId', 'no-importa');
    const result = await alice.fetch('/api/assets', { method: 'POST', body: form });
    assert.equal(result.status, 400, `respuesta ${result.status}`);
    assert.equal(errorCode(result.json), 'file_missing');
    return 'sin campo file';
  });

  await check('sin sesión → 401', async () => {
    const anonymous = new SessionClient('anon');
    const { status } = await anonymous.json(`/api/assets/${pngAsset.id}`);
    assert.equal(status, 401, `respuesta ${status}`);
    return 'GET /api/assets/:id sin cookie';
  });

  // --- borrado ------------------------------------------------------------
  await check('DELETE borra la fila y los objetos del almacenamiento', async () => {
    const keys = [`assets/${aliceId}/${orientedAsset.id}.jpg`, `thumbs/${aliceId}/${orientedAsset.id}.webp`];
    for (const key of keys) assert.ok(await headObject(key), `falta el objeto ${key} antes de borrar`);

    const deleted = await alice.json(`/api/assets/${orientedAsset.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.data, { ok: true });

    assert.equal((await alice.fetch(`/api/assets/${orientedAsset.id}`)).status, 404);
    assert.equal((await alice.fetch(`/api/assets/${orientedAsset.id}/raw`)).status, 404);
    assert.equal((await alice.fetch(`/api/assets/${orientedAsset.id}/thumb`)).status, 404);
    assert.equal(await prisma.asset.findUnique({ where: { id: orientedAsset.id } }), null);
    for (const key of keys) assert.equal(await headObject(key), null, `el objeto ${key} sigue en S3`);
    return `borrados ${keys.length} objetos + fila`;
  });

  await check('el borrado no afecta a los demás assets', async () => {
    const stillThere = await alice.fetch(`/api/assets/${videoAsset.id}/raw`);
    assert.equal(stillThere.status, 302, `respuesta ${stillThere.status}`);
    return `vídeo ${videoAsset.id} sigue disponible`;
  });

  // --- limpieza -----------------------------------------------------------
  const leftovers = await prisma.asset.findMany({ where: { ownerId: { in: [aliceId, bobId] } } });
  for (const asset of leftovers) {
    if (asset.thumbnailKey) await deleteObject(asset.thumbnailKey).catch(() => undefined);
    await deleteObject(asset.storageKey).catch(() => undefined);
  }
  await prisma.user.delete({ where: { id: aliceId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: bobId } }).catch(() => undefined);
  console.log(`Limpieza: ${leftovers.length} assets (filas y objetos) y 2 usuarios borrados`);
  if (!KEEP_FIXTURES) await rm(fixtures.workDir, { recursive: true, force: true });
  else console.log(`fixtures conservados en ${fixtures.workDir}`);

  const passed = checks.filter((entry) => entry.ok).length;
  const failed = checks.length - passed;
  console.log(`\n${passed}/${checks.length} comprobaciones PASS${failed > 0 ? ` · ${failed} FAIL` : ''}`);
  for (const entry of checks.filter((item) => !item.ok)) console.log(`  FAIL — ${entry.name} :: ${entry.detail}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error('La prueba de humo no pudo completarse:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

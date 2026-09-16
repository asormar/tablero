/**
 * Metadatos Open Graph de enlaces externos (`GET /api/link-preview`).
 *
 * Sin dependencias: fetch + parseo de `<meta>` con expresiones regulares.
 * Guardas: solo http/https, se resuelve el DNS antes de pedir (bloqueo de
 * direcciones privadas), se siguen a mano hasta 3 redirecciones revalidando
 * cada destino y se corta el cuerpo en 512 KB.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { detectEmbed, type LinkEmbedType } from '@tablero/shared';

import { badRequest, HttpError } from './errors.js';

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 6000;
const USER_AGENT = 'TableroBot/0.1 (+https://github.com/tablero)';

export type LinkPreviewData = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  siteName: string | null;
  embedType: LinkEmbedType;
  /** URL lista para `<iframe>` (misma detección que usa la web al pegar el enlace). */
  embedUrl: string | null;
  fetchedAt: number;
};

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  const [a = -1, b = -1] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
    if (normalized.startsWith('fe80')) return true; // link-local
    if (normalized.startsWith('::ffff:')) return isPrivateIPv4(normalized.slice(7));
    return false;
  }
  return true;
}

/** Verifica que el host resuelva a direcciones públicas. */
async function assertPublicHost(hostname: string): Promise<void> {
  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost' || lowered.endsWith('.localhost') || lowered.endsWith('.local')) {
    throw badRequest('El host no es accesible públicamente', 'link_preview_forbidden_host');
  }
  if (isIP(lowered)) {
    if (isPrivateAddress(lowered)) {
      throw badRequest('El host no es accesible públicamente', 'link_preview_forbidden_host');
    }
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(lowered, { all: true });
  } catch {
    throw badRequest('No se pudo resolver el dominio', 'link_preview_dns_error');
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw badRequest('El host no es accesible públicamente', 'link_preview_forbidden_host');
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, '&')
    .trim();
}

function metaContent(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      const value = decodeEntities(match[1]);
      if (value.length > 0) return value;
    }
  }
  return null;
}

function pageTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) return null;
  const value = decodeEntities(match[1].replace(/\s+/g, ' '));
  return value.length > 0 ? value.slice(0, 300) : null;
}

function faviconFor(html: string, base: URL): string | null {
  const match = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i.exec(html);
  if (match?.[0]) {
    const href = /href=["']([^"']+)["']/i.exec(match[0])?.[1];
    // Los `data:` (favicon incrustado o el `data:,` que usa example.com) no
    // son una URL útil para la tarjeta: se cae al /favicon.ico del sitio.
    if (href && !href.startsWith('data:')) {
      try {
        return new URL(href, base).toString();
      } catch {
        /* ignora hrefs inválidos */
      }
    }
  }
  try {
    return new URL('/favicon.ico', base.origin).toString();
  } catch {
    return null;
  }
}

function absolute(value: string | null, base: URL): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

// La detección de incrustados vive en `@tablero/shared` (`detectEmbed`): la API y
// la web comparten la misma tabla de proveedores, así el `embedType` que guarda
// la previsualización coincide con el reproductor que muestra la web.

async function readLimitedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
    if (total >= MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

async function fetchHtml(start: URL): Promise<{ html: string; finalUrl: URL }> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(current.hostname);
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw badRequest('Redirección sin destino', 'link_preview_bad_redirect');
      current = new URL(location, current);
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        throw badRequest('Redirección a un protocolo no soportado', 'link_preview_bad_redirect');
      }
      continue;
    }
    if (!response.ok) {
      throw badRequest(`El sitio respondió ${response.status}`, 'link_preview_http_error');
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) {
      throw badRequest('El recurso no es HTML', 'link_preview_not_html');
    }
    return { html: await readLimitedBody(response), finalUrl: current };
  }
  throw badRequest('Demasiadas redirecciones', 'link_preview_too_many_redirects');
}

/** Descarga y normaliza los metadatos de un enlace. */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewData> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw badRequest('URL inválida', 'link_preview_invalid_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('Solo se admiten http y https', 'link_preview_invalid_protocol');
  }

  let page: { html: string; finalUrl: URL };
  try {
    page = await fetchHtml(parsed);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Red caída, TLS, DNS, timeout: es un fallo del destino, no nuestro.
    throw new HttpError(502, `No se pudo descargar el enlace: ${(error as Error).message}`, 'link_preview_unreachable');
  }
  const { html, finalUrl } = page;
  const title = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title') ?? pageTitle(html);
  const embed = detectEmbed(finalUrl.toString());
  return {
    url: finalUrl.toString(),
    title,
    description:
      metaContent(html, 'og:description') ?? metaContent(html, 'twitter:description') ?? metaContent(html, 'description'),
    imageUrl: absolute(metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image'), finalUrl),
    faviconUrl: faviconFor(html, finalUrl),
    siteName: metaContent(html, 'og:site_name') ?? finalUrl.hostname.replace(/^www\./, ''),
    embedType: embed.embedType,
    embedUrl: embed.embedUrl,
    fetchedAt: Date.now(),
  };
}

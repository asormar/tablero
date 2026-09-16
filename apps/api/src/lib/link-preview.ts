/**
 * Metadatos Open Graph de enlaces externos (`GET /api/link-preview`).
 *
 * Sin dependencias de parseo: `node:http(s)` + parseo de `<meta>` con
 * expresiones regulares. Guardas contra SSRF:
 *
 * - Solo http/https.
 * - El host se normaliza con ipaddr.js antes de clasificarlo: formas no
 *   canónicas (`2130706433`, `0x7f.0.0.1`, octal, `127.1`, `[::1]`,
 *   IPv4-mapped) caen en el rango correcto.
 * - El DNS se resuelve UNA sola vez (`dns.lookup` con `all: true`), se validan
 *   TODAS las direcciones y la conexión va a una IP ya validada: el socket no
 *   vuelve a resolver, así que un DNS rebind entre la validación y el pedido no
 *   puede colar una IP privada (ni los metadatos de la nube).
 * - Se siguen a mano hasta 3 redirecciones revalidando cada destino.
 * - El cuerpo se corta en 512 KB.
 *
 * El `lookup` y el transporte son inyectables (`fetchLinkPreview(url, deps)`)
 * para poder testear el caso de rebind sin salir a la red.
 */

import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';

import ipaddr from 'ipaddr.js';

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

/** Dirección resuelta y validada: a esta IP se conecta, sin volver a resolver. */
export type ResolvedAddress = { address: string; family: number };

/** Resolución DNS inyectable (en producción: `dns.lookup` con `all: true`). */
export type LinkPreviewLookup = (hostname: string) => Promise<ResolvedAddress[]>;

/** Respuesta mínima del transporte (HTTP real o un doble en los tests). */
export type LinkPreviewResponse = {
  status: number;
  location: string | null;
  contentType: string | null;
  /** Cuerpo ya cortado a `MAX_BYTES`. */
  body: string;
};

export type LinkPreviewTransport = (url: URL, address: ResolvedAddress) => Promise<LinkPreviewResponse>;

export type LinkPreviewDeps = {
  lookup?: LinkPreviewLookup;
  transport?: LinkPreviewTransport;
};

function forbiddenHost(): HttpError {
  return badRequest('El host no es accesible públicamente', 'link_preview_forbidden_host');
}

/**
 * IP del host cuando es un literal. Acepta corchetes de IPv6 y las formas no
 * canónicas que ipaddr.js normaliza (entero, hex, octal, `a.b`, `a.b.c`).
 */
function parseHostAddress(hostname: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  const bare = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (bare.length === 0 || !ipaddr.isValid(bare)) return null;
  return ipaddr.parse(bare);
}

/**
 * ¿Es una dirección enrutable públicamente? `range()` solo devuelve `unicast`
 * para lo público: loopback, privado, link-local, ULA, reservado, multicast,
 * broadcast, carrier-grade NAT, 6to4, teredo y demás rangos especiales quedan
 * afuera.
 */
export function isPublicAddress(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return false;
  }
  if (parsed instanceof ipaddr.IPv6) {
    // `::ffff:a.b.c.d` se clasifica por su IPv4 subyacente (127.0.0.1 incluido).
    if (parsed.isIPv4MappedAddress()) return isPublicAddress(parsed.toIPv4Address().toString());
    // El rango obsoleto `::/96` (IPv4-compatible) figura como unicast pero
    // algunos sistemas lo resuelven contra IPv4: se rechaza entero.
    if (parsed.parts.slice(0, 6).every((part) => part === 0)) return false;
  }
  return parsed.range() === 'unicast';
}

/**
 * Resuelve el host una sola vez y valida TODAS las direcciones; devuelve la
 * que la conexión debe usar (una IP, nunca el nombre: eso cierra el TOCTOU).
 */
async function resolvePublicAddress(hostname: string, lookup: LinkPreviewLookup): Promise<ResolvedAddress> {
  const literal = parseHostAddress(hostname);
  if (literal) {
    const address = literal.toString();
    if (!isPublicAddress(address)) throw forbiddenHost();
    return { address, family: literal.kind() === 'ipv6' ? 6 : 4 };
  }

  const lowered = hostname.trim().toLowerCase();
  if (lowered === 'localhost' || lowered.endsWith('.localhost') || lowered.endsWith('.local')) {
    throw forbiddenHost();
  }

  let answers: LookupAddress[];
  try {
    answers = await lookup(lowered);
  } catch {
    throw badRequest('No se pudo resolver el dominio', 'link_preview_dns_error');
  }
  if (answers.length === 0) throw forbiddenHost();
  for (const answer of answers) {
    if (!isPublicAddress(answer.address)) throw forbiddenHost();
  }
  // Todas son públicas: se fija la primera y la conexión no vuelve a resolver.
  const chosen = answers[0]!;
  return { address: chosen.address, family: chosen.family };
}

/**
 * `lookup` del socket: entrega SIEMPRE la IP ya validada, sin consultar el DNS.
 * Node puede pedirlo con `all: true` (autoSelectFamily), así que se responden
 * las dos formas.
 */
export function pinnedLookup(pinned: ResolvedAddress): LookupFunction {
  const lookupSocket: LookupFunction = ((
    _hostname: string,
    options: unknown,
    callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    let done = callback;
    let opts = options;
    if (typeof opts === 'function') {
      done = opts as typeof callback;
      opts = {};
    }
    const wantsAll = typeof opts === 'object' && opts !== null && (opts as { all?: boolean }).all === true;
    if (wantsAll) done(null, [{ address: pinned.address, family: pinned.family }]);
    else done(null, pinned.address, pinned.family);
  }) as LookupFunction;
  return lookupSocket;
}

/** Lee el cuerpo de la respuesta cortándolo a `MAX_BYTES`. */
async function readLimitedBody(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    const remaining = MAX_BYTES - total;
    if (buffer.byteLength >= remaining) {
      // El trozo que cruza el límite se corta: nunca se pasan los 512 KB.
      chunks.push(buffer.subarray(0, remaining));
      break; // romper el bucle destruye el stream
    }
    chunks.push(buffer);
    total += buffer.byteLength;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Transporte real: pide la URL conectando a la IP ya validada. El `Host`, el
 * SNI y la validación del certificado siguen siendo del nombre original.
 * Se exporta para poder probarlo contra un servidor local en los tests.
 */
export const httpTransport: LinkPreviewTransport = async (url, address) => {
  const requestModule = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<LinkPreviewResponse>((resolve, reject) => {
    const request = requestModule(
      url,
      {
        method: 'GET',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
        lookup: pinnedLookup(address),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location ?? null;
        const contentType = response.headers['content-type'] ?? null;
        void readLimitedBody(response).then(
          (body) => resolve({ status, location, contentType, body }),
          (error: unknown) => reject(error),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
};

const defaultLookup: LinkPreviewLookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

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

async function fetchHtml(
  start: URL,
  deps: { lookup: LinkPreviewLookup; transport: LinkPreviewTransport },
): Promise<{ html: string; finalUrl: URL }> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // Cada salto revalida el destino; la conexión usa la IP que salió de acá.
    const address = await resolvePublicAddress(current.hostname, deps.lookup);
    const response = await deps.transport(current, address);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw badRequest('Redirección sin destino', 'link_preview_bad_redirect');
      current = new URL(response.location, current);
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        throw badRequest('Redirección a un protocolo no soportado', 'link_preview_bad_redirect');
      }
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw badRequest(`El sitio respondió ${response.status}`, 'link_preview_http_error');
    }
    if (!(response.contentType ?? '').includes('html')) {
      throw badRequest('El recurso no es HTML', 'link_preview_not_html');
    }
    return { html: response.body, finalUrl: current };
  }
  throw badRequest('Demasiadas redirecciones', 'link_preview_too_many_redirects');
}

/** Descarga y normaliza los metadatos de un enlace. */
export async function fetchLinkPreview(rawUrl: string, deps: LinkPreviewDeps = {}): Promise<LinkPreviewData> {
  const lookup = deps.lookup ?? defaultLookup;
  const transport = deps.transport ?? httpTransport;

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
    page = await fetchHtml(parsed, { lookup, transport });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Red caída, TLS, timeout: es un fallo del destino, no nuestro.
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

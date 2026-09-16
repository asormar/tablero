/**
 * Enlaces: normalización de URLs y detección de incrustados.
 *
 * La misma función la usan la API (al construir la previsualización) y la web
 * (al pegar un enlace, para mostrar el reproductor de inmediato sin esperar al
 * servidor). Si un proveedor cambia su formato de incrustación, se cambia aquí.
 */

import { LINK_EMBED_TYPES, type LinkEmbedType } from './elements.js';

export type EmbedInfo = {
  embedType: LinkEmbedType;
  /** URL lista para un `<iframe>`; `null` cuando no hay incrustado posible. */
  embedUrl: string | null;
  /** Identificador del recurso en el proveedor (id de vídeo, lista, etc.). */
  resourceId?: string;
};

const NO_EMBED: EmbedInfo = { embedType: 'generic', embedUrl: null };

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
/** Dominios con forma plausible (`algo.algo`), sin espacios. */
const DOMAIN_LIKE_RE = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/;

/**
 * Normaliza lo que pegó el usuario: agrega `https://` si falta el esquema y
 * descarta lo que no puede ser una URL. Devuelve `null` si no es un enlace.
 */
export function normalizeUrl(input: string): string | null {
  const value = input.trim();
  if (value.length === 0 || value.length > 2048) return null;
  if (/\s/.test(value.split('?')[0] ?? '')) return null;

  if (SCHEME_RE.test(value)) {
    if (/^(https?|mailto|ftp):/i.test(value) === false) return null;
    try {
      const url = new URL(value);
      // Con esquema explícito basta con que la URL sea válida: los hosts de una
      // sola etiqueta (localhost, intranet) son legítimos en autoalojado.
      return url.toString();
    } catch {
      return null;
    }
  }

  // Sin esquema hace falta que el texto parezca un dominio para no convertir
  // cualquier palabra en un enlace.
  if (!DOMAIN_LIKE_RE.test(value)) return null;
  try {
    return new URL(`https://${value}`).toString();
  } catch {
    return null;
  }
}

/** ¿El texto pegado es un enlace? (para decidir si crear tarjeta de enlace). */
export function isLikelyUrl(text: string): boolean {
  const value = text.trim();
  if (value.length < 4 || value.includes('\n')) return false;
  return normalizeUrl(value) !== null;
}

/** Dominio legible para mostrar en la tarjeta: `www.youtube.com` → `youtube.com`. */
export function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pathParts(url: URL): string[] {
  return url.pathname.split('/').filter((part) => part.length > 0);
}

function youtubeEmbed(url: URL): EmbedInfo | null {
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  const list = url.searchParams.get('list');
  if (host === 'youtu.be') {
    const id = pathParts(url)[0];
    return id ? { embedType: 'youtube', embedUrl: `https://www.youtube.com/embed/${id}`, resourceId: id } : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = url.searchParams.get('v');
    if (id) return { embedType: 'youtube', embedUrl: `https://www.youtube.com/embed/${id}`, resourceId: id };
    const parts = pathParts(url);
    const [first, second] = parts;
    if ((first === 'shorts' || first === 'embed' || first === 'live') && second) {
      return { embedType: 'youtube', embedUrl: `https://www.youtube.com/embed/${second}`, resourceId: second };
    }
    if (list) {
      return {
        embedType: 'youtube',
        embedUrl: `https://www.youtube.com/embed/videoseries?list=${list}`,
        resourceId: list,
      };
    }
  }
  return null;
}

function vimeoEmbed(url: URL): EmbedInfo | null {
  const host = url.hostname.replace(/^www\./, '');
  const parts = pathParts(url);
  if (host === 'vimeo.com') {
    const id = parts.find((part) => /^\d+$/.test(part));
    return id ? { embedType: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}`, resourceId: id } : null;
  }
  if (host === 'player.vimeo.com' && parts[0] === 'video' && parts[1]) {
    return { embedType: 'vimeo', embedUrl: `https://player.vimeo.com/video/${parts[1]}`, resourceId: parts[1] };
  }
  return null;
}

const SPOTIFY_TYPES = new Set(['track', 'album', 'playlist', 'artist', 'episode', 'show']);

function spotifyEmbed(url: URL): EmbedInfo | null {
  if (url.hostname.replace(/^www\./, '') !== 'open.spotify.com') return null;
  const parts = pathParts(url);
  const [kind, id] = parts;
  if (!kind || !id) return null;
  const base = kind.startsWith('intl-') ? parts[1] : kind;
  const resourceId = kind.startsWith('intl-') ? parts[2] : id;
  if (!base || !resourceId || !SPOTIFY_TYPES.has(base)) return null;
  return {
    embedType: 'spotify',
    embedUrl: `https://open.spotify.com/embed/${base}/${resourceId}`,
    resourceId,
  };
}

function soundcloudEmbed(url: URL): EmbedInfo | null {
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'soundcloud.com' && host !== 'on.soundcloud.com') return null;
  const parts = pathParts(url);
  if (parts.length < 2) return null;
  return {
    embedType: 'soundcloud',
    embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.toString())}`,
    resourceId: parts.join('/'),
  };
}

function twitterEmbed(url: URL): EmbedInfo | null {
  const host = url.hostname.replace(/^www\./, '').replace(/^mobile\./, '');
  if (host !== 'twitter.com' && host !== 'x.com') return null;
  const parts = pathParts(url);
  const [user, kind, id] = parts;
  if (kind !== 'status' || !user || !id) return null;
  return {
    embedType: 'twitter',
    embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${id}`,
    resourceId: id,
  };
}

function mapsEmbed(url: URL): EmbedInfo | null {
  const host = url.hostname;
  const isMaps =
    /(^|\.)google\.[a-z.]+$/.test(host) &&
    (url.pathname.startsWith('/maps') || url.searchParams.has('q') || url.hostname.startsWith('maps.'));
  const isShort = host === 'maps.app.goo.gl' || (host === 'goo.gl' && url.pathname.startsWith('/maps'));
  if (!isMaps && !isShort) return null;

  const query = url.searchParams.get('q') ?? url.searchParams.get('query');
  if (query) {
    return {
      embedType: 'maps',
      embedUrl: `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`,
      resourceId: query,
    };
  }
  const place = /\/place\/([^/]+)/.exec(url.pathname);
  if (place?.[1]) {
    const name = decodeURIComponent(place[1]).replace(/\+/g, ' ');
    return {
      embedType: 'maps',
      embedUrl: `https://www.google.com/maps?q=${encodeURIComponent(name)}&output=embed`,
      resourceId: name,
    };
  }
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url.pathname);
  if (at?.[1] && at[2]) {
    const coords = `${at[1]},${at[2]}`;
    return { embedType: 'maps', embedUrl: `https://www.google.com/maps?q=${coords}&output=embed`, resourceId: coords };
  }
  return null;
}

function figmaEmbed(url: URL): EmbedInfo | null {
  if (url.hostname.replace(/^www\./, '') !== 'figma.com') return null;
  const parts = pathParts(url);
  const [kind, key] = parts;
  if (!kind || !key) return null;
  if (!['file', 'design', 'proto', 'board', 'slides'].includes(kind)) return null;
  return {
    embedType: 'figma',
    embedUrl: `https://www.figma.com/embed?embed_host=tablero&url=${encodeURIComponent(url.toString())}`,
    resourceId: key,
  };
}

function loomEmbed(url: URL): EmbedInfo | null {
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'loom.com') return null;
  const parts = pathParts(url);
  const [kind, id] = parts;
  if (!kind || !id) return null;
  if (kind !== 'share' && kind !== 'embed') return null;
  return { embedType: 'loom', embedUrl: `https://www.loom.com/embed/${id}`, resourceId: id };
}

function codepenEmbed(url: URL): EmbedInfo | null {
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'codepen.io') return null;
  const parts = pathParts(url);
  if (parts[0] === 'embed') return { embedType: 'codepen', embedUrl: url.toString(), resourceId: parts[2] ?? '' };
  const [user, kind, slug] = parts;
  if (!user || !slug) return null;
  if (kind !== 'pen' && kind !== 'full' && kind !== 'details') return null;
  return { embedType: 'codepen', embedUrl: `https://codepen.io/${user}/embed/${slug}`, resourceId: slug };
}

/**
 * Detecta si un enlace se puede incrustar y con qué URL.
 *
 * Si el enlace no se puede incrustar (una página cualquiera), devuelve
 * `{ embedType: 'generic', embedUrl: null }`: la tarjeta muestra la
 * previsualización con imagen y título.
 */
export function detectEmbed(rawUrl: string): EmbedInfo {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return NO_EMBED;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return NO_EMBED;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return NO_EMBED;

  for (const detector of [
    youtubeEmbed,
    vimeoEmbed,
    spotifyEmbed,
    soundcloudEmbed,
    twitterEmbed,
    mapsEmbed,
    figmaEmbed,
    loomEmbed,
    codepenEmbed,
  ]) {
    const info = detector(url);
    if (info) return info;
  }
  return NO_EMBED;
}

export function isEmbedType(value: unknown): value is LinkEmbedType {
  return typeof value === 'string' && (LINK_EMBED_TYPES as readonly string[]).includes(value);
}

/** Alto sugerido del incrustado según el proveedor y el ancho de la tarjeta. */
export function embedHeight(embedType: LinkEmbedType, width: number): number {
  switch (embedType) {
    case 'youtube':
    case 'vimeo':
    case 'loom':
    case 'figma':
      return Math.round((width * 9) / 16);
    case 'twitter':
      return Math.round(width * 0.9);
    case 'spotify':
      return 232;
    case 'soundcloud':
      return Math.round(width * 0.45);
    case 'maps':
      return Math.round(Math.min(width * 0.75, 320));
    case 'codepen':
      return Math.round(Math.min(width * 0.8, 400));
    default:
      return 0;
  }
}

export function isEmbeddable(embedType: LinkEmbedType): boolean {
  return embedHeight(embedType, 100) > 0;
}

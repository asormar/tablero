/**
 * Pegado: qué se crea a partir de lo que hay en el portapapeles.
 *
 * Extiende el pegado inteligente de la fase 1 (`smartPaste.ts`, que sigue
 * diciendo si el texto es vacío, color, URL o texto) con la decisión de producto
 * de la fase 2: un color pegado crea una muestra de color, una URL crea una
 * tarjeta de enlace (con el incrustado listo al instante) y el resto, una nota.
 */

import {
  type EmbedInfo,
  type LinkEmbedType,
  CARD_COLORS,
  detectColor,
  detectEmbed,
  isEmbeddable,
  isLikelyUrl,
  normalizeUrl,
  type ColorToken,
} from '@tablero/shared';

import { tokenForHex } from './smartPaste';

export type PasteTargetPlan =
  | { kind: 'empty' }
  /** Se pega el portapapeles interno de Tablero: lo resuelve `pasteInternalAt`. */
  | { kind: 'elements' }
  /** Archivos del portapapeles (una imagen copiada, por ejemplo). */
  | { kind: 'files' }
  | { kind: 'link'; url: string; embed: EmbedInfo; embeddable: boolean }
  | { kind: 'swatch'; hex: string; token: ColorToken; name: string }
  | { kind: 'note'; text: string };

export type PasteInput = {
  /** Texto plano del portapapeles (`null` si el navegador no lo dio). */
  text: string | null;
  /** Número de archivos que trae el evento `paste`. */
  fileCount?: number;
  /** El texto coincide con lo último copiado dentro de Tablero. */
  internalMatches?: boolean;
};

export function planPasteTarget(input: PasteInput): PasteTargetPlan {
  if ((input.fileCount ?? 0) > 0) return { kind: 'files' };
  const text = (input.text ?? '').replace(/\r\n/g, '\n').trim();
  if (text.length === 0) return input.internalMatches ? { kind: 'elements' } : { kind: 'empty' };
  if (input.internalMatches) return { kind: 'elements' };

  const url = normalizeUrl(text);
  if (url !== null && isLikelyUrl(text)) {
    const embed = detectEmbed(url);
    return { kind: 'link', url, embed, embeddable: isEmbeddable(embed.embedType) };
  }

  const hex = detectColor(text);
  if (hex) {
    const token = tokenForHex(hex);
    return { kind: 'swatch', hex, token, name: swatchName(token) };
  }

  return { kind: 'note', text };
}

/** Nombre legible de una muestra a partir del token de paleta más cercano. */
export function swatchName(token: ColorToken): string {
  const label = CARD_COLORS[token]?.label ?? 'Color';
  return label === 'Sin color' ? 'Color' : label;
}

/** Etiqueta corta del tipo de incrustado (para los avisos de la tarjeta). */
export function embedLabel(embedType: LinkEmbedType): string {
  switch (embedType) {
    case 'youtube':
      return 'YouTube';
    case 'vimeo':
      return 'Vimeo';
    case 'spotify':
      return 'Spotify';
    case 'soundcloud':
      return 'SoundCloud';
    case 'twitter':
      return 'X';
    case 'maps':
      return 'Google Maps';
    case 'figma':
      return 'Figma';
    case 'loom':
      return 'Loom';
    case 'codepen':
      return 'CodePen';
    default:
      return 'Enlace';
  }
}

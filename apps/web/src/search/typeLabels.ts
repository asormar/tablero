/**
 * Etiquetas de tipo de tarjeta para la búsqueda y la vista de lista.
 *
 * Los tipos de `ElementType` viven en `packages/shared`; acá se traducen a texto
 * legible con las claves `type.*` del diccionario.
 */

import type { ElementType } from '@tablero/shared';

export const TYPE_KEYS: Record<ElementType, string> = {
  note: 'type.note',
  document: 'type.document',
  todo: 'type.todo',
  image: 'type.image',
  link: 'type.link',
  file: 'type.file',
  video: 'type.video',
  audio: 'type.audio',
  board: 'type.board',
  column: 'type.column',
  heading: 'type.heading',
  swatch: 'type.swatch',
  sketch: 'type.sketch',
  table: 'type.table',
  line: 'type.line',
  map: 'type.map',
  'comment-pin': 'type.commentPin',
};

export const ELEMENT_TYPE_LABELS = Object.keys(TYPE_KEYS) as ElementType[];

export function elementTypeLabel(type: string, translate: (key: string) => string): string {
  const key = TYPE_KEYS[type as ElementType];
  return key ? translate(key) : type;
}

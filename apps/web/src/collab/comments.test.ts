/**
 * Comentarios: modelo en el documento Yjs y proyección (hilos, contadores,
 * menciones).
 *
 * El documento es la fuente de verdad, así que lo importante es que escribir y
 * leer sea simétrico, que un hilo resuelto lo esté para todas sus respuestas y
 * que borrar la raíz se lleve las respuestas.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  COMMENT_MAX_LENGTH,
  addComment,
  commentSegments,
  commentThreads,
  commentsOf,
  elementCommentCount,
  getComment,
  insertMention,
  mentionQuery,
  openCommentCount,
  openThreads,
  pinnedThreads,
  readComments,
  relativeTime,
  removeComment,
  resolveComment,
  resolveMentions,
  threadsForElement,
  updateCommentBody,
} from './comments';

function board(): Y.Doc {
  return new Y.Doc();
}

const author = { authorId: 'u1', authorName: 'Ana' };

describe('comentarios · escritura y lectura en el documento', () => {
  it('añade un comentario raíz anclado a una tarjeta', () => {
    const doc = board();
    const id = addComment(doc, { body: '¿Esto va acá?', elementId: 'el1', ...author, createdAt: 10 });
    const entry = getComment(doc, id);
    expect(entry).toMatchObject({
      id,
      body: '¿Esto va acá?',
      elementId: 'el1',
      parentId: null,
      authorId: 'u1',
      authorName: 'Ana',
      createdAt: 10,
      resolvedAt: null,
    });
    expect(readComments(doc)).toHaveLength(1);
  });

  it('añade una chincheta libre con posición de mundo', () => {
    const doc = board();
    const id = addComment(doc, { body: 'Suelto', x: 320, y: -40, ...author, createdAt: 5 });
    expect(getComment(doc, id)).toMatchObject({ elementId: null, x: 320, y: -40 });
  });

  it('una respuesta cuelga de su raíz', () => {
    const doc = board();
    const root = addComment(doc, { body: 'Raíz', elementId: 'el1', ...author, createdAt: 1 });
    const reply = addComment(doc, { body: 'Respuesta', parentId: root, elementId: 'el1', ...author, createdAt: 2 });
    const threads = commentThreads(readComments(doc));
    expect(threads).toHaveLength(1);
    expect(threads[0]!.replies.map((entry) => entry.id)).toEqual([reply]);
  });

  it('recorta el cuerpo al tope', () => {
    const doc = board();
    const long = 'x'.repeat(COMMENT_MAX_LENGTH + 500);
    const id = addComment(doc, { body: long, ...author });
    expect(getComment(doc, id)?.body.length).toBe(COMMENT_MAX_LENGTH);
  });

  it('edita el cuerpo sin perder el resto', () => {
    const doc = board();
    const id = addComment(doc, { body: 'antes', elementId: 'el9', ...author, createdAt: 3 });
    updateCommentBody(doc, id, 'después');
    expect(getComment(doc, id)).toMatchObject({ body: 'después', elementId: 'el9', createdAt: 3 });
  });

  it('resolver marca el hilo; reabrir lo desmarca', () => {
    const doc = board();
    const id = addComment(doc, { body: 'algo', ...author, createdAt: 1 });
    resolveComment(doc, id, true, 'u1');
    expect(getComment(doc, id)?.resolvedAt).not.toBeNull();
    resolveComment(doc, id, false, null);
    expect(getComment(doc, id)?.resolvedAt).toBeNull();
  });

  it('borrar la raíz se lleva las respuestas', () => {
    const doc = board();
    const root = addComment(doc, { body: 'raíz', ...author, createdAt: 1 });
    addComment(doc, { body: 'r1', parentId: root, ...author, createdAt: 2 });
    addComment(doc, { body: 'r2', parentId: root, ...author, createdAt: 3 });
    const removed = removeComment(doc, root);
    expect(removed).toHaveLength(3);
    expect(readComments(doc)).toHaveLength(0);
  });

  it('borrar una respuesta no toca el resto del hilo', () => {
    const doc = board();
    const root = addComment(doc, { body: 'raíz', ...author, createdAt: 1 });
    const r1 = addComment(doc, { body: 'r1', parentId: root, ...author, createdAt: 2 });
    addComment(doc, { body: 'r2', parentId: root, ...author, createdAt: 3 });
    removeComment(doc, r1);
    expect(readComments(doc).map((entry) => entry.body).sort()).toEqual(['r2', 'raíz']);
  });

  it('las menciones se guardan como lista', () => {
    const doc = board();
    const id = addComment(doc, { body: '@Ana mirá', mentions: ['u1'], ...author });
    expect(getComment(doc, id)?.mentions).toEqual(['u1']);
  });

  it('el mapa de comentarios es una clave de primer nivel del documento', () => {
    const doc = board();
    addComment(doc, { body: 'x', ...author });
    expect(commentsOf(doc).size).toBe(1);
  });

  it('ignora un mapa sin id o sin autor', () => {
    const doc = board();
    commentsOf(doc).set('roto', new Y.Map());
    expect(readComments(doc)).toHaveLength(0);
  });
});

describe('comentarios · proyección', () => {
  const entries = [
    {
      id: 'c1',
      parentId: null,
      body: 'raíz abierta',
      authorId: 'u1',
      authorName: 'Ana',
      createdAt: 100,
      elementId: 'el1',
      x: null,
      y: null,
      resolvedAt: null,
      resolvedBy: null,
      mentions: [],
    },
    {
      id: 'c2',
      parentId: null,
      body: 'raíz resuelta',
      authorId: 'u1',
      authorName: 'Ana',
      createdAt: 200,
      elementId: 'el1',
      x: null,
      y: null,
      resolvedAt: 300,
      resolvedBy: 'u1',
      mentions: [],
    },
    {
      id: 'c3',
      parentId: 'c1',
      body: 'respuesta',
      authorId: 'u2',
      authorName: 'Bruno',
      createdAt: 150,
      elementId: 'el1',
      x: null,
      y: null,
      resolvedAt: null,
      resolvedBy: null,
      mentions: [],
    },
    {
      id: 'c4',
      parentId: null,
      body: 'chincheta',
      authorId: 'u2',
      authorName: 'Bruno',
      createdAt: 50,
      elementId: null,
      x: 10,
      y: 20,
      resolvedAt: null,
      resolvedBy: null,
      mentions: [],
    },
  ];

  it('arma hilos con sus respuestas, del más nuevo al más viejo', () => {
    const threads = commentThreads(entries);
    expect(threads.map((thread) => thread.root.id)).toEqual(['c2', 'c1', 'c4']);
    expect(threads.find((thread) => thread.root.id === 'c1')!.replies.map((reply) => reply.id)).toEqual(['c3']);
  });

  it('separa abiertos y resueltos', () => {
    expect(openThreads(entries).map((thread) => thread.root.id).sort()).toEqual(['c1', 'c4']);
    expect(openCommentCount(entries)).toBe(2);
    const resolved = commentThreads(entries).filter((thread) => thread.resolved);
    expect(resolved.map((thread) => thread.root.id)).toEqual(['c2']);
  });

  it('agrupa por tarjeta y por chinchetas libres', () => {
    expect(threadsForElement(entries, 'el1').map((thread) => thread.root.id)).toEqual(['c2', 'c1']);
    expect(pinnedThreads(entries).map((thread) => thread.root.id)).toEqual(['c4']);
  });

  it('el contador de la tarjeta cuenta abiertos (raíces y respuestas)', () => {
    expect(elementCommentCount(entries, 'el1')).toBe(2);
    expect(elementCommentCount(entries, 'el9')).toBe(0);
  });

  it('una respuesta de un hilo resuelto no cuenta', () => {
    const withResolvedReply = [
      ...entries,
      { ...entries[2]!, id: 'c5', parentId: 'c2', createdAt: 160 },
    ];
    expect(elementCommentCount(withResolvedReply, 'el1')).toBe(2);
  });
});

describe('comentarios · menciones', () => {
  const members = [
    { userId: 'u1', name: 'Ana Pérez', email: 'ana@tablero.test' },
    { userId: 'u2', name: 'Bruno', email: 'bruno@tablero.test' },
    { userId: 'u3', name: 'Carla Gómez', email: 'carla@tablero.test' },
  ];

  it('detecta la mención que se está escribiendo', () => {
    expect(mentionQuery('hola @an', 8)).toEqual({ query: 'an', start: 5, end: 8 });
    expect(mentionQuery('hola @', 6)).toEqual({ query: '', start: 5, end: 6 });
    expect(mentionQuery('hola @an ', 9)).toBeNull();
    expect(mentionQuery('sin arroba', 10)).toBeNull();
  });

  it('inserta el nombre y deja el cursor listo', () => {
    const text = 'hola @an';
    const query = mentionQuery(text, text.length)!;
    const result = insertMention(text, query, 'Ana Pérez');
    expect(result.text).toBe('hola @Ana Pérez ');
    expect(result.caret).toBe(result.text.length);
  });

  it('reemplaza la mención a medias sin perder lo que sigue', () => {
    const text = 'hola @br mirá esto';
    const query = mentionQuery(text, 8)!;
    const result = insertMention(text, query, 'Bruno');
    expect(result.text).toBe('hola @Bruno mirá esto');
    expect(result.caret).toBe(11);
  });

  it('resuelve menciones por nombre, por primer nombre y por email', () => {
    expect(resolveMentions('@Ana Pérez ¿viste?', members).map((member) => member.userId)).toEqual(['u1']);
    expect(resolveMentions('@ana mirá', members).map((member) => member.userId)).toEqual(['u1']);
    expect(resolveMentions('@bruno@tablero.test', members).map((member) => member.userId)).toEqual(['u2']);
  });

  it('no repite miembros mencionados dos veces', () => {
    expect(resolveMentions('@Ana y otra vez @Ana Pérez', members)).toHaveLength(1);
  });

  it('ignora menciones que no son miembros', () => {
    expect(resolveMentions('@nadie mira', members)).toEqual([]);
  });

  it('parte el texto en tramos, resaltando las menciones', () => {
    const segments = commentSegments('hola @Ana Pérez y @Bruno');
    expect(segments.filter((segment) => segment.mention).map((segment) => segment.text)).toEqual([
      '@Ana',
      '@Bruno',
    ]);
    expect(segments.map((segment) => segment.text).join('')).toBe('hola @Ana Pérez y @Bruno');
  });
});

describe('comentarios · tiempo relativo', () => {
  const now = 1_700_000_000_000;

  it('describe el paso del tiempo en castellano corto', () => {
    expect(relativeTime(now - 20_000, now)).toBe('ahora');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('hace 5 min');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('hace 3 h');
    expect(relativeTime(now - 24 * 3_600_000, now)).toBe('ayer');
    expect(relativeTime(now - 5 * 24 * 3_600_000, now)).toBe('hace 5 días');
  });
});

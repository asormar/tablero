/**
 * Colaboración (fase 5): color del cursor, esquemas de entrada y los hilos de
 * comentario del documento (mapa plano `comments`).
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  CURSOR_COLORS,
  cursorColor,
  cursorHash,
  inviteMemberSchema,
  readNotificationsSchema,
  activityBatchSchema,
  activityEntrySchema,
  MAX_ACTIVITY_BATCH,
  publishBoardSchema,
  commentThreads,
  commentsOf,
  readComments,
  addComment,
  resolveComment,
  removeComment,
  elementCommentCount,
  getElement,
  addElement,
} from './index.js';
import { createBoardDoc } from './doc.js';

describe('cursorColor', () => {
  it('es estable para el mismo id y siempre cae en la paleta', () => {
    const first = cursorColor('user_ana');
    expect(cursorColor('user_ana')).toBe(first);
    expect(CURSOR_COLORS).toContain(first);
  });

  it('usa el mismo orden FNV-1a que la web (azul, verde, naranja, violeta, rosa, turquesa, rojo, índigo)', () => {
    // Orden exacto del contrato: el token que publica el servidor y el que
    // calcula cada cliente tienen que coincidir.
    expect([...CURSOR_COLORS]).toEqual(['blue', 'green', 'orange', 'purple', 'pink', 'teal', 'red', 'indigo']);

    // Hash FNV-1a de 32 bits sin signo, replicado a mano sobre estos ids.
    const everyId = ['a', 'ana', 'user_ana', 'user_beto', 'cmu4abcdefghijkl', 'zzz'];
    for (const id of everyId) {
      let hash = 0x811c9dc5;
      for (let index = 0; index < id.length; index += 1) {
        hash ^= id.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      expect(cursorColor(id)).toBe(CURSOR_COLORS[(hash >>> 0) % CURSOR_COLORS.length]);
    }
    expect(cursorHash('user_ana')).toBe(cursorHash('user_ana'));
  });

  it('no pisa el color entre usuarios distintos (colisiones poco frecuentes)', () => {
    const names = ['ana', 'beto', 'caro', 'dani', 'eva', 'fabi', 'gus', 'hugo'];
    const colors = names.map((name) => cursorColor(`user_${name}`));
    // Con 8 usuarios y 8 colores puede repetirse alguno, pero no todos.
    expect(new Set(colors).size).toBeGreaterThanOrEqual(4);
  });

  it('con muchos usuarios cubre la paleta entera', () => {
    const ids = Array.from({ length: 200 }, (_, index) => `cmu4${index}abcdefghijkl`);
    const colors = new Set(ids.map((id) => cursorColor(id)));
    expect(colors.size).toBe(CURSOR_COLORS.length);
  });
});

describe('esquemas de colaboración', () => {
  it('la invitación caduca a los 7 días por defecto y exige rol válido', () => {
    const parsed = inviteMemberSchema.parse({ email: 'ana@tablero.test', role: 'editor' });
    expect(parsed.expiresInDays).toBe(7);
    expect(inviteMemberSchema.safeParse({ email: 'ana@tablero.test', role: 'dueño' }).success).toBe(false);
    expect(inviteMemberSchema.safeParse({ email: 'no-es-email', role: 'editor' }).success).toBe(false);
  });

  it('el lote de actividad viaja en `entries`, está acotado y usa acciones punteadas', () => {
    const entries = Array.from({ length: MAX_ACTIVITY_BATCH }, () => ({ action: 'element.create' as const }));
    expect(activityBatchSchema.safeParse({ entries }).success).toBe(true);
    expect(activityBatchSchema.safeParse({ entries: [...entries, { action: 'element.create' }] }).success).toBe(false);
    expect(activityBatchSchema.safeParse({ entries: [] }).success).toBe(false);
    // Las acciones son las punteadas de la web, no las sueltas de la primera versión.
    expect(activityBatchSchema.safeParse({ entries: [{ action: 'board.publish' }] }).success).toBe(true);
    expect(activityBatchSchema.safeParse({ entries: [{ action: 'updated' }] }).success).toBe(false);
    expect(activityBatchSchema.safeParse({ events: [{ action: 'element.create' }] }).success).toBe(false);
  });

  it('marcar leídas: `{}` marca todas y `ids` marca las indicadas', () => {
    expect(readNotificationsSchema.safeParse({}).success).toBe(true);
    expect(readNotificationsSchema.safeParse({ all: true }).success).toBe(true);
    expect(readNotificationsSchema.safeParse({ ids: ['n1'] }).success).toBe(true);
    expect(readNotificationsSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it('`elementType` acepta cualquier tipo del documento (no una lista cerrada)', () => {
    // Los documentos reales traen tipos fuera del vocabulario de la interfaz
    // (`sticky` de una importación, por ejemplo): rechazarlos tiraba el lote.
    const entry = activityEntrySchema.parse({ action: 'element.create', elementId: 'el_1', elementType: 'sticky' });
    expect(entry.elementType).toBe('sticky');
    expect(activityBatchSchema.safeParse({ entries: [{ action: 'element.move', elementType: 'comment-pin' }] }).success).toBe(true);
    // Sigue habiendo límites: vacío o desmesurado no pasa.
    expect(activityEntrySchema.safeParse({ action: 'element.create', elementType: '' }).success).toBe(false);
    expect(activityEntrySchema.safeParse({ action: 'element.create', elementType: 'x'.repeat(65) }).success).toBe(false);
  });

  it('publicar acepta contraseña opcional y rechaza campos desconocidos', () => {
    expect(publishBoardSchema.parse({})).toEqual({});
    expect(publishBoardSchema.parse({ password: 'secreta', includeSubBoards: true })).toMatchObject({
      password: 'secreta',
      includeSubBoards: true,
    });
    expect(publishBoardSchema.safeParse({ includeChildren: true }).success).toBe(false);
  });
});

describe('hilos de comentario en el documento (mapa plano)', () => {
  it('crea el comentario raíz anclado a una tarjeta y el contador de la tarjeta sube', () => {
    const doc = createBoardDoc();
    const cardId = addElement(doc, 'note', { createdBy: 'user_ana', x: 0, y: 0 }, 'test');
    const commentId = addComment(
      doc,
      {
        parentId: null,
        elementId: cardId,
        x: null,
        y: null,
        authorId: 'user_ana',
        authorName: 'Ana',
        body: '¿Revisamos esto?',
        mentions: ['user_beto'],
      },
      'test',
    );

    // El comentario es un Y.Map plano dentro de `comments`, no un elemento.
    expect(getElement(doc, commentId)).toBeNull();
    expect(commentsOf(doc).has(commentId)).toBe(true);
    expect(readComments(doc)).toHaveLength(1);
    const entry = readComments(doc)[0]!;
    expect(entry).toMatchObject({
      id: commentId,
      parentId: null,
      elementId: cardId,
      authorId: 'user_ana',
      authorName: 'Ana',
      body: '¿Revisamos esto?',
      mentions: ['user_beto'],
      resolvedAt: null,
      resolvedBy: null,
    });
    expect(elementCommentCount(readComments(doc), cardId)).toBe(1);

    const threads = commentThreads(readComments(doc));
    expect(threads).toHaveLength(1);
    expect(threads[0]!.root.id).toBe(commentId);
    expect(threads[0]!.resolved).toBe(false);
  });

  it('responde, resuelve y reabre el hilo; el contador sigue a los abiertos', () => {
    const doc = createBoardDoc();
    const cardId = addElement(doc, 'note', { createdBy: 'user_ana', x: 0, y: 0 }, 'test');
    const rootId = addComment(
      doc,
      { elementId: cardId, authorId: 'user_ana', authorName: 'Ana', body: 'Duda' },
      'test',
    );
    const replyId = addComment(
      doc,
      { parentId: rootId, elementId: cardId, authorId: 'user_beto', authorName: 'Beto', body: 'Lo miro' },
      'test',
    );

    let entries = readComments(doc);
    expect(commentThreads(entries)[0]!.replies).toHaveLength(1);
    expect(elementCommentCount(entries, cardId)).toBe(2);

    expect(resolveComment(doc, rootId, true, 'user_ana', 'test')).toBe(true);
    entries = readComments(doc);
    expect(entries.find((entry) => entry.id === rootId)?.resolvedAt).toBeTypeOf('number');
    expect(entries.find((entry) => entry.id === rootId)?.resolvedBy).toBe('user_ana');
    // Resuelto: deja de contar como pendiente en la tarjeta.
    expect(commentThreads(entries)[0]!.resolved).toBe(true);
    expect(elementCommentCount(entries, cardId)).toBe(0);

    // Reabrir vuelve a contar.
    expect(resolveComment(doc, rootId, false, null, 'test')).toBe(true);
    entries = readComments(doc);
    expect(commentThreads(entries)[0]!.resolved).toBe(false);
    expect(elementCommentCount(entries, cardId)).toBe(2);
    expect(entries.find((entry) => entry.id === replyId)?.parentId).toBe(rootId);
  });

  it('borra una respuesta sola y, si borra la raíz, cae el hilo completo', () => {
    const doc = createBoardDoc();
    const cardId = addElement(doc, 'note', { createdBy: 'user_ana', x: 0, y: 0 }, 'test');
    const rootId = addComment(doc, { elementId: cardId, authorId: 'a', authorName: 'A', body: 'raíz' }, 'test');
    const replyId = addComment(
      doc,
      { parentId: rootId, elementId: cardId, authorId: 'b', authorName: 'B', body: 'respuesta' },
      'test',
    );

    expect(removeComment(doc, replyId, 'test')).toEqual([replyId]);
    expect(readComments(doc).map((entry) => entry.id)).toEqual([rootId]);

    expect(removeComment(doc, rootId, 'test')).toEqual([rootId]);
    expect(readComments(doc)).toHaveLength(0);
  });

  it('el hilo sobrevive al viaje por el estado Yjs (encode + apply)', () => {
    const doc = createBoardDoc();
    const rootId = addComment(
      doc,
      { x: 5, y: 6, authorId: 'user_ana', authorName: 'Ana', body: 'suelto', mentions: ['user_beto'], createdAt: 1_000 },
      'test',
    );
    addComment(
      doc,
      { parentId: rootId, authorId: 'user_beto', authorName: 'Beto', body: 'otra', createdAt: 2_000 },
      'test',
    );

    const restored = createBoardDoc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));

    const entries = readComments(restored);
    expect(entries.map((entry) => entry.body)).toEqual(['suelto', 'otra']);
    expect(entries.map((entry) => entry.authorName)).toEqual(['Ana', 'Beto']);
    expect(entries[0]!.mentions).toEqual(['user_beto']);
    expect(entries[0]!.x).toBe(5);
    expect(entries[0]!.y).toBe(6);
  });
});

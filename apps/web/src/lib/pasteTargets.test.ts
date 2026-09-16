/**
 * Pegado: una URL de YouTube crea tarjeta de enlace con reproductor, un color
 * crea muestra y el texto corriente, una nota.
 */

import { describe, expect, it } from 'vitest';

import { planPasteTarget, swatchName } from './pasteTargets';

describe('planPasteTarget', () => {
  it('un enlace de YouTube se resuelve con su incrustado', () => {
    const plan = planPasteTarget({ text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    expect(plan.kind).toBe('link');
    if (plan.kind !== 'link') return;
    expect(plan.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(plan.embed.embedType).toBe('youtube');
    expect(plan.embed.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(plan.embeddable).toBe(true);
  });

  it('también reconoce shorts y listas de YouTube', () => {
    const short = planPasteTarget({ text: 'https://youtube.com/shorts/abc123' });
    expect(short.kind === 'link' && short.embed.embedUrl).toBe('https://www.youtube.com/embed/abc123');
    const list = planPasteTarget({ text: 'https://www.youtube.com/playlist?list=PL123' });
    expect(list.kind === 'link' && list.embed.embedType).toBe('youtube');
  });

  it('una URL sin esquema se normaliza a https', () => {
    const plan = planPasteTarget({ text: 'www.youtube.com/watch?v=abc' });
    expect(plan.kind).toBe('link');
    if (plan.kind !== 'link') return;
    expect(plan.url.startsWith('https://')).toBe(true);
  });

  it('un enlace cualquiera también es tarjeta de enlace (sin incrustado)', () => {
    const plan = planPasteTarget({ text: 'https://example.com/nota' });
    expect(plan.kind).toBe('link');
    if (plan.kind !== 'link') return;
    expect(plan.embeddable).toBe(false);
    expect(plan.embed.embedType).toBe('generic');
  });

  it('un color crea una muestra con su nombre de paleta', () => {
    const plan = planPasteTarget({ text: '#DEEAFB' });
    expect(plan.kind).toBe('swatch');
    if (plan.kind !== 'swatch') return;
    expect(plan.hex).toBe('#DEEAFB');
    expect(plan.token).toBe('blue');
    expect(plan.name).toBe(swatchName('blue'));
  });

  it('un rgb() pegado también es muestra', () => {
    const plan = planPasteTarget({ text: 'rgb(201, 59, 59)' });
    expect(plan.kind).toBe('swatch');
    if (plan.kind !== 'swatch') return;
    expect(plan.hex).toBe('#C93B3B');
  });

  it('el texto corriente crea una nota', () => {
    const plan = planPasteTarget({ text: 'ideas para el tablero' });
    expect(plan).toEqual({ kind: 'note', text: 'ideas para el tablero' });
  });

  it('un párrafo con una URL dentro sigue siendo texto', () => {
    expect(planPasteTarget({ text: 'mirá esto https://youtube.com/watch?v=abc' }).kind).toBe('note');
  });

  it('archivos en el portapapeles tienen prioridad sobre el texto', () => {
    expect(planPasteTarget({ text: 'https://example.com', fileCount: 2 }).kind).toBe('files');
  });

  it('el portapapeles interno pega elementos, no texto', () => {
    expect(planPasteTarget({ text: 'nota copiada', internalMatches: true }).kind).toBe('elements');
    expect(planPasteTarget({ text: null, internalMatches: true }).kind).toBe('elements');
  });

  it('sin nada que pegar no se crea nada', () => {
    expect(planPasteTarget({ text: null }).kind).toBe('empty');
    expect(planPasteTarget({ text: '   ' }).kind).toBe('empty');
  });
});

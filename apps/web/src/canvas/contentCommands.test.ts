/**
 * Previsualización provisional de un enlace: se publica al instante (para que
 * el reproductor aparezca sin esperar a la red) pero queda marcada como
 * pendiente, o la tarjeta nunca pediría el título y la imagen a la API (fallo
 * real detectado pegando un enlace de YouTube).
 */

import { describe, expect, it } from 'vitest';

import { instantLinkPreview } from './contentCommands';

describe('instantLinkPreview', () => {
  it('marca la previsualización como provisional (fetchedAt 0)', () => {
    const preview = instantLinkPreview({
      url: 'https://www.youtube.com/watch?v=abc',
      embedType: 'youtube',
      embedUrl: 'https://www.youtube.com/embed/abc',
    });
    expect(preview.fetchedAt).toBe(0);
    expect(preview.embedType).toBe('youtube');
    expect(preview.embedUrl).toBe('https://www.youtube.com/embed/abc');
    expect(preview.title).toBeNull();
  });

  it('sin incrustado deja la URL y el tipo genérico', () => {
    const preview = instantLinkPreview({ url: 'https://example.com', embedType: 'generic', embedUrl: null });
    expect(preview.embedType).toBe('generic');
    expect(preview.embedUrl).toBeNull();
  });
});

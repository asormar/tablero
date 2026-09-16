import { describe, expect, it } from 'vitest';

import { detectEmbed, displayDomain, embedHeight, isEmbeddable, isLikelyUrl, normalizeUrl } from './links.js';

describe('normalizeUrl', () => {
  it('agrega https cuando falta el esquema', () => {
    expect(normalizeUrl('milanote.com')).toBe('https://milanote.com/');
    expect(normalizeUrl('www.youtube.com/watch?v=abc12345678')).toBe(
      'https://www.youtube.com/watch?v=abc12345678',
    );
  });

  it('respeta el esquema cuando lo trae', () => {
    expect(normalizeUrl('http://localhost:5173/x')).toBe('http://localhost:5173/x');
    expect(normalizeUrl('mailto:hola@tablero.local')).toBe('mailto:hola@tablero.local');
  });

  it('rechaza lo que no es un enlace', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('una frase cualquiera con espacios')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('file:///C:/secreto.txt')).toBeNull();
    expect(normalizeUrl('sinnada')).toBeNull();
    expect(normalizeUrl(`https://x.com/${'a'.repeat(2100)}`)).toBeNull();
  });
});

describe('isLikelyUrl', () => {
  it('detecta enlaces pegados', () => {
    expect(isLikelyUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isLikelyUrl('ejemplo.com/ruta?x=1')).toBe(true);
  });

  it('no confunde texto ni colores', () => {
    expect(isLikelyUrl('revisar el presupuesto mañana')).toBe(false);
    expect(isLikelyUrl('#FF8800')).toBe(false);
    expect(isLikelyUrl('linea 1\nlinea 2')).toBe(false);
  });
});

describe('displayDomain', () => {
  it('quita www y el esquema', () => {
    expect(displayDomain('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(displayDomain('https://sub.ejemplo.com/a')).toBe('sub.ejemplo.com');
    expect(displayDomain('no-es-url')).toBe('');
  });
});

describe('detectEmbed', () => {
  it('YouTube en sus variantes', () => {
    const expected = { embedType: 'youtube', embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ' };
    expect(detectEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject(expected);
    expect(detectEmbed('https://youtu.be/dQw4w9WgXcQ')).toMatchObject(expected);
    expect(detectEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toMatchObject(expected);
    expect(detectEmbed('https://www.youtube.com/embed/dQw4w9WgXcQ')).toMatchObject(expected);
  });

  it('YouTube: lista de reproducción', () => {
    expect(detectEmbed('https://www.youtube.com/playlist?list=PL123')).toMatchObject({
      embedType: 'youtube',
      embedUrl: 'https://www.youtube.com/embed/videoseries?list=PL123',
    });
  });

  it('Vimeo', () => {
    expect(detectEmbed('https://vimeo.com/76979871')).toMatchObject({
      embedType: 'vimeo',
      embedUrl: 'https://player.vimeo.com/video/76979871',
    });
    expect(detectEmbed('https://player.vimeo.com/video/76979871')).toMatchObject({
      embedType: 'vimeo',
    });
  });

  it('Spotify, incluso con el prefijo de idioma', () => {
    expect(detectEmbed('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')).toMatchObject({
      embedType: 'spotify',
      embedUrl: 'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT',
    });
    expect(detectEmbed('https://open.spotify.com/intl-es/album/1ATL5GLyefJaxhQzSPVrLX')).toMatchObject({
      embedType: 'spotify',
      embedUrl: 'https://open.spotify.com/embed/album/1ATL5GLyefJaxhQzSPVrLX',
    });
  });

  it('SoundCloud', () => {
    const info = detectEmbed('https://soundcloud.com/artista/tema');
    expect(info.embedType).toBe('soundcloud');
    expect(info.embedUrl).toContain('w.soundcloud.com/player');
  });

  it('X / Twitter', () => {
    expect(detectEmbed('https://x.com/usuario/status/1234567890')).toMatchObject({
      embedType: 'twitter',
      embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=1234567890',
    });
    expect(detectEmbed('https://twitter.com/usuario/status/1234567890')).toMatchObject({
      embedType: 'twitter',
    });
  });

  it('Google Maps por consulta, lugar y coordenadas', () => {
    expect(detectEmbed('https://www.google.com/maps?q=Museo+del+Prado')).toMatchObject({
      embedType: 'maps',
      embedUrl: 'https://www.google.com/maps?q=Museo%20del%20Prado&output=embed',
    });
    expect(detectEmbed('https://www.google.com/maps/place/Buenos+Aires')).toMatchObject({
      embedType: 'maps',
    });
    expect(detectEmbed('https://www.google.com/maps/@-34.6037,-58.3816,12z')).toMatchObject({
      embedUrl: 'https://www.google.com/maps?q=-34.6037,-58.3816&output=embed',
    });
  });

  it('Figma, Loom y CodePen', () => {
    expect(detectEmbed('https://www.figma.com/file/ABC123/Mi-diseno')).toMatchObject({
      embedType: 'figma',
    });
    expect(detectEmbed('https://www.loom.com/share/abc123def')).toMatchObject({
      embedType: 'loom',
      embedUrl: 'https://www.loom.com/embed/abc123def',
    });
    expect(detectEmbed('https://codepen.io/usuario/pen/abcDEF')).toMatchObject({
      embedType: 'codepen',
      embedUrl: 'https://codepen.io/usuario/embed/abcDEF',
    });
  });

  it('un sitio cualquiera no se incrusta', () => {
    expect(detectEmbed('https://nodejs.org/es/blog')).toEqual({ embedType: 'generic', embedUrl: null });
    expect(detectEmbed('no-es-url')).toEqual({ embedType: 'generic', embedUrl: null });
    // Un dominio parecido al de un proveedor no debe colarse.
    expect(detectEmbed('https://notyoutube.com/watch?v=abc')).toMatchObject({ embedType: 'generic' });
  });
});

describe('alto del incrustado', () => {
  it('respeta el 16:9 de los vídeos', () => {
    expect(embedHeight('youtube', 320)).toBe(180);
    expect(embedHeight('vimeo', 300)).toBe(169);
  });

  it('los que no se incrustan miden cero y no son incrustables', () => {
    expect(embedHeight('generic', 320)).toBe(0);
    expect(isEmbeddable('generic')).toBe(false);
    expect(isEmbeddable('youtube')).toBe(true);
    expect(isEmbeddable('spotify')).toBe(true);
  });
});

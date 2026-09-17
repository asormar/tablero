/**
 * Pruebas de la importación (fase 4, punto 3): detección de formato, lectura del
 * ZIP de copia de seguridad, Markdown a texto plano y títulos de archivo.
 */

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  decodeState,
  detectImportKind,
  extensionOf,
  markdownToPlainText,
  parseBackupZip,
  titleFromFileName,
} from './importers';

describe('extensionOf / detectImportKind', () => {
  it('saca la extensión en minúsculas', () => {
    expect(extensionOf('Foto.JPG')).toBe('jpg');
    expect(extensionOf('sin-extension')).toBe('');
  });

  it('reconoce los formatos aceptados', () => {
    expect(detectImportKind('respaldo.zip')).toBe('zip');
    expect(detectImportKind('notas.md')).toBe('markdown');
    expect(detectImportKind('cualquiera', 'text/markdown')).toBe('markdown');
    expect(detectImportKind('datos.csv')).toBe('csv');
    expect(detectImportKind('datos.tsv')).toBe('csv');
    expect(detectImportKind('foto.png')).toBe('image');
    expect(detectImportKind('foto', 'image/webp')).toBe('image');
    expect(detectImportKind('libro.epub')).toBe('unknown');
  });
});

describe('decodeState', () => {
  it('acepta bytes tal cual', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(decodeState(bytes)).toBe(bytes);
  });

  it('acepta un array de números', () => {
    expect([...decodeState([1, 2, 255])!]).toEqual([1, 2, 255]);
  });

  it('descodifica base64 (round-trip con btoa)', () => {
    const original = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const base64 = btoa(String.fromCharCode(...original));
    expect([...decodeState(base64)!]).toEqual([...original]);
  });

  it('devuelve null con entradas inválidas', () => {
    expect(decodeState(null)).toBeNull();
    expect(decodeState('')).toBeNull();
    expect(decodeState({})).toBeNull();
  });
});

describe('parseBackupZip', () => {
  it('lee el JSON del documento y los archivos bajo assets/', () => {
    const zip = zipSync({
      'board.json': strToU8(JSON.stringify({ title: 'Mi tablero', state: btoa('hola') })),
      'assets/foto.png': new Uint8Array([137, 80, 78, 71]),
      'leeme.txt': strToU8('no es un archivo'),
    });
    const parsed = parseBackupZip(zip);
    expect(parsed.title).toBe('Mi tablero');
    expect(parsed.state).not.toBeNull();
    expect(parsed.assets.map((asset) => asset.name)).toEqual(['foto.png']);
    expect(parsed.notes.some((note) => note.includes('archivo(s)'))).toBe(true);
  });

  it('acepta el formato sin Yjs (elements en JSON)', () => {
    const zip = zipSync({
      'board.json': strToU8(JSON.stringify({ title: 'Sin Yjs', elements: [{ type: 'note' }] })),
    });
    const parsed = parseBackupZip(zip);
    expect(parsed.state).toBeNull();
    expect(parsed.elements).toHaveLength(1);
  });

  it('informa cuando el JSON no parece una copia', () => {
    const zip = zipSync({ 'board.json': strToU8(JSON.stringify({ cualquier: 'cosa' })) });
    const parsed = parseBackupZip(zip);
    expect(parsed.state).toBeNull();
    expect(parsed.elements).toEqual([]);
    expect(parsed.notes.some((note) => note.includes('ni documento Yjs'))).toBe(true);
  });

  it('no lanza con un ZIP ilegible', () => {
    const parsed = parseBackupZip(new Uint8Array([1, 2, 3, 4]));
    expect(parsed.notes[0]).toContain('No se pudo descomprimir');
  });

  it('avisa de un ZIP vacío', () => {
    const parsed = parseBackupZip(zipSync({}));
    expect(parsed.notes).toContain('El ZIP está vacío.');
  });
});

describe('markdownToPlainText', () => {
  it('quita encabezados, énfasis, listas y código', () => {
    const markdown = [
      '# Título',
      '',
      'Un texto con **negrita** y `código`.',
      '',
      '- uno',
      '- dos',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      '[Enlace](https://ejemplo.com)',
    ].join('\n');
    const text = markdownToPlainText(markdown);
    expect(text).not.toContain('#');
    expect(text).not.toContain('**');
    expect(text).not.toContain('```');
    expect(text).toContain('negrita');
    expect(text).toContain('· uno');
    expect(text).toContain('Enlace (https://ejemplo.com)');
  });

  it('colapsa las líneas vacías de más', () => {
    expect(markdownToPlainText('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('titleFromFileName', () => {
  it('saca la extensión y los directorios', () => {
    expect(titleFromFileName('C:\\cosas\\Mi plan.md')).toBe('Mi plan');
    expect(titleFromFileName('notas.csv')).toBe('notas');
  });

  it('cae a «Importado» si no queda texto', () => {
    expect(titleFromFileName('  .md')).toBe('Importado');
    expect(titleFromFileName('   ')).toBe('Importado');
  });

  it('un archivo oculto conserva su nombre', () => {
    expect(titleFromFileName('.md')).toBe('.md');
  });
});

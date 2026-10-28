/**
 * Guarda contra el voseo en los textos de la interfaz.
 *
 * Los textos en español van en tuteo neutro («Prueba», «Escribe», «puedes»). Esta
 * prueba lee todo el código de `src` (menos las pruebas), le quita los
 * comentarios y falla si queda alguna forma de voseo: cualquier cadena o texto
 * de JSX que la contenga. Se revisa el código ya sin comentarios en lugar de
 * aislar solo las cadenas porque las formas de la lista llevan tilde final y no
 * existen como identificadores, así que no hay falsos positivos y se evita
 * tener que parsear JSX.
 *
 * Los comentarios quedan fuera a propósito: no los ve el usuario.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Formas de voseo que no deben aparecer. La búsqueda ignora mayúsculas y exige
 * que la palabra no esté pegada a otras letras (con `\p{L}`, porque `\b` de
 * JavaScript no reconoce las vocales con tilde como parte de una palabra).
 *
 * - Imperativos: probá, escribí, elegí, hacé, tocá, creá, usá, abrí, pegá,
 *   arrastrá, soltá, mirá, reconectá, restaurá, guardá, copiá, reiniciá,
 *   seleccioná, agregá, ingresá, cambiá, intentá, revisá, confirmá, descargá,
 *   dejá, buscá, volvé, poné.
 * - Presente de «vos»: tenés, podés, querés, hacés, sabés, sos.
 * - Adverbio rioplatense: acá.
 *
 * «abrí», «escribí» o «elegí» también son un pretérito de primera persona, pero
 * en un texto de interfaz nunca van en esa forma.
 */
export const VOSEO_TOKENS: readonly string[] = [
  'probá',
  'escribí',
  'elegí',
  'hacé',
  'tocá',
  'creá',
  'usá',
  'abrí',
  'pegá',
  'arrastrá',
  'soltá',
  'mirá',
  'reconectá',
  'restaurá',
  'guardá',
  'copiá',
  'reiniciá',
  'seleccioná',
  'agregá',
  'ingresá',
  'cambiá',
  'intentá',
  'revisá',
  'confirmá',
  'descargá',
  'dejá',
  'buscá',
  'volvé',
  'poné',
  'tenés',
  'podés',
  'querés',
  'hacés',
  'sabés',
  'sos',
  'acá',
];

const VOSEO_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${VOSEO_TOKENS.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');

/** Caracteres tras los que una `/` abre una expresión regular y no una división. */
const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '~', '^']);

function skipString(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;
  // Una cadena de comillas simples o dobles no cruza el salto de línea.
  while (index < source.length && source[index] !== quote && source[index] !== '\n') {
    if (source[index] === '\\') index += 1;
    index += 1;
  }
  return Math.min(index + 1, source.length);
}

/** Sale de las llaves de `${…}` y devuelve la posición siguiente a la `}` de cierre. */
function skipTemplateExpression(source: string, start: number): number {
  let depth = 1;
  let index = start;
  while (index < source.length && depth > 0) {
    const char = source[index]!;
    if (char === '`') index = skipTemplate(source, index);
    else if (char === '"' || char === "'") index = skipString(source, index);
    else {
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      index += 1;
    }
  }
  return index;
}

function skipTemplate(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length && source[index] !== '`') {
    if (source[index] === '\\') index += 2;
    else if (source[index] === '$' && source[index + 1] === '{') index = skipTemplateExpression(source, index + 2);
    else index += 1;
  }
  return Math.min(index + 1, source.length);
}

function skipRegex(source: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < source.length && source[index] !== '\n') {
    const char = source[index]!;
    if (char === '\\') index += 1;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) break;
    index += 1;
  }
  index += 1;
  while (index < source.length && /[a-z]/i.test(source[index]!)) index += 1;
  return Math.min(index, source.length);
}

/** Quita los comentarios de línea y de bloque respetando cadenas, plantillas y expresiones regulares. */
export function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let previous = '';
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end < 0 ? source.length : end + 2;
      // Se conservan los saltos de línea para no descolocar los números de línea.
      out += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
      continue;
    }
    let stop = index + 1;
    if (char === '"' || char === "'") stop = skipString(source, index);
    else if (char === '`') stop = skipTemplate(source, index);
    else if (char === '/') {
      const keyword = /(?:return|typeof|case|in|of)\s*$/.test(out.slice(-12));
      if (REGEX_PRECEDERS.has(previous) || keyword) stop = skipRegex(source, index);
    }
    const piece = source.slice(index, stop);
    out += piece;
    const last = piece.trimEnd().slice(-1);
    if (last !== '') previous = last;
    index = stop;
  }
  return out;
}

/** Formas de voseo que quedan en el código (con la línea donde aparecen). */
export function findVoseo(source: string): { line: number; token: string }[] {
  const found: { line: number; token: string }[] = [];
  stripComments(source)
    .split('\n')
    .forEach((text, index) => {
      for (const match of text.matchAll(VOSEO_PATTERN)) found.push({ line: index + 1, token: match[0] });
    });
  return found;
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
  }
  return files;
}

describe('stripComments y findVoseo', () => {
  it('ignora los comentarios de línea y de bloque', () => {
    const source = ['// Probá esto', '/* Escribí', '   acá */', 'const a = 1; // tenés razón'].join('\n');
    expect(findVoseo(source)).toEqual([]);
  });

  it('detecta el voseo en cadenas, plantillas y texto de JSX', () => {
    expect(findVoseo("const a = 'Probá de nuevo';")).toEqual([{ line: 1, token: 'Probá' }]);
    expect(findVoseo('const b = "Elegí un color";')).toEqual([{ line: 1, token: 'Elegí' }]);
    expect(findVoseo('const c = `Si querés ${x}`;')).toEqual([{ line: 1, token: 'querés' }]);
    expect(findVoseo('return <p>Tocá acá para seguir</p>;').map((hit) => hit.token)).toEqual(['Tocá', 'acá']);
  });

  it('no toma por comentario una `//` dentro de una cadena ni una expresión regular', () => {
    expect(findVoseo("const url = 'https://ejemplo.com'; const t = 'Usá esto';").map((hit) => hit.token)).toEqual(['Usá']);
    expect(findVoseo("const re = /['’]/; const t = 'Guardá';").map((hit) => hit.token)).toEqual(['Guardá']);
    expect(findVoseo('const t = `a ${cond ? `b` : "c"} Pegá`;').map((hit) => hit.token)).toEqual(['Pegá']);
  });

  it('cuenta bien las líneas y no confunde el tuteo con voseo', () => {
    expect(findVoseo("const a = 'Prueba';\nconst b = 'Escribe, elige, puedes';\nconst c = 'Acá';")).toEqual([
      { line: 3, token: 'Acá' },
    ]);
  });

  it('no marca palabras que solo contienen una forma de la lista', () => {
    expect(findVoseo("const a = 'sosa pegado acaba';")).toEqual([]);
  });
});

describe('textos de la interfaz sin voseo', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = sourceFiles(root);

  it('recorre el código fuente de la web', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('ninguna cadena ni texto de JSX usa formas de voseo', () => {
    const offenders = files.flatMap((file) =>
      findVoseo(readFileSync(file, 'utf8')).map((hit) => `${relative(root, file)}:${hit.line} «${hit.token}»`),
    );
    expect(offenders, `Voseo en textos de la interfaz (usa tuteo neutro):\n${offenders.join('\n')}`).toEqual([]);
  });
});

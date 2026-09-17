/**
 * Escritor ZIP en streaming: estructura y CRC verificados con un lector
 * independiente (directorio central + `inflateRawSync` + un CRC32 calculado bit
 * a bit, distinto al de la implementación).
 */

import { Readable, Writable } from 'node:stream';
import { inflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { Crc32, ZipWriter, crc32, safeZipName, safeZipPath } from './zip.js';

/** CRC32 sin tabla: implementación independiente para verificar la del módulo. */
function crc32Bitwise(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type Entry = { name: string; method: number; data: Buffer; crc: number; crcOk: boolean; flags: number };

function readZip(buffer: Buffer): Entry[] {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(0);
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries: Entry[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    entries.push({ name, method, data, crc, crcOk: crc32Bitwise(data) === crc, flags });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function collect(): { stream: Writable; finish: () => Buffer } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { stream, finish: () => Buffer.concat(chunks) };
}

describe('ZipWriter', () => {
  it('escribe entradas comprimidas y sin comprimir con CRC correcto', async () => {
    const { stream, finish } = collect();
    const writer = new ZipWriter(stream, new Date(2026, 8, 17, 12, 0, 0));
    await writer.addBuffer('board.json', Buffer.from(JSON.stringify({ hola: 'ñandú' }), 'utf8'));
    await writer.addBuffer('assets/nota.txt', Buffer.from('texto plano'), { compress: false });
    await writer.finalize();

    const entries = readZip(finish());
    expect(entries.map((entry) => entry.name)).toEqual(['board.json', 'assets/nota.txt']);
    expect(entries[0]!.method).toBe(8);
    expect(entries[1]!.method).toBe(0);
    expect(entries.every((entry) => entry.crcOk)).toBe(true);
    expect(JSON.parse(entries[0]!.data.toString('utf8')).hola).toBe('ñandú');
    expect(entries.every((entry) => (entry.flags & 0x0800) !== 0)).toBe(true); // UTF-8
  });

  it('agrega un stream con descriptor de datos (sin conocer el CRC de antemano)', async () => {
    const { stream, finish } = collect();
    const writer = new ZipWriter(stream);
    const payload = Buffer.from('archivo binario de prueba', 'utf8');
    const source = Readable.from([payload.subarray(0, 5), payload.subarray(5)]);
    await writer.addStream('assets/foto.bin', payload.length, source);
    await writer.finalize();

    const entries = readZip(finish());
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('assets/foto.bin');
    expect(entries[0]!.method).toBe(0);
    expect((entries[0]!.flags & 0x0008) !== 0).toBe(true);
    expect(entries[0]!.crcOk).toBe(true);
    expect(entries[0]!.data.toString('utf8')).toBe('archivo binario de prueba');
  });

  it('falla si el stream llega incompleto (no escribe un ZIP mentiroso)', async () => {
    const { stream } = collect();
    const writer = new ZipWriter(stream);
    const source = Readable.from([Buffer.from('corto')]);
    await expect(writer.addStream('assets/x.bin', 100, source)).rejects.toThrow(/incompleto/);
  });

  it('el CRC incremental coincide con el de una sola pasada', () => {
    const data = Buffer.from('El veloz murciélago hindú comía feliz cardillo y kiwi');
    const incremental = new Crc32();
    incremental.update(data.subarray(0, 10));
    incremental.update(data.subarray(10));
    expect(incremental.digest).toBe(crc32(data));
    expect(crc32(data)).toBe(crc32Bitwise(data));
  });
});

describe('nombres seguros', () => {
  it('quita separadores y caracteres de control', () => {
    expect(safeZipName('a/b\\c.txt')).toBe('a-b-c.txt');
    expect(safeZipName('  ../../etc/passwd')).toBe('..-..-etc-passwd');
    expect(safeZipName('')).toBe('archivo');
    expect(safeZipName('..')).toBe('archivo');
  });

  it('conserva los separadores al armar una ruta', () => {
    expect(safeZipPath(['boards', '01-Inicio', 'board.json'])).toBe('boards/01-Inicio/board.json');
  });
});

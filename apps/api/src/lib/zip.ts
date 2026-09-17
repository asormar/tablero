/**
 * Escritor ZIP en streaming, sin dependencias externas.
 *
 * Por qué a mano: la exportación tiene que incluir los archivos reales de MinIO
 * sin cargarlos enteros en memoria y sin sumar una dependencia (el cliente lee
 * el ZIP con `fflate`; el servidor solo necesita *escribirlo*). Se usa:
 *
 *   - método *deflate* (8) para las entradas que ya están en memoria (JSON,
 *     Markdown): se comprimen de una con `zlib.deflateRawSync` y se conocen
 *     tamaños y CRC antes de escribir el encabezado.
 *   - método *store* (0) para los archivos que llegan como stream de MinIO: el
 *     encabezado local se escribe con la bandera de descriptor de datos
 *     (bit 3) y, al terminar el flujo, se agrega el descriptor con el CRC y los
 *     tamaños. El directorio central queda con los valores reales, que es lo
 *     que leen los extractores (Python `zipfile`, `unzip`, `fflate`).
 *
 * Límite conocido: ZIP clásico (sin ZIP64), así que un archivo >= 4 GiB o un
 * archivo comprimido de más de 4 GiB falla con un error claro.
 */

import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;

/** Bandera de descriptor de datos (tamaños y CRC después de los datos). */
const FLAG_DATA_DESCRIPTOR = 0x0008;
/** Bandera de nombres en UTF-8 (bit 11). */
const FLAG_UTF8 = 0x0800;

const MAX_ZIP32 = 0xffffffff;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC32 incremental (el estado arranca en 0xffffffff y se invierte al final). */
export class Crc32 {
  private value = 0xffffffff;

  update(chunk: Buffer): void {
    let crc = this.value;
    for (let index = 0; index < chunk.length; index += 1) {
      crc = CRC_TABLE[(crc ^ chunk[index]!) & 0xff]! ^ (crc >>> 8);
    }
    this.value = crc >>> 0;
  }

  get digest(): number {
    return (this.value ^ 0xffffffff) >>> 0;
  }
}

export function crc32(data: Buffer): number {
  const crc = new Crc32();
  crc.update(data);
  return crc.digest;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, date: day };
}

type CentralEntry = {
  name: Buffer;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  time: number;
  date: number;
};

function localHeader(entry: {
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  time: number;
  date: number;
  name: Buffer;
}): Buffer {
  const header = Buffer.alloc(30 + entry.name.length);
  header.writeUInt32LE(LOCAL_SIGNATURE, 0);
  header.writeUInt16LE(20, 4); // versión necesaria
  header.writeUInt16LE(entry.flags, 6);
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(entry.time, 10);
  header.writeUInt16LE(entry.date, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressedSize, 18);
  header.writeUInt32LE(entry.uncompressedSize, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28); // sin campo extra
  entry.name.copy(header, 30);
  return header;
}

function centralHeader(entry: CentralEntry): Buffer {
  const header = Buffer.alloc(46 + entry.name.length);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  header.writeUInt16LE(20, 4); // versión que lo creó
  header.writeUInt16LE(20, 6); // versión necesaria
  header.writeUInt16LE(entry.flags, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(entry.time, 12);
  header.writeUInt16LE(entry.date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.uncompressedSize, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30); // extra
  header.writeUInt16LE(0, 32); // comentario
  header.writeUInt16LE(0, 34); // disco
  header.writeUInt16LE(0, 36); // atributos internos
  header.writeUInt32LE(0, 38); // atributos externos
  header.writeUInt32LE(entry.offset, 42);
  entry.name.copy(header, 46);
  return header;
}

/** Escritor de un ZIP secuencial sobre un `Writable` (no lo cierra). */
export class ZipWriter {
  private offset = 0;
  private readonly entries: CentralEntry[] = [];

  constructor(
    private readonly out: Writable,
    private readonly now: Date = new Date(),
  ) {}

  private async write(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;
    if (this.offset > MAX_ZIP32) {
      throw new Error('La exportación supera los 4 GiB del ZIP clásico (haría falta ZIP64)');
    }
    if (!this.out.write(chunk)) await once(this.out, 'drain');
  }

  /** Entrada desde un buffer (JSON, Markdown, texto): se comprime con deflate. */
  async addBuffer(name: string, data: Buffer, options: { compress?: boolean } = {}): Promise<void> {
    const compress = options.compress ?? true;
    const payload = compress ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const { time, date } = dosDateTime(this.now);
    const nameBytes = Buffer.from(name, 'utf8');
    const offset = this.offset;
    const method = compress ? 8 : 0;
    const flags = FLAG_UTF8;
    await this.write(
      localHeader({
        flags,
        method,
        crc,
        compressedSize: payload.length,
        uncompressedSize: data.length,
        time,
        date,
        name: nameBytes,
      }),
    );
    await this.write(payload);
    this.entries.push({
      name: nameBytes,
      method,
      flags,
      crc,
      compressedSize: payload.length,
      uncompressedSize: data.length,
      offset,
      time,
      date,
    });
  }

  /**
   * Entrada desde un stream con tamaño conocido (método *store*): el CRC y los
   * tamaños van en el descriptor posterior, no en el encabezado.
   */
  async addStream(name: string, size: number, source: Readable): Promise<void> {
    if (size > MAX_ZIP32) throw new Error(`«${name}» supera los 4 GiB y no entra en un ZIP clásico`);
    const { time, date } = dosDateTime(this.now);
    const nameBytes = Buffer.from(name, 'utf8');
    const offset = this.offset;
    const flags = FLAG_UTF8 | FLAG_DATA_DESCRIPTOR;
    const crc = new Crc32();
    let written = 0;

    await this.write(
      localHeader({
        flags,
        method: 0,
        crc: 0,
        compressedSize: 0,
        uncompressedSize: 0,
        time,
        date,
        name: nameBytes,
      }),
    );

    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      crc.update(buffer);
      written += buffer.length;
      await this.write(buffer);
    }
    if (written !== size) {
      throw new Error(`El archivo «${name}» llegó incompleto (${written} de ${size} bytes)`);
    }

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
    descriptor.writeUInt32LE(crc.digest, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    await this.write(descriptor);

    this.entries.push({
      name: nameBytes,
      method: 0,
      flags,
      crc: crc.digest,
      compressedSize: size,
      uncompressedSize: size,
      offset,
      time,
      date,
    });
  }

  /** Directorio central + fin del directorio. Deja el `Writable` abierto. */
  async finalize(): Promise<void> {
    const directoryOffset = this.offset;
    for (const entry of this.entries) await this.write(centralHeader(entry));
    const directorySize = this.offset - directoryOffset;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
    eocd.writeUInt16LE(0, 4); // número de disco
    eocd.writeUInt16LE(0, 6); // disco del directorio
    eocd.writeUInt16LE(Math.min(this.entries.length, 0xffff), 8);
    eocd.writeUInt16LE(Math.min(this.entries.length, 0xffff), 10);
    eocd.writeUInt32LE(directorySize, 12);
    eocd.writeUInt32LE(directoryOffset, 16);
    eocd.writeUInt16LE(0, 20); // sin comentario
    await this.write(eocd);
  }

  get entryCount(): number {
    return this.entries.length;
  }
}

/**
 * Nombre seguro dentro del ZIP: sin separadores de ruta, sin caracteres de
 * control y con un largo razonable. Los acentos se conservan (UTF-8).
 */
export function safeZipName(name: string, fallback = 'archivo'): string {
  const cleaned = name
    .replace(/[\\/]+/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  const limited = cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
  return limited.length > 0 ? limited : fallback;
}

/** Ruta segura dentro del ZIP conservando los separadores (`a/b/c.json`). */
export function safeZipPath(segments: string[]): string {
  return segments.map((segment) => safeZipName(segment)).join('/');
}

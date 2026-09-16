/**
 * Forma de onda de un audio: picos por tramo.
 *
 * Los picos se calculan una vez por archivo y se guardan en memoria (no en el
 * documento Yjs: son derivados del binario y cada cliente los puede recalcular).
 * La parte de cálculo es pura; la de decodificación usa `AudioContext`.
 */

/** Picos (0..1) por tramo, tomando el máximo absoluto de cada tramo. */
export function computePeaks(channels: ArrayLike<number>, buckets: number): number[] {
  const total = channels.length;
  if (total === 0 || buckets <= 0) return [];
  const size = Math.max(1, Math.floor(total / buckets));
  const peaks: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * size;
    if (start >= total) break;
    const end = Math.min(total, start + size);
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(channels[index] ?? 0);
      if (value > peak) peak = value;
    }
    peaks.push(peak);
  }
  // Normalización: el pico más alto llega a 1 para que se vea toda la onda.
  let max = 0;
  for (const peak of peaks) if (peak > max) max = peak;
  if (max > 0) {
    for (let index = 0; index < peaks.length; index += 1) {
      peaks[index] = (peaks[index] ?? 0) / max;
    }
  }
  return peaks;
}

/** Mezcla los canales en uno (mono) para dibujar la onda. */
export function mixChannels(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0] as Float32Array;
  const length = Math.min(...channels.map((channel) => channel.length));
  const mixed = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index] ?? 0;
    mixed[index] = sum / channels.length;
  }
  return mixed;
}

/** Trazo SVG de la forma de onda, útil para la tarjeta de audio. */
export function peaksToPath(peaks: readonly number[], width: number, height: number): string {
  if (peaks.length === 0 || width <= 0 || height <= 0) return '';
  const mid = height / 2;
  const step = width / peaks.length;
  const bars: string[] = [];
  peaks.forEach((peak, index) => {
    const x = index * step;
    const half = Math.max(0.5, (peak * height) / 2);
    bars.push(`M${x.toFixed(2)} ${(mid - half).toFixed(2)}V${(mid + half).toFixed(2)}`);
  });
  return bars.join(' ');
}

const cache = new Map<string, number[]>();
const pending = new Map<string, Promise<number[]>>();

/** Picos ya calculados para una URL, si los hay. */
export function cachedPeaks(url: string): number[] | null {
  return cache.get(url) ?? null;
}

/**
 * Picos de un audio remoto: descarga, decodifica con `AudioContext` y cachea.
 * Devuelve [] si el navegador no puede decodificarlo (formato no soportado).
 */
export async function peaksForUrl(url: string, buckets = 96): Promise<number[]> {
  const key = `${url}#${buckets}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const job = (async () => {
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) return [];
      const bytes = await response.arrayBuffer();
      const AudioCtor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return [];
      const context = new AudioCtor();
      try {
        const buffer = await context.decodeAudioData(bytes.slice(0));
        const mixed = mixChannels(
          Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index)),
        );
        const peaks = computePeaks(mixed, buckets);
        cache.set(key, peaks);
        return peaks;
      } finally {
        void context.close();
      }
    } catch {
      return [];
    } finally {
      pending.delete(key);
    }
  })();

  pending.set(key, job);
  return job;
}

export function forgetPeaks(url: string): void {
  for (const key of [...cache.keys()]) if (key.startsWith(`${url}#`)) cache.delete(key);
}

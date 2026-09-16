/**
 * Contador de rendimiento (solo desarrollo).
 *
 * Mide con `requestAnimationFrame` los FPS y cuántas tarjetas se renderizan por
 * frame. Sirve para comprobar el criterio de la fase: mover una nota no debe
 * re-renderizar las otras, y 300 notas visibles deben moverse a 60 fps.
 */

import { useEffect, useRef, useState } from 'react';

import { endFrame, isDevBuild } from '@/lib/renderStats';

type Sample = { fps: number; peakRenders: number; mounted: number; visible: number };

export function PerfOverlay(): JSX.Element | null {
  const [sample, setSample] = useState<Sample>({ fps: 0, peakRenders: 0, mounted: 0, visible: 0 });
  const peak = useRef(0);

  useEffect(() => {
    if (!isDevBuild) return;
    let frame = 0;
    let last = performance.now();
    let counter = 0;

    const tick = (now: number): void => {
      const stats = endFrame(now - last);
      last = now;
      peak.current = Math.max(peak.current, stats.lastFrameRenders);
      counter += 1;
      if (counter >= 20) {
        counter = 0;
        setSample({
          fps: Math.round(stats.fps),
          peakRenders: peak.current,
          mounted: stats.mounted,
          visible: stats.visible,
        });
        peak.current = 0;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!isDevBuild) return null;

  return (
    <div className="perf" title="Rendimiento (solo en desarrollo)">
      <span className="perf__value">{sample.fps}</span>
      <span className="perf__unit">fps</span>
      <span className="perf__sep" />
      <span className="perf__label">renders/frame</span>
      <span className="perf__value">{sample.peakRenders}</span>
      <span className="perf__sep" />
      <span className="perf__label">tarjetas</span>
      <span className="perf__value">
        {sample.mounted}/{sample.visible}
      </span>
    </div>
  );
}

/**
 * Grabación de audio desde el navegador (MediaRecorder).
 *
 * Flujo: permiso → grabar/parar → el blob se convierte en `File` y se sube como
 * cualquier otro archivo (tarjeta de audio con su forma de onda). Si el permiso
 * se deniega o el navegador no soporta la grabación, se avisa y no se rompe
 * nada.
 */

import { useEffect, useRef, useState } from 'react';

import { Mic, Square, X } from 'lucide-react';

import { attachFilesToBoard } from '@/canvas/uploadController';
import { spawnPoint } from '@/canvas/commands';
import type { BoardSession } from '@/collab/BoardSession';
import { formatDuration } from '@tablero/shared';
import { useUiStore } from '@/state/uiStore';

type Phase = 'idle' | 'requesting' | 'recording' | 'saving' | 'error';

/** MIME preferido, con alternativas por navegador. */
function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

function recordingName(mime: string): string {
  const stamp = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
  return `grabación ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}.${pad(stamp.getMinutes())}.${extension}`;
}

export function RecorderPanel({ session }: { session: BoardSession }): JSX.Element | null {
  const open = useUiStore((state) => state.recorderOpen);
  const setOpen = useUiStore((state) => state.setRecorderOpen);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const cleanup = (): void => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  };

  useEffect(() => {
    if (open) return undefined;
    // Cerrar el panel cancela lo que estuviera en marcha.
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
    setPhase('idle');
    setElapsed(0);
    setLevel(0);
    cleanup();
    return undefined;
  }, [open]);

  useEffect(() => () => cleanup(), []);

  if (!open) return null;

  const startMeter = (stream: MediaStream): void => {
    try {
      const AudioCtor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      const context = new AudioCtor();
      audioContextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = (): void => {
        if (!audioContextRef.current) return;
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value - 128) / 128);
        setLevel(peak);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      // Sin medidor: la grabación sigue igual.
    }
  };

  const start = async (): Promise<void> => {
    setError(null);
    setPhase('requesting');
    try {
      if (typeof MediaRecorder === 'undefined') throw new Error('Este navegador no sabe grabar audio');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startMeter(stream);
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const file = new File([blob], recordingName(type), { type });
        cleanup();
        setPhase('saving');
        void attachFilesToBoard(session, [file], { world: spawnPoint() })
          .then(() => {
            setPhase('idle');
            setElapsed(0);
            setOpen(false);
          })
          .catch((cause: unknown) => {
            setPhase('error');
            setError(cause instanceof Error ? cause.message : 'No se pudo guardar la grabación');
          });
      };
      recorder.start();
      recorderRef.current = recorder;
      setPhase('recording');
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((value) => value + 1), 1000);
    } catch (cause) {
      cleanup();
      setPhase('error');
      const message = cause instanceof Error ? cause.message : 'No se pudo acceder al micrófono';
      setError(
        message.includes('denied') || message.includes('Permission')
          ? 'Permiso de micrófono denegado'
          : message,
      );
    }
  };

  const stop = (): void => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.stop();
    recorderRef.current = null;
  };

  return (
    <div className="recorder" role="dialog" aria-modal="true" aria-label="Grabar audio">
      <div className="recorder__panel">
        <header className="recorder__head">
          <h2 className="recorder__title">
            <Mic size={15} /> Grabar audio
          </h2>
          <button type="button" className="icon-button" title="Cerrar" onClick={() => setOpen(false)}>
            <X size={15} />
          </button>
        </header>

        <div className="recorder__body">
          <span className="recorder__timer">{formatDuration(elapsed)}</span>
          <div className="recorder__meter" aria-hidden="true">
            <span style={{ width: `${Math.round(Math.min(1, level * 1.4) * 100)}%` }} />
          </div>
          <p className="recorder__hint">
            {phase === 'recording'
              ? 'Grabando… al detener se sube como tarjeta de audio.'
              : phase === 'saving'
                ? 'Subiendo la grabación…'
                : 'Se pedirá permiso al micrófono. La grabación queda como un archivo más.'}
          </p>
          {error ? <p className="recorder__error">{error}</p> : null}
        </div>

        <footer className="recorder__foot">
          {phase === 'recording' ? (
            <button type="button" className="recorder__button recorder__button--stop" onClick={stop}>
              <Square size={13} /> Detener
            </button>
          ) : (
            <button
              type="button"
              className="recorder__button recorder__button--record"
              disabled={phase === 'requesting' || phase === 'saving'}
              onClick={() => void start()}
            >
              <Mic size={13} /> Grabar
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

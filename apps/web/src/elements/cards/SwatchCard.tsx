/**
 * Muestra de color.
 *
 * Rectángulo con el color, nombre editable y los tres formatos (HEX, RGB, HSL)
 * copiables al clic. Se puede cambiar con el selector nativo y, donde esté
 * disponible, con el cuentagotas del sistema (`EyeDropper`).
 */

import { useState } from 'react';

import { Copy, Droplet, Pipette } from 'lucide-react';

import {
  formatHsl,
  formatRgb,
  normalizeColor,
  readableTextOn,
} from '@tablero/shared';

import { updateSwatch } from '@/canvas/contentCommands';
import { InlineEdit } from '@/elements/InlineEdit';

import type { CardProps } from './AssetCards';

type Format = 'hex' | 'rgb' | 'hsl';

function copyText(value: string): void {
  void navigator.clipboard?.writeText(value).catch(() => undefined);
}

export function SwatchCard({ session, element, simplified }: CardProps): JSX.Element {
  const hex = element.type === 'swatch' ? normalizeColor(element.hex) ?? '#000000' : '#000000';
  const name = element.type === 'swatch' ? element.name ?? '' : '';
  const [copied, setCopied] = useState<Format | null>(null);
  const textColor = readableTextOn(hex);

  const flash = (format: Format, value: string): void => {
    copyText(value);
    setCopied(format);
    setTimeout(() => setCopied((current) => (current === format ? null : current)), 1200);
  };

  const rgb = formatRgb(hex);
  const hsl = formatHsl(hex);

  const pickEyeDropper = async (): Promise<void> => {
    const Ctor = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } })
      .EyeDropper;
    if (!Ctor) return;
    try {
      const result = await new Ctor().open();
      const normalized = normalizeColor(result.sRGBHex);
      if (normalized) updateSwatch(session, element.id, { hex: normalized });
    } catch {
      // El usuario canceló el cuentagotas.
    }
  };

  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  return (
    <div className="swatch-card" style={{ background: hex, color: textColor }} data-hex={hex}>
      <div className="swatch-card__head">
        <InlineEdit
          value={name}
          placeholder="Nombre"
          ariaLabel="Nombre de la muestra"
          className="swatch-card__name"
          onCommit={(next) => updateSwatch(session, element.id, { name: next })}
        />
      </div>

      <div className="swatch-card__formats">
        <button type="button" title="Copiar HEX" onClick={() => flash('hex', hex)} onPointerDown={(e) => e.stopPropagation()}>
          {copied === 'hex' ? '¡Copiado!' : hex}
        </button>
        {!simplified ? (
          <>
            <button type="button" title="Copiar RGB" onClick={() => flash('rgb', rgb)} onPointerDown={(e) => e.stopPropagation()}>
              {copied === 'rgb' ? '¡Copiado!' : rgb}
            </button>
            <button type="button" title="Copiar HSL" onClick={() => flash('hsl', hsl)} onPointerDown={(e) => e.stopPropagation()}>
              {copied === 'hsl' ? '¡Copiado!' : hsl}
            </button>
          </>
        ) : null}
      </div>

      {!simplified ? (
        <div className="swatch-card__tools" onPointerDown={(event) => event.stopPropagation()}>
          <label className="swatch-card__color" title="Elegir color">
            <Droplet size={12} />
            <input
              type="color"
              value={hex}
              aria-label="Elegir color de la muestra"
              onChange={(event) => {
                const normalized = normalizeColor(event.target.value);
                if (normalized) updateSwatch(session, element.id, { hex: normalized });
              }}
            />
          </label>
          {hasEyeDropper ? (
            <button type="button" title="Cuentagotas" onClick={() => void pickEyeDropper()}>
              <Pipette size={12} />
            </button>
          ) : null}
          <button
            type="button"
            title="Copiar HEX"
            onClick={() => flash('hex', hex)}
          >
            <Copy size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

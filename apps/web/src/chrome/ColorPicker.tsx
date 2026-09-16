/** Paleta de colores de tarjeta (los 13 tokens del paquete compartido). */

import { type ColorToken, COLOR_TOKENS, CARD_COLORS, shades } from '@tablero/shared';

export type ColorPickerProps = {
  value: ColorToken | undefined;
  onPick(token: ColorToken): void;
  className?: string;
};

export function ColorPicker({ value, onPick, className }: ColorPickerProps): JSX.Element {
  return (
    <div className={`colors${className ? ` ${className}` : ''}`} role="group" aria-label="Color">
      {COLOR_TOKENS.map((token) => {
        const palette = shades(token);
        const definition = CARD_COLORS[token];
        const active = (value ?? 'none') === token;
        return (
          <button
            key={token}
            type="button"
            className={`colors__swatch${active ? ' is-active' : ''}${token === 'none' ? ' is-none' : ''}`}
            style={{ background: palette.soft, color: palette.strong }}
            title={definition.label}
            aria-label={definition.label}
            aria-pressed={active}
            onClick={() => onPick(token)}
          >
            {active ? <span className="colors__dot" /> : null}
          </button>
        );
      })}
    </div>
  );
}

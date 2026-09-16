/**
 * Modo "barra espaciadora": mientras está activo, arrastrar sobre el lienzo
 * desplaza la vista en lugar de seleccionar.
 */

let active = false;

export function setSpacePan(value: boolean): void {
  if (active === value) return;
  active = value;
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('is-space-pan', value);
  }
}

export function isSpacePan(): boolean {
  return active;
}

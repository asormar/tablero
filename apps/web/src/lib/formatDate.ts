/**
 * Fechas y plazos con `Intl` y el idioma activo de la interfaz.
 *
 * Nada de `toLocaleDateString('es')` ni de «vence en N días» armado a mano:
 * el formato sale de `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` con la
 * lengua que eligió el usuario en los ajustes (`i18n`).
 */

import { getLanguage } from '@/i18n';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lengua activa de la interfaz como etiqueta BCP 47. */
export function activeLocale(): string {
  return getLanguage();
}

type DateInput = number | string | Date;

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Fecha corta legible: «27 oct 2026» / «Oct 27, 2026». Cadena vacía si no es válida. */
export function formatDate(value: DateInput, locale: string = activeLocale()): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

/** Fecha y hora cortas: «27 oct 2026, 14:05». Cadena vacía si no es válida. */
export function formatDateTime(value: DateInput, locale: string = activeLocale()): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** Días enteros (redondeados) entre `now` y `at`; negativo si ya pasó. */
export function daysUntil(at: number, now: number = Date.now()): number {
  return Math.round((at - now) / DAY_MS);
}

/** «mañana», «dentro de 3 días»… con `Intl.RelativeTimeFormat`. */
export function formatRelativeDays(days: number, locale: string = activeLocale()): string {
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
}

type ExpiryText = {
  none: string;
  expired: string;
  expires(when: string): string;
};

const EXPIRY_TEXT: Record<string, ExpiryText> = {
  es: { none: 'sin caducidad', expired: 'caducada', expires: (when) => `vence ${when}` },
  en: { none: 'no expiry', expired: 'expired', expires: (when) => `expires ${when}` },
};

/**
 * Texto de caducidad de una invitación: «vence hoy», «vence mañana»,
 * «vence dentro de 3 días», «caducada» o «sin caducidad».
 */
export function formatExpiry(at: number | null, now: number = Date.now(), locale: string = activeLocale()): string {
  const text = EXPIRY_TEXT[locale] ?? EXPIRY_TEXT.es!;
  if (!at) return text.none;
  if (at <= now) return text.expired;
  return text.expires(formatRelativeDays(daysUntil(at, now), locale));
}

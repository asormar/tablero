/**
 * Email saliente (fase 5): transporte enchufable.
 *
 * En desarrollo no hay servidor de correo configurado (y no se pide uno): el
 * transporte por defecto **escribe en el log** de la API, así el enlace de
 * invitación se ve en la consola y el resto del flujo funciona igual. Para
 * conectar un proveedor real alcanza con `setEmailTransport` al arrancar
 * (SMTP, API de un servicio, cola propia…); `EMAIL_TRANSPORT=none` lo apaga.
 *
 * Ningún camino de la API espera a que el email salga: un fallo del transporte
 * se registra y la invitación ya está creada (el enlace se puede copiar a mano
 * desde la interfaz).
 */

import { env } from '../env.js';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  /** Enlace principal del correo (invitaciones), para el log y los clientes. */
  url?: string;
};

export type EmailTransport = (message: EmailMessage) => Promise<void> | void;

const log: (message: EmailMessage) => void = (message) => {
  const lines = [
    `email → ${message.to}`,
    `  asunto: ${message.subject}`,
    ...(message.url ? [`  enlace: ${message.url}`] : []),
    ...message.text.split('\n').map((line) => `  ${line}`),
  ];
  // El log de arranque de Fastify no está disponible acá; se usa la consola del
  // proceso, que es lo que el operador mira en desarrollo.
  console.log(lines.join('\n'));
};

let transport: EmailTransport = log;

/** Estado del transporte para el log de arranque. */
export function emailTransportName(): string {
  return transport === log ? 'log' : 'custom';
}

/** Reemplaza el transporte (SMTP real, captura en tests…). */
export function setEmailTransport(next: EmailTransport): void {
  transport = next;
}

/** Vuelve al transporte por defecto (log). */
export function resetEmailTransport(): void {
  transport = log;
}

/** Emails enviados por el transporte actual (tests y humos). */
export const sentEmails: EmailMessage[] = [];

export async function sendEmail(message: EmailMessage): Promise<void> {
  sentEmails.push(message);
  if (sentEmails.length > 200) sentEmails.shift();
  if (process.env.EMAIL_TRANSPORT === 'none') return;
  try {
    await transport(message);
  } catch (error) {
    console.warn(`No se pudo enviar el email a ${message.to}: ${String(error)}`);
  }
}

/** Enlace de invitación que viaja en el correo (la web lo abre en `/invite/:token`). */
export function invitationLink(token: string): string {
  return `${env.appOrigin.replace(/\/$/, '')}/invite/${token}`;
}

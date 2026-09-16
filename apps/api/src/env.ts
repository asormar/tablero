/**
 * Configuración del proceso.
 *
 * Precedencia de variables: entorno real del proceso > `apps/api/.env` > `.env`
 * de la raíz del monorepo. Se leen a mano (sin dependencias) para que el
 * comportamiento sea el mismo con tsx, con `node --env-file` o en Docker.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Parseo mínimo de `.env`: `KEY=valor`, comillas opcionales, `#` al inicio. */
function parseEnvFile(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    if (key.length === 0 || value.length === 0) continue;
    values[key] = value;
  }
  return values;
}

/** Carga los `.env` disponibles sin pisar lo que ya venga del entorno. */
export function loadDotEnv(): string[] {
  const candidates = [
    resolve(here, '../.env'), // apps/api/.env — mayor precedencia
    resolve(here, '../../../.env'), // raíz del monorepo
  ];
  const loaded: string[] = [];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnvFile(readFileSync(file, 'utf8')))) {
      const current = process.env[key];
      if (current === undefined || current === '') process.env[key] = value;
    }
    loaded.push(file);
  }
  return loaded;
}

/** Archivos `.env` efectivamente leídos (útil para el log de arranque). */
export const loadedEnvFiles = loadDotEnv();

function readString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? fallback : value;
}

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(readString(name, String(fallback)), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readList(name: string): string[] {
  return readString(name, '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const nodeEnv = readString('NODE_ENV', 'development');
const appOrigin = normalizeOrigin(readString('APP_ORIGIN', 'http://localhost:5173')) ?? 'http://localhost:5173';

const allowedOrigins = new Set<string>([appOrigin]);
for (const origin of readList('ALLOWED_ORIGINS')) {
  const normalized = normalizeOrigin(origin);
  if (normalized) allowedOrigins.add(normalized);
}

export const env = {
  version: readVersion(),
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  logLevel: readString('LOG_LEVEL', nodeEnv === 'production' ? 'info' : 'debug'),
  host: readString('HOST', '0.0.0.0'),
  port: readInt('PORT', 8787),
  databaseUrl: readString('DATABASE_URL', ''),
  appOrigin,
  allowedOrigins,
  sessionSecret: readString('SESSION_SECRET', ''),
  sessionCookieName: 'tablero_session',
  sessionTtlDays: 30,
  maxUploadMb: readInt('MAX_UPLOAD_MB', 500),
  /** Límite del cuerpo JSON (los archivos grandes van por multipart). */
  jsonBodyLimitBytes: 8 * 1024 * 1024,
  s3: {
    endpoint: readString('S3_ENDPOINT', 'http://localhost:9000'),
    accessKey: readString('S3_ACCESS_KEY', 'tablero'),
    secretKey: readString('S3_SECRET_KEY', 'tablero123'),
    bucket: readString('S3_BUCKET', 'tablero'),
    region: readString('S3_REGION', 'us-east-1'),
  },
} as const;

/** Falla temprano si falta configuración imprescindible para arrancar. */
export function assertRuntimeEnv(): void {
  const problems: string[] = [];
  if (env.databaseUrl.length === 0) problems.push('Falta DATABASE_URL (copiá .env.example a .env)');
  if (env.isProduction && env.sessionSecret.length < 32) {
    problems.push('SESSION_SECRET debe tener al menos 32 caracteres en producción');
  }
  if (env.port === 5173) problems.push('PORT no puede ser 5173: ese puerto es de la web');
  if (problems.length > 0) {
    throw new Error(`Configuración inválida:\n- ${problems.join('\n- ')}`);
  }
}

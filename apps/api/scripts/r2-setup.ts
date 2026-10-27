/**
 * Configura el bucket de Cloudflare R2 para producción (idempotente).
 *
 *   docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
 *     run --rm api ./apps/api/node_modules/.bin/tsx apps/api/scripts/r2-setup.ts
 *
 * Hace tres cosas:
 *   1. Comprueba que el bucket existe (`HeadBucket`). R2 no admite
 *      `CreateBucket` por la API S3: el bucket se crea desde el panel.
 *   2. Aplica la política CORS. La web lee las URL firmadas de R2 desde otro
 *      origen (pdf.js con `withCredentials`, `fetch` de la forma de onda e
 *      imágenes con `crossOrigin='anonymous'` para la paleta de color), y sin
 *      cabeceras CORS el navegador bloquea las tres.
 *   3. Crea la regla de ciclo de vida que borra `backups/` pasados
 *      BACKUP_RETENTION_DAYS días (por defecto 14). Las demás reglas del bucket
 *      se conservan: sólo se sustituye la que lleva el ID de esta herramienta.
 *
 * Variables (las mismas que usa la API): S3_ENDPOINT, S3_ACCESS_KEY,
 * S3_SECRET_KEY, S3_BUCKET, S3_REGION (`auto`), APP_ORIGIN, y
 * BACKUP_RETENTION_DAYS. Un token de R2 de «Object Read & Write» puede no tener
 * permiso para cambiar la configuración del bucket: en ese caso, pase un token
 * de administración sólo para este comando con R2_ADMIN_ACCESS_KEY_ID y
 * R2_ADMIN_SECRET_ACCESS_KEY (`docker compose run -e ...`), o configure CORS y
 * el ciclo de vida desde el panel de Cloudflare.
 *
 * No importa `src/env.ts` a propósito: aquello exige DATABASE_URL y
 * SESSION_SECRET, que no hacen falta para esto.
 */

import {
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { CORSRule, LifecycleRule } from '@aws-sdk/client-s3';

/** ID de la regla de caducidad: así se reconoce (y se sustituye) al repetir. */
const BACKUPS_RULE_ID = 'tablero-backups-expiry';
const BACKUPS_PREFIX = 'backups/';

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (value.length === 0) {
    throw new Error(`Falta la variable ${name}.`);
  }
  return value;
}

/** Origen normalizado (`https://host`, sin ruta ni barra final). */
function normalizeOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`APP_ORIGIN no es una URL válida: ${raw}`);
  }
  return url.origin;
}

function readRetentionDays(): number {
  const raw = readEnv('BACKUP_RETENTION_DAYS');
  if (raw.length === 0) return 14;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`BACKUP_RETENTION_DAYS debe ser un entero >= 1 (recibido: ${raw}).`);
  }
  return days;
}

function errorName(error: unknown): string {
  const candidate = error as { name?: string; Code?: string } | null;
  return candidate?.name ?? candidate?.Code ?? '';
}

function httpStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
}

function describeError(error: unknown): string {
  const name = errorName(error);
  const message = error instanceof Error ? error.message : String(error);
  return name.length > 0 ? `${name}: ${message}` : message;
}

async function main(): Promise<void> {
  const endpoint = requireEnv('S3_ENDPOINT');
  const bucket = requireEnv('S3_BUCKET');
  const region = readEnv('S3_REGION') || 'auto';
  const appOrigin = normalizeOrigin(requireEnv('APP_ORIGIN'));
  const retentionDays = readRetentionDays();

  const adminKey = readEnv('R2_ADMIN_ACCESS_KEY_ID');
  const adminSecret = readEnv('R2_ADMIN_SECRET_ACCESS_KEY');
  const useAdmin = adminKey.length > 0 && adminSecret.length > 0;
  const accessKeyId = useAdmin ? adminKey : requireEnv('S3_ACCESS_KEY');
  const secretAccessKey = useAdmin ? adminSecret : requireEnv('S3_SECRET_KEY');

  // Misma configuración que `src/lib/storage.ts`: `WHEN_REQUIRED` evita los
  // checksums por defecto del SDK, que R2 rechaza con un error de firma.
  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: readEnv('S3_FORCE_PATH_STYLE') === 'true',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  console.log(`Bucket:  ${bucket}`);
  console.log(`Destino: ${endpoint}`);
  console.log(`Origen:  ${appOrigin}`);
  console.log(`Token:   ${useAdmin ? 'administración (R2_ADMIN_*)' : 'el de la API (S3_ACCESS_KEY)'}`);
  console.log('');

  // 1. El bucket existe.
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log('1. Bucket encontrado.');
  } catch (error) {
    if (httpStatus(error) === 404 || errorName(error) === 'NotFound') {
      throw new Error(
        `El bucket "${bucket}" no existe. Créelo en Cloudflare: R2 > Create bucket (el nombre debe coincidir con R2_BUCKET).`,
      );
    }
    throw new Error(`No se pudo comprobar el bucket (${describeError(error)}). ¿Endpoint y credenciales correctos?`);
  }

  // 2. CORS: sólo lectura (GET/HEAD) y sólo desde el origen de la aplicación.
  const corsRules: CORSRule[] = [
    {
      AllowedOrigins: [appOrigin],
      AllowedMethods: ['GET', 'HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type', 'Content-Range', 'Accept-Ranges'],
      MaxAgeSeconds: 3600,
    },
  ];
  try {
    await client.send(
      new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: corsRules } }),
    );
    console.log(`2. CORS aplicado: GET/HEAD desde ${appOrigin} (MaxAge 3600 s).`);
  } catch (error) {
    throw new Error(
      `No se pudo aplicar CORS (${describeError(error)}). Si es AccessDenied, el token no puede cambiar la ` +
        'configuración del bucket: use un token de administración (R2_ADMIN_*) o configure CORS en el panel ' +
        '(bucket > Settings > CORS Policy).',
    );
  }

  // 3. Caducidad de las copias de seguridad, conservando las demás reglas.
  let existing: LifecycleRule[] = [];
  try {
    const current = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
    existing = current.Rules ?? [];
  } catch (error) {
    if (errorName(error) !== 'NoSuchLifecycleConfiguration' && httpStatus(error) !== 404) {
      throw new Error(`No se pudo leer el ciclo de vida actual (${describeError(error)}).`);
    }
  }
  const backupsRule: LifecycleRule = {
    ID: BACKUPS_RULE_ID,
    Status: 'Enabled',
    Filter: { Prefix: BACKUPS_PREFIX },
    Expiration: { Days: retentionDays },
  };
  const kept = existing.filter((rule) => rule.ID !== BACKUPS_RULE_ID);
  try {
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: { Rules: [...kept, backupsRule] },
      }),
    );
    console.log(
      `3. Ciclo de vida aplicado: "${BACKUPS_PREFIX}" caduca a los ${retentionDays} días` +
        (kept.length > 0 ? ` (se conservaron ${kept.length} regla(s) ajenas).` : '.'),
    );
  } catch (error) {
    throw new Error(
      `No se pudo aplicar el ciclo de vida (${describeError(error)}). Alternativa: panel de Cloudflare > ` +
        `bucket > Settings > Object lifecycle rules > Add rule (prefijo ${BACKUPS_PREFIX}, borrar tras ${retentionDays} días).`,
    );
  }

  // Lectura de comprobación: lo que R2 guardó de verdad.
  try {
    const stored = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    const origins = (stored.CORSRules ?? []).flatMap((rule) => rule.AllowedOrigins ?? []);
    console.log(`   Comprobación CORS en R2: orígenes permitidos = ${origins.join(', ') || '(ninguno)'}`);
  } catch (error) {
    console.warn(`   No se pudo releer CORS (${describeError(error)}); no es grave.`);
  }

  console.log('');
  console.log('Listo. Falta comprobar a mano que el navegador acepta las peticiones con credenciales');
  console.log('(pdf.js usa withCredentials): ver "Comprobar CORS" en docs/deploy.md.');
}

main().catch((error: unknown) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

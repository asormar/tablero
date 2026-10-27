#!/usr/bin/env bash
# Copia de seguridad de la base de datos a Cloudflare R2.
#
#   docker/backup.sh
#
# Vuelca PostgreSQL con `pg_dump` dentro del contenedor, lo comprime y lo sube
# al mismo bucket de R2 que los archivos, bajo `backups/tablero-AAAA-MM-DD-HHMM.sql.gz`.
# Las credenciales salen de `docker/.env.prod`. La retención (BACKUP_RETENTION_DAYS)
# no la aplica este script: la aplica la regla de caducidad que crea
# `apps/api/scripts/r2-setup.ts` sobre el prefijo `backups/`.
#
# Lo instala en el cron `docker/provision.sh` (todos los días a las 03:30, hora
# de la VM). Sale con código distinto de cero y un mensaje si algo falla.
#
# La restauración está en `docker/restore.sh`.

set -eEuo pipefail

# shellcheck source=docker/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-tablero-postgres}"
tmp_file=""

cleanup() {
  [ -z "$tmp_file" ] || rm -f "$tmp_file"
}
on_error() {
  printf 'ERROR: la copia de seguridad falló (línea %s). No se subió nada completo a R2.\n' "$1" >&2
}
trap cleanup EXIT
trap 'on_error $LINENO' ERR

require_env_file
require_docker
load_r2_env

pg_user="$(env_get POSTGRES_USER)"; pg_user="${pg_user:-tablero}"
pg_db="$(env_get POSTGRES_DB)"; pg_db="${pg_db:-tablero}"

running="$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)"
[ "$running" = "true" ] || fail "el contenedor $POSTGRES_CONTAINER no está en marcha."

stamp="$(date +%Y-%m-%d-%H%M)"
key="backups/tablero-${stamp}.sql.gz"

# Primero a un archivo temporal: con una tubería directa a R2, un `pg_dump`
# que muriera a medias dejaría subido un volcado truncado y válido en apariencia.
# `--clean --if-exists` hace que restaurar sobre una base ya poblada funcione.
tmp_file="$(mktemp "${TMPDIR:-/tmp}/tablero-backup.XXXXXX")"
log "Volcando ${pg_db} de ${POSTGRES_CONTAINER}..."
docker exec "$POSTGRES_CONTAINER" \
  pg_dump -U "$pg_user" -d "$pg_db" --clean --if-exists --no-owner --no-privileges \
  | gzip -9 > "$tmp_file"

# `pipefail` ya atrapa un fallo de pg_dump; esto detecta un archivo corrupto o vacío.
gzip -t "$tmp_file" || fail "el volcado comprimido está corrupto."
size="$(wc -c < "$tmp_file" | tr -d ' ')"
[ "$size" -gt 200 ] || fail "el volcado es sospechosamente pequeño (${size} bytes)."

log "Subiendo a s3://${R2_BUCKET}/${key} (${size} bytes)..."
aws_cli -i s3 cp - "s3://${R2_BUCKET}/${key}" < "$tmp_file" >/dev/null

# Comprobación: el objeto existe y pesa lo mismo que el archivo local.
remote_size="$(aws_cli s3api head-object --bucket "$R2_BUCKET" --key "$key" \
  --query ContentLength --output text)"
[ "$remote_size" = "$size" ] \
  || fail "el tamaño en R2 (${remote_size}) no coincide con el local (${size})."

log "Copia de seguridad correcta: ${key}"

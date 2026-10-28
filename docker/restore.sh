#!/usr/bin/env bash
# Restaura una copia de seguridad de R2 en el PostgreSQL en marcha.
#
#   docker/restore.sh --list                     lista las copias disponibles
#   docker/restore.sh                            restaura la más reciente
#   docker/restore.sh tablero-2026-01-31-0330.sql.gz   restaura una concreta
#   docker/restore.sh --yes [nombre]             sin pedir confirmación
#
# SUSTITUYE el contenido actual de la base: pide confirmación escribiendo el
# nombre de la base. Detiene la API mientras restaura y la vuelve a arrancar al
# terminar (también si falla; la restauración va en una sola transacción, así
# que un fallo deja la base como estaba).

set -eEuo pipefail

# shellcheck source=docker/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-tablero-postgres}"
assume_yes=0
list_only=0
target=""
tmp_file=""
api_stopped=0

usage() { sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

for arg in "$@"; do
  case "$arg" in
    --list) list_only=1 ;;
    --yes|-y) assume_yes=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) fail "opción desconocida: $arg (usa --help)." ;;
    *) [ -z "$target" ] || fail "sólo se admite una copia."; target="$arg" ;;
  esac
done

cleanup() {
  [ -z "$tmp_file" ] || rm -f "$tmp_file"
  if [ "$api_stopped" = "1" ]; then
    log "Arrancando la API de nuevo..."
    compose start api >/dev/null || warn "no se pudo arrancar la API: ejecuta 'docker compose ... start api'."
  fi
}
trap cleanup EXIT
trap 'printf "ERROR: la restauración falló (línea %s).\n" "$LINENO" >&2' ERR

require_env_file
require_docker
load_r2_env

pg_user="$(env_get POSTGRES_USER)"; pg_user="${pg_user:-tablero}"
pg_db="$(env_get POSTGRES_DB)"; pg_db="${pg_db:-tablero}"

# Nombres de las copias, de la más antigua a la más reciente (el nombre lleva
# la fecha y la hora, así que el orden alfabético es el cronológico).
list_backups() {
  aws_cli s3 ls "s3://${R2_BUCKET}/backups/" \
    | awk '{print $4}' | grep -E '^tablero-.*\.sql\.gz$' | LC_ALL=C sort || true
}

backups="$(list_backups)"

if [ "$list_only" = "1" ]; then
  [ -n "$backups" ] || fail "no hay copias en s3://${R2_BUCKET}/backups/."
  printf '%s\n' "$backups"
  exit 0
fi

if [ -z "$target" ]; then
  [ -n "$backups" ] || fail "no hay copias en s3://${R2_BUCKET}/backups/."
  target="$(printf '%s\n' "$backups" | tail -n 1)"
else
  target="${target#backups/}"
  grep -qxF "$target" <<< "$backups" \
    || fail "no existe la copia '$target' (usa --list para ver las disponibles)."
fi

running="$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)"
[ "$running" = "true" ] || fail "el contenedor $POSTGRES_CONTAINER no está en marcha."

tmp_file="$(mktemp "${TMPDIR:-/tmp}/tablero-restore.XXXXXX")"
log "Descargando ${target}..."
aws_cli s3 cp "s3://${R2_BUCKET}/backups/${target}" - > "$tmp_file"
gzip -t "$tmp_file" || fail "la copia descargada está corrupta; no se toca la base."

log
log "Se va a restaurar: ${target}"
log "Destino:           base '${pg_db}' en ${POSTGRES_CONTAINER}"
log "Esto REEMPLAZA los datos actuales de esa base."
if [ "$assume_yes" != "1" ]; then
  [ -t 0 ] || fail "no hay terminal para confirmar; usa --yes si es intencionado."
  read -r -p "Escribe el nombre de la base ('${pg_db}') para continuar: " answer
  [ "$answer" = "$pg_db" ] || fail "confirmación incorrecta; no se ha cambiado nada."
fi

# Sin la API conectada no hay escrituras ni bloqueos durante la restauración.
log "Deteniendo la API..."
compose stop api >/dev/null
api_stopped=1

log "Restaurando..."
gunzip -c "$tmp_file" \
  | docker exec -i "$POSTGRES_CONTAINER" \
      psql -U "$pg_user" -d "$pg_db" -v ON_ERROR_STOP=1 --single-transaction --quiet >/dev/null

log "Restauración correcta desde ${target}."

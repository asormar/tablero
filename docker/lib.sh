#!/usr/bin/env bash
# Utilidades compartidas por los scripts de docker/ (se carga con `source`).
#
# Define las rutas del proyecto, el registro de mensajes y la lectura de
# `docker/.env.prod`. Ese archivo NO se carga con `source`: es el formato de
# `--env-file` de Docker Compose (admite valores como `Bot/0.1 (+https://...)`
# sin comillas), que bash interpretaría como sintaxis.

DOCKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DOCKER_DIR/.." && pwd)"
COMPOSE_FILE="$DOCKER_DIR/docker-compose.prod.yml"
ENV_FILE="${ENV_FILE:-$DOCKER_DIR/.env.prod}"

log() { printf '%s\n' "$*"; }
warn() { printf 'AVISO: %s\n' "$*" >&2; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Docker Compose con el archivo y la configuración de producción.
compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# Valor de una variable de `docker/.env.prod` (la última definición gana, sin
# comillas envolventes). Imprime vacío si no existe o está vacía.
env_get() {
  local key="$1" line value
  [ -f "$ENV_FILE" ] || return 0
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  value="${line#"${key}="}"
  # Quita las comillas simples o dobles que envuelvan el valor completo.
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

# Exige que exista docker/.env.prod.
require_env_file() {
  [ -f "$ENV_FILE" ] || fail "no existe $ENV_FILE. Ejecuta docker/provision.sh o copia docker/.env.prod.example."
}

# Exige que `docker` responda para el usuario actual.
require_docker() {
  command -v docker >/dev/null 2>&1 || fail "docker no está instalado (ejecuta docker/provision.sh)."
  docker info >/dev/null 2>&1 \
    || fail "docker no responde para el usuario actual. ¿Estás en el grupo docker? Cierra la sesión y vuelve a entrar."
}

# Variables de R2 listas para usar con la CLI de AWS en un contenedor.
# Exporta AWS_* (se pasan al contenedor con `-e NOMBRE`, sin valor en la línea
# de comandos para que no aparezcan en `ps`) y define R2_BUCKET y R2_ENDPOINT.
load_r2_env() {
  local account
  account="$(env_get R2_ACCOUNT_ID)"
  R2_BUCKET="$(env_get R2_BUCKET)"
  R2_BUCKET="${R2_BUCKET:-tablero}"
  AWS_ACCESS_KEY_ID="$(env_get R2_ACCESS_KEY_ID)"
  AWS_SECRET_ACCESS_KEY="$(env_get R2_SECRET_ACCESS_KEY)"
  [ -n "$account" ] && [ "$account" != "tu-account-id-de-cloudflare" ] \
    || fail "falta R2_ACCOUNT_ID en $ENV_FILE."
  [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] \
    || fail "faltan R2_ACCESS_KEY_ID o R2_SECRET_ACCESS_KEY en $ENV_FILE."
  R2_ENDPOINT="https://${account}.r2.cloudflarestorage.com"
  # R2 usa la región `auto`. Las versiones recientes de la CLI calculan
  # checksums que R2 rechaza: sólo se envían cuando la operación los exige.
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
  export AWS_DEFAULT_REGION=auto
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
  export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
}

# `aws` dentro de la imagen oficial (multi-arquitectura). Las credenciales
# entran por el entorno. Usar con `-i` si hay que pasar datos por la entrada
# estándar: `aws_cli -i s3 cp - s3://...`.
# Versión fijada: `latest` cambia sin aviso, y desde la 2.23 la CLI calcula
# sumas de verificación por defecto (las variables `*_CHECKSUM_*` de arriba lo
# desactivan para R2).
AWSCLI_IMAGE="${AWSCLI_IMAGE:-amazon/aws-cli:2.22.35}"
aws_cli() {
  local interactive=()
  if [ "${1:-}" = "-i" ]; then interactive=(-i); shift; fi
  docker run --rm ${interactive[@]+"${interactive[@]}"} \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
    -e AWS_REQUEST_CHECKSUM_CALCULATION -e AWS_RESPONSE_CHECKSUM_VALIDATION \
    "$AWSCLI_IMAGE" "$@" --endpoint-url "$R2_ENDPOINT"
}

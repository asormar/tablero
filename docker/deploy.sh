#!/usr/bin/env bash
# Despliega (o actualiza) Tablero en la VM.
#
#   docker/deploy.sh             git pull + build + up + comprobación de salud
#   docker/deploy.sh --no-pull   igual, sin tocar el repositorio
#
# Espera hasta 180 s a que responda https://$SITE_ADDRESS/api/health. Si el
# dominio todavía no resuelve (DNS recién creado) pero la API responde por
# dentro del contenedor, avisa y termina bien. Si la API no responde, muestra
# las últimas líneas del registro de la API y la web y sale con error.

set -eEuo pipefail

# shellcheck source=docker/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

WAIT_SECONDS=180
do_pull=1

for arg in "$@"; do
  case "$arg" in
    --no-pull) do_pull=0 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "opción desconocida: $arg (use --help)." ;;
  esac
done

require_env_file
require_docker

site="$(env_get SITE_ADDRESS)"
[ -n "$site" ] || fail "falta SITE_ADDRESS en $ENV_FILE."

cd "$REPO_DIR"

if [ "$do_pull" = "1" ]; then
  if [ -d "$REPO_DIR/.git" ]; then
    log "Actualizando el repositorio (git pull --ff-only)..."
    git pull --ff-only
  else
    warn "$REPO_DIR no es un repositorio git: se omite el pull."
  fi
fi

log "Construyendo y levantando los servicios..."
compose up -d --build

# La API responde por dentro del contenedor (la imagen de Node trae `fetch`).
api_local_ok() {
  docker exec tablero-api node -e \
    "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1
}
api_public_ok() {
  curl -fsS --max-time 5 "https://${site}/api/health" >/dev/null 2>&1
}

log "Esperando a https://${site}/api/health (hasta ${WAIT_SECONDS} s)..."
deadline=$(( $(date +%s) + WAIT_SECONDS ))
public_ok=0
local_ok=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if api_public_ok; then public_ok=1; break; fi
  if api_local_ok; then local_ok=1; fi
  sleep 3
done

log
compose ps

if [ "$public_ok" = "1" ]; then
  log
  log "Listo: https://${site} responde."
  exit 0
fi

if [ "$local_ok" = "1" ]; then
  log
  warn "la API responde por dentro, pero https://${site}/api/health no."
  warn "Revise el DNS (que ${site} apunte a la IP de la VM), el puerto 80/443 en la VCN y el certificado:"
  warn "  docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod logs --tail 80 web"
  exit 0
fi

log
echo "ERROR: la API no respondió en ${WAIT_SECONDS} s." >&2
for service in api web; do
  log
  log "--- últimas 80 líneas de ${service} ---"
  compose logs --no-color --tail 80 "$service" || true
done
exit 1

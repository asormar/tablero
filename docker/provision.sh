#!/usr/bin/env bash
# Prepara una VM nueva de Oracle Cloud (Ubuntu 24.04, Ampere A1) para Tablero.
#
#   bash provision.sh [URL_DEL_REPOSITORIO]
#
# Se ejecuta UNA vez como el usuario `ubuntu` (con sudo), pero es idempotente:
# repetirlo no duplica nada. Hace, en orden:
#   1. Instala Docker Engine y el plugin de Compose desde el repositorio apt
#      oficial de Docker y añade al usuario al grupo `docker`.
#   2. Activa las actualizaciones de seguridad automáticas (unattended-upgrades).
#   3. Abre 80/tcp, 443/tcp y 443/udp en iptables, ANTES de la regla REJECT que
#      traen las imágenes de Oracle, y lo persiste con netfilter-persistent.
#   4. Clona (o actualiza) el repositorio en ~/tablero.
#   5. Crea docker/.env.prod si falta, generando SESSION_SECRET y
#      POSTGRES_PASSWORD, y pregunta el dominio y los datos de R2.
#   6. Instala el cron de la copia de seguridad diaria (03:30, hora de la VM).
#
# Variables opcionales: TABLERO_DIR (destino del clon, por defecto ~/tablero).

set -euo pipefail

REPO_URL="${1:-https://github.com/asormar/tablero.git}"
TABLERO_DIR="${TABLERO_DIR:-$HOME/tablero}"
BACKUP_CRON_TAG="# tablero-backup"

log() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf 'AVISO: %s\n' "$*" >&2; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# --- Comprobaciones previas ---------------------------------------------------
[ "$(id -u)" -ne 0 ] || fail "no lo ejecute como root: use el usuario ubuntu (el script usa sudo donde hace falta)."
command -v sudo >/dev/null 2>&1 || fail "sudo no está disponible."
sudo -v || fail "este usuario no tiene permisos de sudo."

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || warn "pensado para Ubuntu; esta VM es '${ID:-desconocida}'. Puede fallar."
else
  warn "no se pudo leer /etc/os-release."
fi
[ "$(uname -m)" = "aarch64" ] || warn "la arquitectura es $(uname -m), no aarch64 (Ampere A1). Sigue funcionando, pero revise el shape."

# `sudo` limpia el entorno (`env_reset`): un `export DEBIAN_FRONTEND` no le
# llega a apt y `iptables-persistent` o `needrestart` se quedarían preguntando.
apt_get() {
  sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get "$@"
}

# --- 1. Docker ------------------------------------------------------------------
log "Docker Engine y Compose"
apt_get update -y
apt_get install -y ca-certificates curl gnupg git cron openssl

if command -v docker >/dev/null 2>&1 && sudo docker compose version >/dev/null 2>&1; then
  note "Docker y el plugin de Compose ya están instalados."
else
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  arch="$(dpkg --print-architecture)"
  codename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
  echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  apt_get update -y
  apt_get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo systemctl enable --now docker

if id -nG "$USER" | tr ' ' '\n' | grep -qx docker; then
  note "$USER ya está en el grupo docker."
else
  sudo usermod -aG docker "$USER"
  note "$USER añadido al grupo docker (hay que cerrar la sesión y volver a entrar para que tenga efecto)."
  NEED_RELOGIN=1
fi

# --- 2. Actualizaciones automáticas -------------------------------------------
log "Actualizaciones de seguridad automáticas"
apt_get install -y unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
note "Activadas. No reinician la VM solas: de vez en cuando aplique los reinicios pendientes (/var/run/reboot-required)."

# --- 3. iptables -----------------------------------------------------------------
# Las imágenes de Oracle traen /etc/iptables/rules.v4 con un
# `-A INPUT -j REJECT --reject-with icmp-host-prohibited` al final: bloquea
# todo lo que no esté permitido antes, aunque la lista de seguridad de la VCN
# lo deje pasar. Las reglas nuevas tienen que ir ANTES de ese REJECT.
log "Cortafuegos de la VM (iptables)"
# Al instalarse, iptables-persistent ofrece guardar las reglas en uso, que a esta
# altura ya incluyen las cadenas de Docker: se responde que no de antemano.
echo 'iptables-persistent iptables-persistent/autosave_v4 boolean false' | sudo debconf-set-selections
echo 'iptables-persistent iptables-persistent/autosave_v6 boolean false' | sudo debconf-set-selections
apt_get install -y iptables-persistent netfilter-persistent

RULES_FILE=/etc/iptables/rules.v4

# Deja la regla en /etc/iptables/rules.v4, antes del REJECT, sin volcar con
# `netfilter-persistent save` las cadenas que Docker crea en caliente: guardarlas
# ahí las restauraría en cada arranque, antes de que Docker vuelva a levantarse.
persist_rule() {
  local rule="$1"
  # Sin archivo o sin REJECT, nada bloquea el puerto al arrancar: no hay regla
  # que adelantar. Nunca se usa `netfilter-persistent save`, que volcaría las
  # cadenas de Docker.
  if [ ! -f "$RULES_FILE" ] || ! sudo grep -q '^-A INPUT .*-j REJECT' "$RULES_FILE"; then
    return
  fi
  if sudo grep -qxF -- "$rule" "$RULES_FILE"; then
    return
  fi
  sudo awk -v rule="$rule" '!done && /^-A INPUT .*-j REJECT/ { print rule; done = 1 } { print }' \
    "$RULES_FILE" | sudo tee "$RULES_FILE.new" >/dev/null
  sudo mv "$RULES_FILE.new" "$RULES_FILE"
}

open_port() {
  local proto="$1" port="$2" pos
  if sudo iptables -C INPUT -p "$proto" --dport "$port" -j ACCEPT 2>/dev/null; then
    note "${port}/${proto}: ya estaba abierto."
  else
    pos="$(sudo iptables -L INPUT -n --line-numbers | awk '$2 == "REJECT" { print $1; exit }')"
    if [ -n "$pos" ]; then
      sudo iptables -I INPUT "$pos" -p "$proto" --dport "$port" -j ACCEPT
    else
      sudo iptables -A INPUT -p "$proto" --dport "$port" -j ACCEPT
    fi
    note "${port}/${proto}: abierto."
  fi
  persist_rule "-A INPUT -p ${proto} -m ${proto} --dport ${port} -j ACCEPT"
}
open_port tcp 80
open_port tcp 443
open_port udp 443
note "Reglas persistidas en $RULES_FILE."

# --- 4. Repositorio ----------------------------------------------------------------
log "Repositorio en $TABLERO_DIR"
if [ -d "$TABLERO_DIR/.git" ]; then
  if git -C "$TABLERO_DIR" diff --quiet && git -C "$TABLERO_DIR" diff --cached --quiet; then
    git -C "$TABLERO_DIR" pull --ff-only
  else
    warn "hay cambios locales en $TABLERO_DIR: no se hace pull."
  fi
elif [ -e "$TABLERO_DIR" ] && [ -n "$(ls -A "$TABLERO_DIR" 2>/dev/null)" ]; then
  fail "$TABLERO_DIR existe y no es un repositorio git. Muévalo o use TABLERO_DIR=otra/ruta."
else
  git clone "$REPO_URL" "$TABLERO_DIR"
fi

DOCKER_DIR="$TABLERO_DIR/docker"
ENV_FILE="$DOCKER_DIR/.env.prod"
[ -f "$DOCKER_DIR/.env.prod.example" ] || fail "falta $DOCKER_DIR/.env.prod.example: ¿es el repositorio correcto?"

# --- 5. docker/.env.prod -------------------------------------------------------
log "Configuración ($ENV_FILE)"

env_get() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)"
  printf '%s' "${line#"$1="}"
}

# Reescribe `CLAVE=valor` (o la añade). El valor viaja por el entorno de awk, no
# por su línea de comandos, y nunca se muestra.
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  KEY="$key" VAL="$value" awk '
    BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VAL"]; done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

# ¿El valor es vacío o el de ejemplo del archivo de plantilla?
is_placeholder() {
  local value
  value="$(env_get "$1")"
  case "$value" in
    ""|cambiame*|tu-account-id-de-cloudflare|mi-tablero.duckdns.org) return 0 ;;
    *) return 1 ;;
  esac
}

if [ ! -f "$ENV_FILE" ]; then
  ( umask 077; cp "$DOCKER_DIR/.env.prod.example" "$ENV_FILE" )
  note "Creado a partir de .env.prod.example."
fi
chmod 600 "$ENV_FILE"

if is_placeholder SESSION_SECRET; then
  env_set SESSION_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
  note "SESSION_SECRET generado."
fi
if is_placeholder POSTGRES_PASSWORD; then
  env_set POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  note "POSTGRES_PASSWORD generado."
fi

# Pregunta por un valor sólo si sigue siendo el de ejemplo y hay terminal.
# `secret=1` no muestra lo que se escribe. Intro deja el valor como está.
ask() {
  local key="$1" label="$2" secret="${3:-0}" answer=""
  is_placeholder "$key" || return 0
  [ -t 0 ] || return 0
  if [ "$secret" = "1" ]; then
    read -r -s -p "$label (Intro para dejarlo y editarlo luego): " answer || answer=""
    echo
  else
    read -r -p "$label (Intro para dejarlo y editarlo luego): " answer || answer=""
  fi
  [ -z "$answer" ] || env_set "$key" "$answer"
}

ask SITE_ADDRESS "Dominio de Tablero (p. ej. mi-tablero.duckdns.org)"
ask ACME_EMAIL "Correo para avisos de Let's Encrypt (opcional)"
ask R2_ACCOUNT_ID "R2: Account ID de Cloudflare"
ask R2_ACCESS_KEY_ID "R2: Access Key ID"
ask R2_SECRET_ACCESS_KEY "R2: Secret Access Key" 1

missing=()
for key in SITE_ADDRESS R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  if is_placeholder "$key"; then missing+=("$key"); fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  warn "faltan valores en $ENV_FILE: ${missing[*]}"
  note "Edítelo antes de desplegar:  nano $ENV_FILE"
fi

# --- 6. Cron de la copia de seguridad ---------------------------------------------
log "Copia de seguridad diaria (cron)"
chmod +x "$DOCKER_DIR"/*.sh
backup_line="30 3 * * * $DOCKER_DIR/backup.sh >> \$HOME/tablero-backup.log 2>&1 $BACKUP_CRON_TAG"
{ crontab -l 2>/dev/null | grep -vF "$BACKUP_CRON_TAG" || true; echo "$backup_line"; } | crontab -
sudo systemctl enable --now cron >/dev/null 2>&1 || true
note "Todos los días a las 03:30 (hora de la VM, UTC por defecto). Registro: ~/tablero-backup.log"
note "Los respaldos antiguos caducan solos si aplica la regla de R2 (apps/api/scripts/r2-setup.ts)."

# --- Final -------------------------------------------------------------------------
cat <<EOF

==> Aprovisionamiento terminado.

Falta lo que NO se puede hacer desde la VM: en la consola de Oracle Cloud, en la
lista de seguridad de la VCN (Networking > Virtual Cloud Networks > su VCN >
Security > Security Lists > Default), añada estas reglas de ENTRADA con origen
0.0.0.0/0:
    - TCP  puerto 80
    - TCP  puerto 443
    - UDP  puerto 443   (HTTP/3)
Sin ellas el navegador no llega a la VM, aunque iptables ya esté abierto.

Siguientes pasos:
EOF
if [ "${NEED_RELOGIN:-0}" = "1" ]; then
  echo "  0. Cierre la sesión SSH y vuelva a entrar (para activar el grupo docker)."
fi
cat <<EOF
  1. Revise la configuración:    nano $ENV_FILE
  2. Cree el bucket de R2 y ejecute r2-setup (ver docs/deploy.md).
  3. Despliegue:                 $DOCKER_DIR/deploy.sh --no-pull
EOF

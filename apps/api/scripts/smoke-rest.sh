#!/usr/bin/env bash
# Ciclo CRUD completo contra la API real (evidencia reproducible).
#
#   bash apps/api/scripts/smoke-rest.sh
#
# Requisitos: API levantada (pnpm --filter @tablero/api start) y Postgres
# corriendo. Usa curl; extrae ids con python. Probado en git-bash/MSYS.
#
# Cada paso imprime el código HTTP y el cuerpo literal de la respuesta.

set -u

API="${API_URL:-http://localhost:8787}"
ORIGIN="${APP_ORIGIN:-http://localhost:5173}"
STAMP="$(date +%s)"
EMAIL="crud-${STAMP}@tablero.test"
PASSWORD="ciclo-crud-2026"
WORKDIR="$(mktemp -d)"
# curl.exe es un binario nativo: necesita una ruta Windows, no MSYS (/tmp/...).
if command -v cygpath >/dev/null 2>&1; then
  WORKDIR="$(cygpath -w "${WORKDIR}")"
fi
JAR="${WORKDIR}/cookies.txt"
STEP=0

req() { # req METHOD PATH [JSON_BODY] — ANON=1 para no mandar cookies
  local method="$1" path="$2" body="${3:-}"
  local jars=(-b "${JAR}" -c "${JAR}")
  if [ "${ANON:-0}" = "1" ]; then jars=(); fi
  if [ -n "${body}" ]; then
    curl -s -w $'\n%{http_code}' -X "${method}" "${API}${path}" \
      -H 'content-type: application/json' -H "origin: ${ORIGIN}" \
      "${jars[@]}" -d "${body}"
  else
    curl -s -w $'\n%{http_code}' -X "${method}" "${API}${path}" \
      -H "origin: ${ORIGIN}" "${jars[@]}"
  fi
}

json_field() { # json_field '<json>' 'a.b.c...'  → imprime el valor ('' si falta)
  python -c "
import json, sys
data = json.loads(sys.argv[1])
for part in sys.argv[2].split('.'):
    if isinstance(data, list):
        data = data[int(part)] if int(part) < len(data) else None
    else:
        data = data.get(part)
    if data is None:
        break
print('' if data is None else data)
" "$1" "$2"
}

step() { # step LABEL METHOD PATH [BODY]
  STEP=$((STEP + 1))
  local label="$1" method="$2" path="$3" body="${4:-}"
  local raw status payload
  raw="$(req "${method}" "${path}" "${body}")"
  status="$(printf '%s' "${raw}" | tail -n 1)"
  payload="$(printf '%s' "${raw}" | sed '$d')"
  printf '\n── %d. %s\n   %s %s → %s\n' "${STEP}" "${label}" "${method}" "${path}" "${status}"
  printf '   %s\n' "${payload}"
  LAST_STATUS="${status}"
  LAST_BODY="${payload}"
}

echo "API: ${API} · usuario: ${EMAIL}"

step 'health (público, sin sesión)' GET '/api/health'

step 'register (crea cuenta + tablero raíz)' POST '/api/auth/register' \
  "{\"email\":\"${EMAIL}\",\"name\":\"Ciclo CRUD\",\"password\":\"${PASSWORD}\"}"
USER_ID="$(json_field "${LAST_BODY}" 'user.id')"
echo "   usuario: ${USER_ID}"

step 'me (usuario + tableros, acá aparece el raíz Inicio)' GET '/api/auth/me'
ROOT_ID="$(json_field "${LAST_BODY}" 'boards.0.id')"
ROOT_TITLE="$(json_field "${LAST_BODY}" 'boards.0.title')"
echo "   tablero raíz: ${ROOT_ID} (${ROOT_TITLE})"

step 'crear tablero hijo' POST '/api/boards' \
  "{\"title\":\"Proyecto Atlas\",\"parentBoardId\":\"${ROOT_ID}\",\"icon\":\"🚀\",\"color\":\"blue\"}"
BOARD_ID="$(json_field "${LAST_BODY}" 'board.id')"
echo "   tablero hijo: ${BOARD_ID}"

step 'crear segundo tablero (para probar mover)' POST '/api/boards' \
  "{\"title\":\"Borradores\"}"
SECOND_ID="$(json_field "${LAST_BODY}" 'board.id')"

step 'listar tableros (?filter=recent)' GET '/api/boards?filter=recent'

step 'hijos del raíz' GET "/api/boards/${ROOT_ID}/children"

step 'breadcrumbs del tablero hijo' GET "/api/boards/${BOARD_ID}/breadcrumbs"

step 'documento del tablero (respaldo REST, base64)' GET "/api/boards/${BOARD_ID}/document"

step 'renombrar (PATCH)' PATCH "/api/boards/${BOARD_ID}" \
  "{\"title\":\"Atlas renombrado\",\"icon\":\"🎯\"}"

step 'mover: el hijo pasa a colgar del segundo tablero' POST "/api/boards/${BOARD_ID}/move" \
  "{\"parentBoardId\":\"${SECOND_ID}\",\"index\":0}"

step 'breadcrumbs tras mover' GET "/api/boards/${BOARD_ID}/breadcrumbs"

step 'duplicar sin hijos (título + sufijo copia)' POST "/api/boards/${BOARD_ID}/duplicate" \
  '{"includeChildren":false}'
COPY_ID="$(json_field "${LAST_BODY}" 'board.id')"
echo "   copia: ${COPY_ID}"

step 'duplicar con hijos (subárbol)' POST "/api/boards/${SECOND_ID}/duplicate" \
  '{"includeChildren":true}'

step 'mover dentro de un descendiente (debe dar 409)' POST "/api/boards/${SECOND_ID}/move" \
  "{\"parentBoardId\":\"${BOARD_ID}\",\"index\":0}"

step 'borrar la copia (borrado lógico)' DELETE "/api/boards/${COPY_ID}"

step 'papelera (?filter=trash)' GET '/api/boards?filter=trash'

step 'me con ?trashed=1 (incluye papelera)' GET '/api/auth/me?trashed=1'

step 'borrar el tablero raíz (debe dar 409)' DELETE "/api/boards/${ROOT_ID}"

step 'mover algo inexistente (debe dar 404)' POST '/api/boards/no-existe-123/move' '{"parentBoardId":null}'

step 'body inválido en register (debe dar 400)' POST '/api/auth/register' '{"email":"no-es-email","name":"","password":"corta"}'

step 'login con credenciales malas (debe dar 401)' POST '/api/auth/login' \
  "{\"email\":\"${EMAIL}\",\"password\":\"incorrecta-1234\"}"

ANON=1 step 'listar sin cookies (debe dar 401)' GET '/api/boards'

step 'crear con icono unicode escapado (UTF-8 de punta a punta)' POST '/api/boards' \
  '{"title":"Acentos \u00f1\u00e1\u00e9","icon":"\ud83d\ude80"}'
python -c "
import json, sys
icon = json.loads(sys.argv[1])['board']['icon']
print(f'   icono devuelto: {icon!r} (code points {[hex(ord(c)) for c in icon]})')
" "${LAST_BODY}"

step 'logout' POST '/api/auth/logout'

ANON=1 step 'me sin cookies tras logout (debe dar 401)' GET '/api/auth/me'

echo
echo "Listo. Cookies y temporales en ${WORKDIR}"

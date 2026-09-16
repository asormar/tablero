# @tablero/api

API REST + tiempo real del tablero: **Fastify 4** + **Prisma/PostgreSQL** + **Hocuspocus** (Yjs)
persistido en Postgres.

## Puesta en marcha

```bash
# 1. Infraestructura (Postgres 16 + MinIO, con el bucket ya creado)
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml ps          # esperar "healthy"

# 2. Variables de entorno (desde la raíz del monorepo)
cp .env.example .env
cp .env.example apps/api/.env

# 3. Dependencias y base
pnpm install
pnpm --filter @tablero/api prisma:generate
pnpm --filter @tablero/api exec prisma migrate dev --name init

# 4. Arrancar (API REST y WebSocket comparten el puerto 8787)
pnpm --filter @tablero/api dev      # tsx watch
pnpm --filter @tablero/api start    # tsx
```

> **Puerto de Postgres**: el contenedor publica `5433:5432` porque en este equipo el 5432 lo
> ocupa un PostgreSQL 17 nativo. Si no tenés un Postgres nativo, cambiá el mapeo a `5432:5432`
> y `DATABASE_URL` en consecuencia.

## Pruebas manuales

```bash
bash apps/api/scripts/smoke-rest.sh          # ciclo CRUD completo por HTTP
pnpm --filter @tablero/api smoke:collab      # tiempo real: escribe en el Y.Map y verifica
                                             # la persistencia y la reconexión
pnpm --filter @tablero/api smoke:assets      # fase 2: sube archivos reales (imagen, vídeo,
                                             # audio, PDF, TXT, SVG, GIF), comprueba metadatos,
                                             # miniaturas, dedupe, permisos y borrado
pnpm --filter @tablero/api seed              # cuenta demo@tablero.test
```

> `smoke:assets` genera un archivo 1,5 veces más grande que `MAX_UPLOAD_MB` para probar el
> 413. Para una corrida rápida: `MAX_UPLOAD_MB=2 pnpm --filter @tablero/api start` y después
> el smoke (el script lee el límite vigente de `GET /api/health`). Necesita `ffmpeg`/`ffprobe`
> en el PATH.

## Rutas

Todas bajo `/api`. Salvo `health`, `auth/register` y `auth/login`, requieren la cookie de sesión
`tablero_session`. En las peticiones mutantes (POST/PATCH/PUT/DELETE) hay que mandar `Origin`
(o `Referer`) coincidente con `APP_ORIGIN`, si no la respuesta es 403.

| Método | Ruta | Respuesta |
| --- | --- | --- |
| GET | `/api/health` | `{ status, version, maxUploadMb }` |
| POST | `/api/auth/register` | 201 `{ user }` (crea el tablero raíz `Inicio`) |
| POST | `/api/auth/login` | `{ user }` |
| POST | `/api/auth/logout` | `{ ok }` |
| GET | `/api/auth/me?trashed=1` | `{ user, boards: BoardSummary[] }` |
| GET | `/api/boards?filter=recent\|favorites\|shared\|trash&parentBoardId=` | `{ boards }` |
| POST | `/api/boards` | 201 `{ board }` |
| GET | `/api/boards/:id` | `{ board, breadcrumbs }` |
| PATCH | `/api/boards/:id` | `{ board }` |
| DELETE | `/api/boards/:id` | `{ ok, trashedAt, boardIds, updated }` |
| POST | `/api/boards/:id/move` | `{ board }` |
| POST | `/api/boards/:id/duplicate` | 201 `{ board, children }` |
| GET | `/api/boards/:id/breadcrumbs` | `{ breadcrumbs }` |
| GET | `/api/boards/:id/children` | `{ boards }` |
| GET | `/api/boards/:id/document` | `{ state: base64, updatedAt }` |
| GET | `/api/search?q=&type=&boardId=&limit=` | `{ query, results }` |
| GET | `/api/tasks?filter=all\|overdue\|today\|upcoming\|done&boardId=&limit=` | `{ filter, tasks }` |
| GET | `/api/link-preview?url=` | `{ preview }` (incluye `embedType`/`embedUrl` de `detectEmbed`) |
| POST | `/api/assets` (multipart, campo `file`; `boardId` y `dedupe` opcionales) | 201 `{ asset }` (200 si el dedupe reutiliza uno existente) |
| GET | `/api/assets?boardId=&type=` | `{ assets }` (del usuario, más nuevos primero) |
| GET | `/api/assets/:id` | `{ asset }` |
| GET | `/api/assets/:id/raw?download=1` | 302 a la URL firmada del original (15 min) |
| GET | `/api/assets/:id/thumb` | 302 a la miniatura firmada (o al original si no hay) |
| DELETE | `/api/assets/:id` | `{ ok: true }` |

Errores: `ApiError` (`{ error, code?, details? }`) con 400 validación, 401 sin sesión,
403 sin permiso / CSRF, 404 inexistente, 409 conflicto, 429 rate limit, 502 destino inalcanzable.

## Archivos (assets)

Los binarios viven en el almacenamiento compatible con S3 (MinIO en desarrollo). La API es la
única que habla con él y **nunca expone claves**: el cliente usa las rutas de `assetRoutes`
(`/api/assets/:id/raw` y `/thumb`), que responden 302 a una URL firmada de 15 minutos. El bucket
se asegura al arrancar de forma idempotente; un MinIO caído no tumba la API (se registra el aviso
y los assets fallan hasta que vuelva).

Decisiones tomadas donde el plan dejaba libertad:

- **Subida multipart** (`@fastify/multipart`) con progreso en la web. `POST /api/assets/presign`
  (subida directa firmada) queda fuera de esta fase: sin un paso de confirmación crearía filas de
  assets que nunca llegan a subirse. El esquema ya está en `packages/shared` por si se agrega
  después.
- **Dedupe** por sha256 + MIME + tamaño del mismo usuario: la subida nueva responde **201** y la
  reutilizada **200** con el mismo `asset`. El cuerpo es siempre `{ asset }` (sin campos extra:
  el código HTTP es la señal). `dedupe=false` en el formulario fuerza una copia nueva.
- **Claves**: `assets/<ownerId>/<assetId>.<ext>` y `thumbs/<ownerId>/<assetId>.webp`. El id se
  genera en la API (uuid) antes de subir, para poder construir la clave; las columnas nuevas
  (`sha256` y `boardId`) están en la migración `asset_sha256_and_board`. `boardId` no tiene FK
  (igual que `Board.coverImageId`): la API valida el acceso al asociarlo y responde 404 si no es
  del usuario. `AssetSummary` no incluye `boardId`: el filtro de `/api/assets` lo usa por dentro.
- **Miniaturas de imagen**: WEBP de 480 px de ancho como máximo, `withoutEnlargement` (una imagen
  de 320 px de ancho deja una miniatura de 320: nunca se agranda). Las imágenes convertibles
  respetan la orientación EXIF (`.rotate()`) y las medidas del resumen salen ya orientadas.
- **SVG y GIF**: se guardan tal cual y sin miniatura propia (`thumbnailKey` queda en `null`); el
  original hace de miniatura.
- **`thumbnailUrl`**: es `null` solo cuando el navegador no tiene nada que pintar. Para cualquier
  imagen apunta a `/api/assets/:id/thumb` (miniatura propia o, si no la hay, el original); para
  vídeo con miniatura, también; para PDF, ofimática, texto o vídeo sin `ffmpeg` queda en `null` y
  la web dibuja el marcador del tipo.
- **`GET /api/assets/:id/thumb` nunca da 404**: sin miniatura responde 302 al original.
- **Vídeo y audio**: `ffprobe` da la duración (y las medidas del vídeo) y `ffmpeg` extrae la
  miniatura del vídeo a los 2 s —o a la mitad, si el vídeo dura menos—. Para el audio se intenta
  la portada incrustada. Si `ffmpeg`/`ffprobe` no están en el PATH, se degrada en silencio.
- **PDF y ofimática**: sin proceso en el servidor. El visor y la miniatura del PDF los hace la
  web en el cliente (pdf.js): el servidor no convierte ni rasteriza ofimática.
- **Procesamiento *best effort***: un fallo de sharp/ffmpeg deja el archivo guardado, con
  `width`/`height`/`duration` en `null` y sin miniatura. La subida nunca falla por procesamiento.
- **Límite**: `MAX_UPLOAD_MB` (por defecto 500). Se corta por `Content-Length` cuando el cuerpo
  declarado es mucho mayor y, si el cliente miente, por el flujo en vivo; los dos casos responden
  413 `file_too_large`. El límite vigente se publica en `GET /api/health` para que la web (y el
  smoke) no lo dupliquen.
- **Borrado**: `DELETE` borra original y miniatura del almacenamiento y después la fila. Si un
  objeto no se puede borrar, se registra y la fila se borra igual: un objeto huérfano en el
  bucket no debe bloquear una acción del usuario.
- **Permisos**: solo el propietario lee o borra su archivo; un asset ajeno responde 404 (no 403:
  no se filtra ni su existencia).

## Tiempo real

- `ws://localhost:8787/collab` — el nombre del documento es el id del tablero.
- Autenticación: cookie `tablero_session` del handshake (el `token` del protocolo se acepta
  como respaldo para clientes no navegador; **nunca** por query string).
- Rol `viewer`/`commenter` ⇒ conexión de solo lectura; `editor`/propietario ⇒ lectura y escritura.
- Persistencia: `BoardDocument.yjsState`, debounce 2 s / máximo 10 s.

> El cliente de navegación debe pasar un `token` no vacío al provider (cualquier valor: el
> servidor usa la cookie). Si se omite, `@hocuspocus/provider` no envía el mensaje de
> autenticación y la conexión queda esperando.

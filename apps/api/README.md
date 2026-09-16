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
pnpm --filter @tablero/api seed              # cuenta demo@tablero.test
```

## Rutas

Todas bajo `/api`. Salvo `health`, `auth/register` y `auth/login`, requieren la cookie de sesión
`tablero_session`. En las peticiones mutantes (POST/PATCH/PUT/DELETE) hay que mandar `Origin`
(o `Referer`) coincidente con `APP_ORIGIN`, si no la respuesta es 403.

| Método | Ruta | Respuesta |
| --- | --- | --- |
| GET | `/api/health` | `{ status, version }` |
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
| GET | `/api/link-preview?url=` | `{ preview }` |

Errores: `ApiError` (`{ error, code?, details? }`) con 400 validación, 401 sin sesión,
403 sin permiso / CSRF, 404 inexistente, 409 conflicto, 429 rate limit, 502 destino inalcanzable.

## Tiempo real

- `ws://localhost:8787/collab` — el nombre del documento es el id del tablero.
- Autenticación: cookie `tablero_session` del handshake (el `token` del protocolo se acepta
  como respaldo para clientes no navegador; **nunca** por query string).
- Rol `viewer`/`commenter` ⇒ conexión de solo lectura; `editor`/propietario ⇒ lectura y escritura.
- Persistencia: `BoardDocument.yjsState`, debounce 2 s / máximo 10 s.

> El cliente de navegación debe pasar un `token` no vacío al provider (cualquier valor: el
> servidor usa la cookie). Si se omite, `@hocuspocus/provider` no envía el mensaje de
> autenticación y la conexión queda esperando.

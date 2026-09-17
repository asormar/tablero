# Pruebas de punta a punta (`apps/web/e2e`)

Batería de Playwright con Chromium que recorre los flujos principales de Tablero
contra una **instancia propia**: no usa el API del 8787 ni el Vite del 5173.

| Pieza | Puerto | Notas |
|---|---|---|
| API de prueba | `8950` | base `f6e2e`, migrada y sembrada al arrancar |
| web de prueba | `5190` | `vite build` (`dist-e2e`) + `vite preview`, no el dev server |

Las dos las arranca y las apaga Playwright (`webServer` en
`playwright.config.ts`), así que alcanza con un comando.

## Preparación (una vez)

```bash
docker compose -f docker/docker-compose.yml up -d          # Postgres + MinIO
docker exec tablero-postgres createdb -U tablero f6e2e     # base aparte
```

Las migraciones y las plantillas del sistema se aplican solas en cada corrida
(`prisma migrate deploy` + `seed:templates`, idempotentes).

## Correr

```bash
pnpm --filter @tablero/web e2e            # todo
pnpm --filter @tablero/web e2e auth.spec.ts
pnpm --filter @tablero/web e2e --headed   # con navegador visible
```

Salida cruda útil para el informe: el reporter `list` imprime una línea por
prueba; el reporter `html` deja `e2e/report/index.html`.

## Qué cubre

| Archivo | Flujo |
|---|---|
| `auth.spec.ts` | registro e ingreso por la interfaz (contraseña incorrecta incluida) |
| `templates.spec.ts` | crear un tablero desde una plantilla del sistema |
| `elements.spec.ts` | nota, tarea con fecha, columna y conector entre dos tarjetas |
| `upload.spec.ts` | subir una imagen real (generada en la prueba) y leerla de la API |
| `search.spec.ts` | `Ctrl+K` encuentra una nota de otro tablero, lo abre y la resalta |
| `publish.spec.ts` | publicar y abrir `/p/:slug` en un contexto sin cookies |
| `history.spec.ts` | restaurar una versión desde el panel de historial |
| `export.spec.ts` | exportar a Markdown y leer el archivo descargado |
| `zip.spec.ts` | exportar la copia de seguridad e importarla como tablero nuevo |
| `trash.spec.ts` | borrar una nota y restaurarla desde la papelera |

Todas las verificaciones son dobles: **DOM** (lo que ve el usuario) y **API** (el
documento Yjs persistido se decodifica en `helpers/api.ts`).

## Reglas de la batería

- **Una cuenta nueva por prueba**, registrada por API y con la cookie inyectada en
  el contexto del navegador (`fixtures.ts`). Los flujos de registro e ingreso por
  formulario viven en `auth.spec.ts`.
- **Limpieza**: al terminar cada prueba se borran sus tableros (a la papelera y
  después para siempre) y sus archivos. Al terminar la corrida, `global-teardown.ts`
  borra las cuentas `e2e-*` de la base de prueba (el API no expone «borrar cuenta»).
- **Sin esperas fijas**: todo es `expect`, `expect.poll`, `waitForEvent` o
  `waitForPersisted` (que reintenta contra el documento persistido).

## Variables de entorno (opcionales)

| Variable | Por defecto |
|---|---|
| `E2E_API_PORT` / `E2E_WEB_PORT` | `8950` / `5190` |
| `E2E_DATABASE_URL` | `postgresql://tablero:tablero@localhost:5433/f6e2e` |
| `E2E_POSTGRES_CONTAINER` | `tablero-postgres` |
| `E2E_WORKERS` / `E2E_RETRIES` | `1` / `0` |
| `E2E_API_LOG_LEVEL` | `warn` |

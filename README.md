# Tablero

Espacio visual infinito de **tableros anidados**: notas, encabezados, tarjetas de
tablero, columnas, tareas, imágenes, enlaces, archivos, dibujos, tablas y mapas
sobre un lienzo libre. Clon funcional de Milanote para uso personal y
autoalojado, con identidad visual propia.

El documento maestro que define **qué** debe tener la aplicación, **cómo** debe
comportarse y **en qué orden** construirla es el plan de producto y técnico
(secciones 1–14). Este repositorio es su ejecución.

## Estado por fases

| Fase | Alcance | Estado |
| --- | --- | --- |
| 1 | Base y lienzo: monorepo, Docker, autenticación, CRUD de tableros anidados, lienzo infinito con selección/arrastre/guías/virtualización, nota + encabezado + tarjeta de tablero, persistencia Yjs con Hocuspocus, deshacer/rehacer | **Completa y verificada** (ver *Verificación*) |
| 2 | Contenido multimedia: subida de archivos, imagen, archivo, vídeo, audio, enlace, muestra de color, pegado inteligente | Pendiente |
| 3 | Estructura y organización: columnas, tareas con fechas, conectores con etiquetas, tablas, documento largo, dibujo, mapa, «Sin ordenar», papelera, favoritos | Pendiente |
| 4 | Productividad: búsqueda global, paleta de comandos, plantillas, exportación/importación, historial, ajustes y tema oscuro, PWA y móvil | Pendiente |
| 5 | Colaboración: compartir con roles, publicar, cursores en tiempo real, comentarios, notificaciones, actividad | Pendiente |
| 6 | Extras: extensión de navegador, captura con token, pulido de rendimiento y accesibilidad, pruebas end-to-end | Pendiente |

## Requisitos

- **Node 22** y **pnpm 9** (`npm install -g pnpm@9`)
- **Docker** con Compose (PostgreSQL 16 y MinIO)

## Puesta en marcha

```bash
# 1. Infraestructura
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml ps      # esperar "healthy"

# 2. Variables de entorno
cp .env.example .env
cp .env.example apps/api/.env

# 3. Dependencias y base de datos
pnpm install
pnpm --filter @tablero/api prisma:generate
pnpm --filter @tablero/api exec prisma migrate dev --name init

# 4. Arrancar (dos terminales)
pnpm --filter @tablero/api dev      # API REST + WebSocket en :8787
pnpm --filter @tablero/web dev      # interfaz en :5173
```

Abrí <http://localhost:5173>: si la API responde y no hay sesión, aparece la
pantalla de **acceso** (entrar o crear cuenta; el registro crea el tablero raíz
«Inicio»). El panel nunca bloquea: «seguir sin cuenta» deja trabajar en local en
ese navegador, y lo que se haya creado así se adopta en el servidor al entrar.
Después, empezá a arrastrar tarjetas desde la barra lateral.

### Puertos

| Servicio | Puerto | Nota |
| --- | --- | --- |
| API REST + WebSocket `/collab` | 8787 | comparten servidor HTTP |
| Interfaz (desarrollo) | 5173 | proxya `/api` y `/collab` a 8787 |
| Vista previa del build | 4173 | `pnpm --filter @tablero/web preview` |
| PostgreSQL | **5433** | el 5432 lo ocupa un PostgreSQL nativo de este equipo; el `.env` ya apunta a 5433 |
| MinIO | 9000 (S3) / 9001 (consola) | bucket creado por el contenedor de inicialización |

## Estructura

```
apps/web           React 18 + Vite + Zustand + Yjs + TipTap
apps/api           Fastify + Prisma + PostgreSQL + Hocuspocus
packages/shared    tipos, esquemas Zod y lógica de dominio (con tests)
docker             compose de Postgres y MinIO
ARCHITECTURE.md    decisiones técnicas y sus motivos
```

## Pruebas

```bash
pnpm test                            # tests de todos los paquetes (vitest)
pnpm typecheck                       # TypeScript estricto en los tres paquetes
pnpm --filter @tablero/web build     # build de producción

bash apps/api/scripts/smoke-rest.sh              # ciclo CRUD completo por HTTP
pnpm --filter @tablero/api smoke:collab          # tiempo real: escribe, desconecta, verifica persistencia
pnpm --filter @tablero/api seed                  # cuenta demo@tablero.test
```

La lógica de dominio (modelo de datos, operaciones del lienzo, guías de
alineación, viewport, deshacer/rehacer, jerarquía de tableros, colores) vive en
`packages/shared` y está cubierta por tests: **99 tests**, sin dependencias del
navegador.

## Verificación de la fase 1

Comprobado con ejecución real, no con inspección de código:

- `pnpm test`: 99 tests en `shared` + 69 en `web`, todos en verde.
- `pnpm typecheck` limpio en `shared`, `api` y `web`; build de producción OK
  (el editor se carga en un chunk aparte de 328 kB solo cuando se edita).
- API: 26/26 comprobaciones de un ciclo CRUD independiente (registro, tablero
  raíz, anidación, migas de pan, mover, duplicar con subárbol, papelera,
  validación Zod, bloqueo CSRF, sesión) y `smoke:collab` 11/11 (escritura por
  WebSocket → bytes en `BoardDocument.yjsState` → reconexión con el contenido).
- Interfaz, en un navegador real: nota creada con doble clic y escrita de
  verdad; **se borró todo el `localStorage` y al recargar la nota seguía ahí**
  (viene de Postgres por el WebSocket, no de la caché del navegador); la
  búsqueda del servidor encuentra el texto escrito.
- Anidación desde la interfaz: `B` crea la tarjeta de tablero, doble clic entra
  al tablero hijo (con migas de pan `Inicio › Tablero sin título`), la nota
  escrita dentro sobrevive a la recarga y el árbol queda registrado en Postgres.
- Acceso: sin cookies aparece la pantalla de acceso; el formulario envía de
  verdad (`POST /api/auth/login → 401` en el log de la API con credenciales
  inexistentes), valida en el cliente y «seguir sin cuenta» lleva al lienzo en
  modo local. Con sesión válida el panel desaparece y el catálogo del servidor
  se carga, fusionando el «Inicio» local en la raíz del servidor (una sola miga,
  sin tableros duplicados).
- Rendimiento: **302 tarjetas montadas, arrastre sostenido a 60 fps** (peor
  fotograma 17 ms) y 0 re-renders de React por fotograma durante el arrastre.
- Deshacer: un arrastre es un paso (vuelve exacto a su posición), `Supr` borra y
  `Ctrl+Z` recupera la tarjeta con su texto.

Lo que **no** está verificado todavía: los elementos de las fases 2–6, la
extensión de navegador, el modo presentación y las pruebas end-to-end con
Playwright.

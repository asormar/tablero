# Tablero

**Un espacio visual infinito de tableros anidados: el Milanote que corre en tu
propia máquina.** Notas, kanban, tablas, mapas, dibujos, imágenes y archivos
sobre un lienzo libre — con colaboración en tiempo real, plantillas, búsqueda
global y una extensión de navegador para capturar lo que estás leyendo.

Clon funcional de Milanote para uso personal y autoalojado, con identidad
visual propia. Interfaz en español (con inglés disponible), pensado para
correr en local con Docker.

## Características

**Lienzo**
- Lienzo infinito con zoom, selección por lazo, arrastre con guías magnéticas
  de alineación y rejilla de 8 px — 60 fps sostenidos con 300+ tarjetas.
- Tableros anidados con migas de pan; mover y duplicar con todo el subárbol.
- Deshacer/rehacer por gesto: un arrastre es un paso, el texto se deshace
  dentro de su editor.

**Contenido**
- Notas con texto enriquecido (TipTap), encabezados, tarjetas de tablero,
  columnas kanban, tareas con fechas y subtareas, tablas, documento largo,
  dibujo a mano alzada y mapa con búsqueda de lugares.
- Imágenes, vídeo, audio, PDF, enlaces con vista previa y archivos: subida
  con cola, miniaturas, deduplicación y visores propios.
- Pegado inteligente: `Ctrl/Cmd+V` con texto, imágenes o un enlace de YouTube
  crea el tipo de tarjeta que corresponde.

**Organización y productividad**
- Búsqueda global (full-text en español) y paleta de comandos `Ctrl/Cmd+K`.
- 12 plantillas del sistema, papelera con 30 días de retención, favoritos,
  bandeja «Sin ordenar» y vista global de tareas.
- Historial de versiones con restauración reversible.
- Exportación a PNG, PDF, Markdown, texto, JSON e ZIP; importación desde
  Markdown y CSV.
- Tema claro/oscuro, ajustes por cuenta, PWA instalable con shell sin
  conexión y vista optimizada para móvil.

**Colaboración**
- Compartir tableros con roles (dueño, editor, comentarista, lector)
  heredados por jerarquía, y publicar un tablero con enlace público
  (`/p/:slug`, contraseña opcional).
- Cursores y selección en tiempo real, presencia, comentarios con menciones,
  notificaciones y registro de actividad.

**Extras**
- Extensión de navegador (Manifest V3) que manda la página actual —título, URL
  y selección— a «Sin ordenar» con tu token personal.
- Captura rápida por API (`POST /api/capture`) para atajos y scripts.
- Accesibilidad: flujo completo con teclado, foco visible, trampa de foco en
  diálogos y contraste AA en ambos temas (0 violaciones en la auditoría con
  navegador real).

## Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | React 18 · Vite · TypeScript · Zustand · Yjs + TipTap · Leaflet |
| Backend | Fastify · Prisma · PostgreSQL 16 · Hocuspocus (colaboración Yjs) |
| Almacenamiento | MinIO (S3 compatible) · sharp · ffmpeg |
| Monorepo | pnpm workspaces — `apps/web`, `apps/api`, `packages/shared` |
| Calidad | Vitest · Playwright (e2e) · smokes HTTP/WebSocket · auditoría de accesibilidad con navegador real |

Las decisiones técnicas y sus motivos están en [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Puesta en marcha

Requisitos: **Node 22**, **pnpm 9** (`npm install -g pnpm@9`) y **Docker** con
Compose (PostgreSQL 16 y MinIO).

```bash
# 1. Infraestructura
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml ps      # esperar "healthy"

# 2. Variables de entorno
cp .env.example .env
cp .env.example apps/api/.env

# 3. Dependencias y base de datos
pnpm install
# `pnpm install` genera el cliente de Prisma solo (script `postinstall` de la
# raíz); si el esquema cambia, volvé a generarlo con `pnpm db:generate`.
pnpm --filter @tablero/api exec prisma migrate dev --name init

# 4. Arrancar (dos terminales)
pnpm --filter @tablero/api dev      # API REST + WebSocket en :8787
pnpm --filter @tablero/web dev      # interfaz en :5173
```

Abrí <http://localhost:5173>: si no hay sesión aparece la pantalla de
**acceso** (entrar o crear cuenta; el registro crea el tablero raíz «Inicio»).
El panel nunca bloquea: «seguir sin cuenta» deja trabajar en local en ese
navegador, y lo que se haya creado así se adopta en el servidor al entrar.
Después, empezá a arrastrar tarjetas desde la barra lateral.

### Puertos

| Servicio | Puerto | Nota |
| --- | --- | --- |
| API REST + WebSocket `/collab` | 8787 | comparten servidor HTTP |
| Interfaz (desarrollo) | 5173 | proxya `/api` y `/collab` a 8787 |
| Vista previa del build | 4173 | `pnpm --filter @tablero/web preview` |
| PostgreSQL | **5433** | el compose publica 5433 (ver comentario en `docker/docker-compose.yml`); el `.env` ya apunta a 5433 |
| MinIO | 9000 (S3) / 9001 (consola) | bucket creado por el contenedor de inicialización |

## Estructura

```
apps/web           React 18 + Vite + Zustand + Yjs + TipTap (lienzo, PWA)
apps/api           Fastify + Prisma + PostgreSQL + Hocuspocus (REST + WebSocket)
apps/extension     extensión de navegador Manifest V3 (captura a «Sin ordenar»)
packages/shared    tipos, esquemas Zod y lógica de dominio (con tests)
docker             compose de Postgres y MinIO
docs               verificación por fase y revisiones independientes
ARCHITECTURE.md    decisiones técnicas y sus motivos
```

## Pruebas

```bash
pnpm test                            # vitest en todos los paquetes
pnpm typecheck                       # TypeScript estricto en los cuatro paquetes
pnpm --filter @tablero/web build     # build de producción

bash apps/api/scripts/smoke-rest.sh              # ciclo CRUD completo por HTTP
pnpm --filter @tablero/api smoke:collab          # tiempo real: escribe, desconecta, verifica persistencia
pnpm --filter @tablero/api smoke:assets          # archivos: subida, miniaturas, dedupe, límites, permisos
pnpm --filter @tablero/api smoke:productividad   # búsqueda, plantillas, exportación
pnpm --filter @tablero/api smoke:colaboracion    # roles, publicación, comentarios
pnpm --filter @tablero/web e2e                   # Playwright: 14 pruebas end-to-end
```

Cuenta actual: **1124 tests unitarios** (280 en `shared`, 267 en `api`, 577 en
`web`) en verde, typecheck limpio en los cuatro paquetes y **14 pruebas
end-to-end** con Playwright. La lógica de dominio vive en `packages/shared` y
no depende del navegador.

## Documentación

| Documento | Qué contiene |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | decisiones técnicas, trampas conocidas y su motivación |
| [`docs/verificacion.md`](docs/verificacion.md) | verificación por fase, con la evidencia de ejecución real |
| [`docs/phases/`](docs/phases/) | briefs de implementación de las fases 3–6 |
| [`docs/review/`](docs/review/) | revisiones independientes por fase |
| [`apps/extension/README.md`](apps/extension/README.md) | instalación y funcionamiento de la extensión |

## Estado

Proyecto completo: las seis fases del plan (base y lienzo, contenido
multimedia, estructura, productividad, colaboración y extras) implementadas,
verificadas con ejecución real y revisadas por un revisor independiente.
El detalle está en [`docs/verificacion.md`](docs/verificacion.md).

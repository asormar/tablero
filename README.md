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
| 2 | Contenido multimedia: subida de archivos, imagen, archivo, vídeo, audio, enlace, muestra de color, pegado inteligente | **Completa y verificada** (ver *Verificación*) |
| 3 | Estructura y organización: columnas, tareas con fechas, conectores con etiquetas, tablas, documento largo, dibujo, mapa, «Sin ordenar», papelera, favoritos | **Completa**: elementos, columnas, conectores y mover entre tableros, más la segunda ronda de la web (bandeja «Sin ordenar», papelera de elementos y tableros, favoritos y recientes, vista global de tareas) y los hallazgos de la revisión de la fase 2 que tocaban la web. Ver *Verificación* |
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
pnpm --filter @tablero/api smoke:assets          # archivos: subida, miniaturas, dedupe, límites, permisos
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

Lo que **no** está verificado todavía: los elementos de las fases 3–6, la
extensión de navegador, el modo presentación y las pruebas end-to-end con
Playwright.

## Verificación de la fase 2

- `pnpm -r typecheck` limpio en los tres paquetes; **135 tests** en `shared` y
  **143** en `web` (los 74 nuevos cubren clasificación y colocación en cascada de
  archivos, cola de subida, recorte, navegación del visor, paleta, forma de onda,
  pegado y visor de PDF); build de producción OK (el visor de PDF y su worker
  cargan en chunks aparte, solo si hay un PDF en el tablero).
- `smoke:assets`: **24/24** con archivos reales — subida multipart a MinIO,
  miniatura WEBP de 480 px, orientación EXIF, duración y miniatura de vídeo con
  ffmpeg, audio con y sin portada, SVG/GIF tal cual, dedupe (201 nuevo / 200
  reutilizado), rechazo 413 de 750 MB (con y sin `Content-Length`), 404 al leer o
  borrar archivos de otro usuario y borrado que limpia fila y objetos.
- Interfaz, en navegador real: **20 imágenes soltadas de una vez** → 20 tarjetas
  al instante con 12 barras de progreso simultáneas (cola de 4 en paralelo), las
  20 subidas, 20 imágenes renderizadas, **0 tarjetas solapadas**; tras borrar el
  `localStorage` y recargar, las 20 vuelven del servidor con sus miniaturas
  (comprobado con una petición real: `200 image/png` por URL firmada de MinIO).
- **Pegar un enlace de YouTube con `Ctrl+V` real** crea la tarjeta de enlace con
  el reproductor incrustado (`iframe https://www.youtube.com/embed/…`).
- La API dejó de exponer claves de almacenamiento: el cliente usa siempre rutas
  propias (`/api/assets/:id/raw` y `/thumb`) que redirigen a URLs firmadas.

Pendiente de verificación manual (necesita gesto humano): el cuentagotas y el
selector de color nativo, y la grabación con un micrófono real.

## Verificación de la fase 3

Lo que está hecho y comprobado por el agente principal con ejecución real:

- **Criterio 1 (kanban)**: cuatro columnas en fila sin solapes, tarjetas dentro de
  ellas y **una tarjeta movida de la columna 1 a la 2** con arrastre real: el
  destino se resalta, los contadores pasan de `2,1` a `1,2` y el orden dentro de
  la columna destino es el del punto de suelta. Confirmado además en el documento
  persistido (`childrenIds` de cada columna).
- **Criterio 2 (conectores)**: una flecha creada arrastrando desde el anclaje
  derecho de una nota hasta otra, con el trazo medido **en vivo durante el
  arrastre** (el extremo pasó de `688,720` a `1028,784` antes de soltar). En el
  documento el conector se guarda como anclajes (`side: right` → `auto`), que es
  lo que hace que siga a las tarjetas sin trabajo extra.
- **`pnpm -r typecheck`** limpio en los tres paquetes, **256 tests** en `shared`,
  **84** en el API (35 nuevos) y **243** en la web (100 nuevos); build OK.
- **API de la fase 3** probado sobre una base creada desde cero: la bandeja «Sin
  ordenar» se crea una sola vez y es la misma siempre, no se puede tirar (409
  `cannot_trash_unsorted`), los favoritos filtran, la papelera de tableros lista /
  restaura / borra definitivo, `/api/tasks` responde validado y
  `/api/maps/search` devuelve lugares reales de Nominatim con caché.
- Smokes: `smoke-rest` 26/26, `smoke:collab` 11/11 (439 bytes persistidos),
  `smoke:assets` 24/24 y `smoke:upgrade` 9/9 (rechazo por `Origin` **y** que el
  API siga vivo, incluida una ráfaga de rechazos).

### Verificación de la segunda ronda (web)

Lo comprobado con ejecución real en el navegador y contra la API:

- **Doble clic (bug abierto)**: la causa no era el DOM que se re-creaba. La clase
  `is-dragging` se aplicaba en el `pointerdown` y desactivaba los eventos de
  puntero de la tarjeta (`pointer-events: none`), así que el `pointerup`, el
  `click` y el `dblclick` caían en el lienzo. Medido con ratón real por CDP:
  `pointerdown → SPAN.board-card__icon [en board]` y `pointerup → DIV.canvas`.
  Ahora la marca llega con el primer movimiento real: la tarjeta de tablero
  **abre** con doble clic (la URL pasa al tablero hijo), la nota monta el editor
  (`.rt-editor`), el documento abre su página completa, y en la columna ya no
  aparece una nota suelta encima (antes el doble clic creaba una).
- **Bandeja «Sin ordenar»**: una nota creada en el tablero de entrada aparece en
  el panel («Nota · Nota de la bandeja», contador 1); arrastrarla al lienzo la
  trae al tablero actual («Se movió 1 tarjeta al tablero actual.»), el panel queda
  en 0 y el servidor la registra (`/api/search` la encuentra en «Inicio»).
- **Papelera**: `Supr` marca (la tarjeta desaparece y entra al panel con sus días
  restantes); `Ctrl+Z` la devuelve **sin** dejar copia en la papelera; restaurar
  desde el panel la trae de vuelta. Tableros: `GET /api/trash` los lista,
  restaurar limpia `trashedAt`, y el borrado definitivo (con confirmación en dos
  pasos) los saca de la papelera. El purgado de 30 días corre al abrir el tablero
  y al abrir el panel.
- **Archivos huérfanos (I3)**: `DELETE /api/assets/:id` se llama **al vaciar la
  papelera**, no al borrar la tarjeta. Medido: al borrar una tarjeta el asset
  sigue en 200; al vaciar con otra tarjeta apuntando al mismo `assetId` sigue en
  200; al borrar la última referencia el asset queda en 404 y los objetos de
  MinIO desaparecen del bucket (comprobado en `/data/tablero/assets/<owner>/` y
  `thumbs/<owner>/`). Decisión y motivos en `ARCHITECTURE.md`.
- **Error de subida (I1) y reintentar (I2)**: con un 413 real de la API
  (`{ error, code }`), la tarjeta muestra el motivo («El archivo supera el máximo
  de 500 MB») y ofrece «Reintentar» y «Elegir otro archivo»; reintentar sube de
  verdad (la tarjeta pasa a imagen con su `src` de `/api/assets/:id/raw`), y
  «Elegir otro archivo» también.
- **Favoritos y recientes**: la estrella de la tarjeta de tablero marca con
  `PATCH /api/boards/:id { favorite }` (`?filter=favorites` lo devuelve), la
  página «Tableros» lista favoritos y recientes, permite marcar/desmarcar y
  abrir un tablero desde la lista.
- **Vista de tareas**: los filtros responden al API (vencidas 0, hoy 1, próximas
  2, hechas 0, todas 3) y están agrupados por tablero; «Ir» salta al elemento
  (cambia de tablero, selecciona la lista y la deja dentro de la vista).
- **Mapa**: la búsqueda llama a `/api/maps/search?q=…&limit=5` y lista lugares
  reales de Nominatim; elegir un resultado recentra y agrega el marcador.
- **Arrastre de filas de tareas entre listas**: medido con ratón real por CDP —
  soltar sobre una fila mueve la tarea (como hermana o subtarea según la zona) y
  soltar en el **hueco inferior de la lista** también (ese caso no hacía nada y
  se arregló: la lista entera es zona de soltado).
- **Sin regresiones de gestos**: arrastrar una tarjeta en el lienzo commitea su
  posición (`translate3d(-136px, 504px)` → `translate3d(-184px, 632px)`), y en un
  kanban de dos columnas una tarjeta pasó de la columna 1 a la 2 (contadores
  `1,1` → `0,2`, con resaltado del destino y línea de inserción).
- **Chunk de arranque (M1)**: 933.85 kB → **399.74 kB** (`manualChunks` de
  React, Yjs, Zod, iconos y editor; `ImageViewer`, `CropEditor` y
  `RecorderPanel` en `React.lazy` y montados solo al abrirse). `pdfjs` (436 kB),
  `leaflet` (149 kB) y `perfect-freehand` quedan en chunks propios.
- `pnpm --filter @tablero/web typecheck` limpio, **257 tests** en la web (243 +
  14 nuevos: mensaje de error de subida con 413, liberación de assets y acciones
  de la papelera) y build OK.

Lo que sigue sin verificarse a mano (necesita gesto humano): cuentagotas,
selector de color nativo y grabación con micrófono real.

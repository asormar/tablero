# Arquitectura de Tablero

Este documento registra las decisiones tomadas donde el plan maestro dejaba
libertad, con el motivo y la consecuencia. El plan maestro es la referencia de
producto; aquí está el porqué técnico.

## Estructura del repositorio

```
apps/web          frontend React + Vite
apps/api          API REST (Fastify) + servidor Hocuspocus
packages/shared   tipos, esquemas Zod y lógica de dominio compartida
docker            compose y configuración de infraestructura
```

`packages/shared` se consume como **fuente TypeScript** (`"main": "./src/index.ts"`,
más `exports`), no como paquete compilado. Motivo: un solo origen de verdad para
tipos y esquemas, sin paso de compilación en el ciclo de desarrollo. El paquete
igual expone un `build` a `dist/` para quien lo necesite.

## Dominio

### Identidad de los tableros: local frente a servidor

Un tablero creado sin conexión tiene un id local (`bd_…`); los del servidor son
cuid (`cmu4…`). **Un tablero local no puede ser el tablero activo cuando hay
servidor**: su documento da 404 en la API y `onAuthenticate` del WebSocket lo
rechaza («Sin acceso al tablero»), así que el contenido quedaría aislado en el
navegador sin ningún aviso. Por eso, al arrancar con conexión:

1. Se elige tablero activo **solo entre los del servidor**.
2. Si el tablero pedido (URL o último abierto) existe únicamente en local, se
   **adopta**: se crea en el servidor, se fusiona su documento Yjs en el id
   nuevo (`mergeLocalDocuments`, una unión de CRDTs, así que no pisa nada) y se
   reemplaza el marcador local por el del servidor.
3. Si el tablero local es una raíz y el servidor ya tiene una raíz **con el
   mismo título**, el documento se fusiona ahí en vez de crear otro tablero: la
   fusión es una unión de CRDTs, así que no pisa nada. Si no hubiera gemela, la
   adopción crea un tablero cuyo padre acaba siendo la raíz (la API anida por
   defecto), nunca una segunda raíz: evita el «Inicio» dentro de «Inicio».

### Elementos

El elemento vive en un `Y.Map` **plano**: las claves son primitivas (string,
number, boolean) y las estructuras (ítems de tarea, tablas, trazos, marcadores,
vista previa de enlace) se guardan como JSON en una sola clave. Motivo: Yjs
mergea `Y.Map` y `Y.Array` de forma consistente; un `Y.Map` plano evita
resoluciones de conflicto raras en campos que siempre se pisan enteros (x, y,
ancho, color).

El texto enriquecido sí es un `Y.XmlFragment` anidado en la clave `text`, porque
`y-prosemirror` necesita un tipo XML colaborativo para el árbol del documento.
Regla que se respeta en todo `writeElement`/`patchElement`: **nunca** se escribe
la clave `text` desde fuera del editor.

`ElementType` incluye `line` (previsto en el plan), pero las líneas se
implementan como **conectores** en `connectors`, no como elementos del lienzo:
una línea con dos extremos no tiene posición propia, se deriva de las tarjetas
que une. Las líneas libres (sin extremos) también viven en `connectors`.

### Alturas

La altura de una tarjeta es automática (la calcula el contenido). Por eso
`BaseElement.height` es opcional: solo se persiste cuando el usuario la fija.
Para las operaciones que necesitan un rectángulo (guías, lazo, encaje) se usa
`elementRect(elemento, alturaMedida)`, donde la altura medida la aporta el
`ResizeObserver` de la capa web. Sin medición se usa la altura por defecto del
tipo: las guías nunca quedan desalineadas por un dato ausente.

### Deshacer / rehacer

Dos gestores, cada uno en su terreno:

| Ámbito | Gestor | Origen |
|---|---|---|
| Lienzo (crear, mover, redimensionar, borrar, color, orden) | `Y.UndoManager` sobre `elements`/`order`/`connectors` | `trackedOrigins = { localOrigin }` |
| Texto dentro de un editor | historial de ProseMirror (`yUndoPlugin` sobre el fragmento) | interno del editor |

Consecuencia: `Ctrl/Cmd+Z` con el foco dentro de un editor deshace texto; fuera
de él deshace el último gesto de lienzo. Un gesto de arrastre es **una** sola
transacción (se commitea al soltar, no en cada frame), así que un `Ctrl/Cmd+Z`
devuelve el grupo completo a su sitio.

### Clonado de texto

Duplicar o pegar elementos no puede copiar un `Y.XmlFragment` con una
actualización binaria (requiere reescribir los items del subárbol). Por eso
`duplicateElements` y `pasteClipboard` aceptan un callback (`cloneText` /
reconstrucción de texto) que la capa web implementa con
`yXmlFragmentToProsemirrorJSON` + `prosemirrorJSONToYXmlFragment` de
`y-prosemirror`. El dominio compartido no depende de ProseMirror.

El fragmento destino se integra en el documento **antes** de escribirlo (si no,
Yjs rechaza cualquier lectura de su contenido).

### Geometría

- `rectsIntersect` es de solapamiento **estricto**: dos tarjetas que solo se
  tocan por el borde no solapan. La contención se prueba con `rectContainsPoint`
  (inclusiva), así que hacer clic en el borde de una tarjeta la selecciona.
- `computeAlignment` devuelve `{ dx, dy, guides }`: un solo desplazamiento para
  todo el grupo (caja envolvente) y las guías que la UI debe dibujar. En empate
  entre una guía de borde y una de centro gana la de centro.
- La rejilla de 8 px es el respaldo cuando no hay guía magnética dentro del
  umbral (6 px de mundo). `guides` y `gridSnap` se pueden desactivar por ajuste.

### Papelera

Borrar un elemento es **marcar, no mover**: recibe `deletedAt`/`deletedBy` y
`getElements`/`getOrderedElements` lo ocultan. El texto enriquecido
(`Y.XmlFragment`) nunca se toca y el orden de apilado se conserva solo, así que
restaurar es quitar la marca. Motivos: mover el elemento a otra estructura
obligaría a clonar el fragmento de texto (el mismo problema que documenta
*Clonado de texto*), y así el `UndoManager` sigue cubriendo el borrado —
`Ctrl/Cmd+Z` después de borrar devuelve la tarjeta **sin** dejar copia en la
papelera, que era criterio de aceptación de la fase 1. Las columnas se llevan
sus hijos y los devuelven con ellas. `purgeTrash` elimina definitivamente lo que
superó los 30 días y se ejecuta al abrir el tablero: sin cron, que es lo que
corresponde a un producto autoalojado.

Todas las superficies de borrado del lienzo (`Supr`, las barras y el menú
contextual) pasan por `deleteSelection`, que **marca**: si alguna vuelve a
llamar a `removeElements`, la tarjeta desaparece sin pasar por la papelera y sin
posibilidad de restaurarla.

El panel de papelera muestra las dos papeleras juntas: los elementos del
documento (restaurar, vaciar) y los tableros (`GET /api/trash`, que viven en
Postgres).

### Liberación de archivos (assets)

Un archivo (`Asset` + objetos en MinIO) se libera recién cuando **sale del
documento para siempre**: al vaciar la papelera o al purgar lo que superó los 30
días, y solo si ningún otro elemento del documento sigue apuntando a ese
`assetId`. Motivos:

- Borrar una tarjeta solo la marca, así que liberar el archivo en ese momento
  rompería el deshacer (`Ctrl/Cmd+Z` devuelve la tarjeta) y el restaurar desde
  la papelera: la imagen volvería sin su archivo.
- Duplicar o pegar una tarjeta de archivo copia su `assetId` (el binario es el
  mismo), de modo que dos elementos pueden compartir un asset. Sin la
  comprobación de referencias, vaciar la papelera dejaría a la copia sin imagen.
- Los derivados en memoria (documento de pdfjs, picos de la forma de onda) se
  sueltan a la vez, con `forgetPdfDocument`/`forgetPeaks`; si no, quedarían
  cacheados en el cliente archivos que ya no existen.

La decisión vive en `apps/web/src/lib/assetCleanup.ts` (`releaseUnreferencedAssets`)
y la usan `emptyTrashForever`/`purgeExpiredTrash` de `lib/trashActions.ts`. El
listado de traspapelados (`getTrashedElements`) también cuenta como referencia:
un elemento en la papelera todavía puede volver.

La papelera de **tableros** es otra cosa: vive en Postgres (`Board.trashedAt`) y
la expone el API (`GET /api/trash`, `POST /api/trash/:id/restore`,
`DELETE /api/trash/:id`). El panel de la interfaz muestra las dos juntas.

### Conectores

Un conector no guarda posición: guarda **a qué elemento y a qué lado** se ancla.
La geometría (curva, punto medio de la etiqueta, caja envolvente) se recalcula en
cada render con `connectorGeometry`, y por eso las flechas siguen a las tarjetas
sin ningún trabajo de sincronización. El lado `auto` se resuelve mirando al otro
extremo, así que el conector se reacomoda solo cuando las tarjetas cambian de
posición relativa. Coherente con esto, `ElementType` no tiene una tarjeta de
línea: las líneas libres también son conectores con extremos sin elemento.

### Movimiento de elementos entre tableros

Copiar elementos de un tablero a otro es **del lado del cliente**. Son dos
documentos Yjs distintos y el texto enriquecido necesita el esquema de
ProseMirror, que vive en la web (`y-prosemirror`), no en el API. El módulo de la
web abre una sesión temporal del tablero destino, espera el `synced`,
reconstruye los elementos con su texto y recién entonces los borra del origen.
Mover **tableros** sí es del servidor (`POST /api/boards/:id/move`), porque ahí
solo cambia `parentBoardId` en Postgres.

## Dependencias y versiones

- **Zod 3**, no 4: los esquemas compartidos usan la API de la serie 3
  (`z.record(clave, valor)` de un argumento, `.email()`, `z.enum(tupla)`).
- **`@node-rs/argon2`** en lugar de `argon2`: el paquete oficial necesita
  `node-gyp` y un toolchain de C++ en Windows; el de Rust trae binarios
  precompilados equivalentes.
- **DOM, no `<canvas>`**, para las tarjetas: el texto enriquecido tiene que ser
  editable y accesible. El lienzo se transforma con `translate`/`scale` sobre un
  contenedor.
- **Virtualización + suscripción por elemento**: la capa de elementos se
  suscribe al `Y.Map` de cada elemento con `useSyncExternalStore`, así mover una
  tarjeta no vuelve a renderizar las otras 299. Durante un arrastre el
  desplazamiento se aplica directo al DOM (refs) y se commitea a Yjs al soltar.
- **El cliente de Prisma se genera al instalar**: `pnpm install` corre el
  `postinstall` de la raíz (`prisma generate`), así que un checkout limpio pasa
  `pnpm -r typecheck` sin pasos manuales; si cambia el esquema, `pnpm db:generate`
  vuelve a generarlo.

## Trampas conocidas

- **`is-dragging` no puede marcar el `pointerdown` pelado**: esa clase apaga los
  eventos de puntero de la tarjeta (a propósito: debajo tiene que verse la
  columna o la tarjeta de tablero que define el destino del soltado). Si se
  aplica al presionar, el `pointerup`, el `click` y el `dblclick` caen en el
  lienzo: una tarjeta de tablero no se abría y el doble clic creaba una nota
  encima. Se marca en el primer movimiento real (`startMoveDrag`,
  `startWidthResize`, `startKanbanDrag`); un clic sin movimiento nunca la activa.
- **`@hocuspocus/provider` no envía el mensaje de autenticación si `token` está
  vacío** (`isAuthenticationRequired` es `!!token && !isAuthenticated`). Sin él
  la conexión queda abierta pero sin sincronizar, y el servidor no llega a
  llamar a `onAuthenticate`. El cliente de navegador pasa un valor que solo
  dispara el handshake (`BROWSER_AUTH_TRIGGER`): la credencial real viaja en la
  cookie httpOnly del handshake, que el servidor prefiere siempre. El servidor
  descarta cualquier token de menos de 32 caracteres para que un marcador como
  ese no pueda usarse como credencial.
- **Un cuerpo vacío con `Content-Type: application/json`** hacía que Fastify
  respondiera 400 (`FST_ERR_CTP_EMPTY_JSON_BODY`): un `POST /auth/logout` sin
  datos fallaba si el cliente mandaba la cabecera. Hay un analizador de JSON
  propio que trata el cuerpo vacío como objeto vacío y sigue rechazando el JSON
  mal formado con 400.
- **Cambiar un valor de `localStorage` a mano en pruebas**: la app guarda JSON,
  así que `readLastBoardId()` descarta un string sin comillas. Al reproducir un
  estado a mano, hay que escribir `JSON.stringify(valor)`.
- **`POST /api/boards` con `parentBoardId: null` no crea una raíz**: la API anida
  el tablero nuevo bajo la raíz del usuario (solo el registro crea una raíz). Al
  adoptar un tablero local hay que contar con eso, o se cuela un «Inicio» dentro
  de «Inicio».
- **React no ve un `value` puesto por JavaScript** en un campo controlado, ni
  con el setter nativo del prototipo: un `dispatchEvent('input')` no basta para
  probar un formulario. Hay que escribir con entrada real (CDP `Input.insertText`
  o `fill_input`).

## Fase 4 — decisiones del API

- **Índice de búsqueda**: lo escribe el servidor en el hook de persistencia de
  Hocuspocus (`syncSearchIndex`), nunca el cliente. `SearchIndex` guarda el
  texto tal cual (`text`), su versión normalizada sin diacríticos (`textNorm`,
  para que `reunion` encuentre «Reunión») y el `tsvector` generado por Postgres
  (`to_tsvector('spanish', text)` + índice GIN). La ruta combina los dos caminos
  (`tsv @@ websearch_to_tsquery` para ranking y `ts_headline`, `LIKE` sobre
  `textNorm` para subcadenas y acentos omitidos) y **no guarda la posición**: la
  resuelve del documento Yjs persistido, sólo para los tableros que aparecen en
  los resultados. `POST /api/search/reindex` rehace el índice desde los
  documentos (parcial con `boardId`, exige edición).
- **Historial de versiones**: una instantánea automática por tablero cada 10
  minutos de actividad, creada en el mismo hook (`lib/versions.ts`); el throttle
  se resuelve contra la base, así que vale con varias instancias y sobrevive a
  reinicios. Retención: las últimas 50 + una por día hasta 30 días.
  **Restaurar** (lo pidió el plan) no reescribe el documento vivo: se cierran
  las conexiones, se espera a que el guardado con debounce se vacíe, se descarga
  el documento, se escribe el estado de la instantánea y se guarda el estado
  anterior como `pre-restore` (la restauración es reversible). Además queda una
  **guardia de 8 s** en la que toda conexión a ese tablero se cierra con
  «Reset Connection» (4205): sin ella, un cliente que todavía tiene el documento
  viejo en memoria lo reenvía al reconectar y la fusión CRDT reviviría lo que el
  usuario acaba de descartar. **Contrato del cliente**: al recibir ese cierre
  (o al volver a abrir el tablero después de restaurar) tiene que **descartar su
  documento local** y recargarlo del servidor; la guardia le da la ventana para
  hacerlo.
- **Exportación**: Markdown, texto plano, JSON y ZIP los arma el servidor
  (`POST /api/boards/:id/export?format=…`, `GET /api/export/account`); PNG y PDF
  los resuelve el navegador. El ZIP lleva `board.md`, `board.txt`, `board.json`
  y los archivos reales en `assets/…` (leídos de MinIO en streaming, un archivo
  por vez, con `zip.ts`, un escritor propio sin dependencias). El `board.json`
  de cada tablero es `{ format: 'tablero.board', version: 1, board, document,
  assets }`, donde `document.state` es **el estado Yjs en base64** (lo único que
  restaura el texto enriquecido; la proyección `elements`/`texts` es para leer o
  reconstruir sin Yjs) y `document.elements[].boardId` referencia ids de otros
  `board.json` del mismo ZIP, para que quien importe los remapee. La cuenta
  entera usa `{ format: 'tablero.account' }` con `boards/<nn>-<título>/…`.
- **Plantillas**: las 12 del sistema las siembra `scripts/seed-templates.ts`
  (`pnpm --filter @tablero/api seed:templates`) sobre un **usuario de sistema**
  (con `Template.ownerId = null`, contraseña aleatoria que no se guarda: nadie
  puede entrar a esa cuenta). Los subtableros de una plantilla cuelgan de verdad
  (`parentBoardId`) del tablero de la plantilla, y al instanciar o guardar como
  plantilla se copia el estado Yjs y **se remapean las tarjetas de tablero** a
  las copias (`remapBoardReferences`); sin ese remapeo la copia apuntaría a los
  tableros del origen.
- **Captura rápida** (`POST /api/capture`): token personal (`Authorization:
  Bearer`, `X-Capture-Token` o `token` en el cuerpo) o sesión. El guardia CSRF
  deja pasar las peticiones mutantes con esas cabeceras aunque no traigan
  `Origin` (un navegador no puede ponerlas sin preflight, y el preflight lo corta
  CORS): es lo que permite capturar desde un atajo del móvil o un script. Crea la
  nota en «Sin ordenar» (o en el tablero indicado con permiso de edición) sobre
  el documento vivo de Hocuspocus si hay servidor, y si no sobre el estado
  persistido; `image` y `file` devuelven 400 `capture_unsupported_type`.
- **Ajustes y almacenamiento**: `GET/PATCH /api/settings` sobre `User.settings`
  (siempre completos, con valores por defecto; un campo inválido guardado no
  tumba a los demás) y el token de captura incluido en la respuesta.
  `GET /api/storage` cuenta el espacio usado y los **huérfanos** (assets sin
  ninguna referencia en los documentos del usuario, contando elementos en la
  papelera del lienzo y portadas); `DELETE /api/storage/orphans` los recalcula en
  el servidor, borra objetos y filas, y no se fía de ids que mande el cliente.

## Fase 5 — decisiones del API

- **Una sola autorización por tablero**: `resolveBoardAccess(userId, boardId)`
  (`apps/api/src/lib/access.ts`) devuelve `owner | editor | commenter | viewer |
  none`. La usan todas las rutas por tablero (a través de
  `requireBoardView/Editor/Commenter/Owner`) y el servidor de colaboración. La
  herencia sube por la cadena de ancestros: gana la primera fila explícita de
  `BoardMember`; el dueño del tablero es `owner` y un ancestro propio se hereda
  como `editor` (heredar propiedad equivale a poder editar). El árbol completo
  lo siguen resolviendo `loadBoardAccess`/`BoardAccess` con la misma regla
  memoizada, así que listar, migas de pan y conteos no cambian de forma.
- **`Share` se retira**: lo reemplaza `BoardMember` (rol por tablero). Las
  invitaciones van aparte (`Invitation`: email, rol, token, `expiresAt`,
  `acceptedAt`) y solo el dueño gestiona; aceptar exige sesión con el mismo
  email. El email lo manda un transporte enchufable (`lib/email.ts`) que en
  desarrollo escribe en el log.
- **El socket también autoriza**: `onAuthenticate` resuelve el rol, lo deja en
  el contexto de la conexión y marca `readOnly` a quien no puede editar;
  `onLoadDocument` vuelve a comprobar lectura (y cubre las conexiones directas
  del propio servidor). La escritura se filtra **por tipo de cambio** en
  `beforeHandleMessage`: un `viewer` no escribe nada (el receptor del protocolo
  descarta sync-step2 y update) y un `commenter` escribe **solo** lo que toca
  `doc.getMap('comments')` (`apps/api/src/collab/comment-writes.ts` decide
  mirando el tipo raíz de cada struct y de la delete set del update); cualquier
  otro update se descarta y queda en el log. El update aceptado se aplica en el
  hook (no se deja `readOnly = false` para que lo aplique el receptor: el flag es
  estado de la conexión y dos mensajes seguidos del cliente lo pisaban) y el
  servidor manda el acuse que el receptor, en modo lectura, manda como `false`.
  Un lote mixto se descarta entero
  (un update de Yjs no se aplica por partes; si el cliente arrastra cambios
  rechazados, los structs posteriores quedan en `pendingStructs` —limitación de
  Yjs con los huecos de reloj—). Un intento descartado **no** cierra
  la conexión: el cliente puede tener cambios locales y cerrarle el socket lo
  dejaría reconectando en bucle. El cierre con código propio (**4403**,
  reabrible) se usa cuando el permiso *cambia*: expulsar o bajar de rol cierra
  las conexiones de esa cuenta en ese tablero **y en todo su subárbol** (el rol
  se hereda hacia los hijos; `connectionsClosed` cuenta las que se cerraron de
  verdad), y el cliente reconecta y vuelve a autenticarse.
- **Comentarios**: el documento Yjs es la fuente de verdad (`doc.getMap('comments')`,
  un `Y.Map` plano por comentario; ver `packages/shared/src/comments.ts`). El
  hook de persistencia los extrae a la tabla `Comment` (upsert + borrado de los
  que ya no están) y `GET /api/boards/:id/comments` sincroniza antes de listar.
  El anclaje se valida contra el documento: un comentario atado a una tarjeta
  borrada queda como **chincheta libre** (`elementId: null`), no apuntando a
  nada. Un comentario de un autor que ya no existe (o una respuesta sin su
  hilo padre en el documento) se **ignora** en la sincronización en vez de
  tumbar la petición (la tabla tiene FK a `User` y a la propia raíz). Las
  menciones (`@email` o `@nombre`, resolviendo **cualquier palabra** del nombre)
  crean la notificación con clave `mention:<comentario>:<usuario>`, así que
  editar o resincronizar no duplica; las respuestas avisan con
  `reply:<respuesta>:<autor>`. Resolver y borrar se aplican **al documento**
  (vivo si hay servidor; persistido si no) y a la tabla acto seguido. El rol
  comentarista puede crear, resolver y borrar comentarios por el socket (ver
  arriba), pero no editar nada más.
- **La vista de la invitación es pública**: `GET /api/invitations/:token` no
  exige sesión —el token del enlace es la credencial— y va registrada fuera del
  scope protegido; el email sale enmascarado salvo para quien tenga sesión con
  ese mismo email (`emailMatches`). Aceptar (`POST …/accept`) sí exige sesión y
  el mismo email.
- **Actividad y notificaciones**: la actividad la reporta el cliente por lotes
  (`POST /api/boards/:id/activity`, tope 100 eventos, marcas del cliente
  acotadas a 30 días atrás y 5 minutos de reloj adelantado), el servidor
  descarta los elementos que no existen en el documento y el actor sale siempre
  de la sesión. `elementType` es un **string libre** (el `type` de un elemento
  lo define el documento, no una lista cerrada: cerrarlo contra los tipos que
  conoce la interfaz rechazaba documentos reales). Las notificaciones se
  deduplican por `dedupeKey`, se listan y se marcan leídas (`POST
  /api/notifications/read` con ids o `all`), y el barrido de tareas vencidas
  corre cada 15 minutos (y al abrir el panel, con throttle de un minuto)
  avisando al asignado o, si no hay, a los miembros; el aviso guarda en
  `meta.dueDate` el **vencimiento real** de la tarea (el día del barrido vive
  solo en la `dedupeKey`).
- **Publicación**: slug de 12 caracteres base58 generado al azar (nunca el
  título), contraseña opcional con argon2, `publishedAt`, ajuste de subtableros
  y límite de intentos por slug+IP. Las tres rutas de gestión son del dueño y
  responden **404** a cualquier otro (ni 403 ni 404 según sea miembro o ajeno:
  la misma política que el resto del API, que no revela la existencia del
  tablero). La vista pública es **de solo lectura y sin
  socket**: `GET /api/public/boards/:slug` (+ `/document` con `?boardId=` para
  los descendientes) sirve una **copia saneada** del estado Yjs —sin elementos
  `comment-pin` ni `createdBy`/`deletedBy`— y metadatos sin emails ni ids de
  miembros. Los assets **no** se sirven con la URL firmada de S3 (la clave
  `assets/<ownerId>/…` lleva el id del dueño): el payload trae un enlace firmado
  con HMAC propio (15 min) y el API entrega los bytes en streaming. Todo lo
  público manda `x-robots-tag: noindex`.
- **Presencia**: registro en memoria del proceso (nombre, rol, última señal,
  conexiones), alimentado por el socket y por las rutas REST, que caduca a los
  60 s. `GET /api/boards/:id/presence` devuelve además el **color del cursor**,
  derivado del id con `cursorColor` (ocho tokens de la paleta, compartido con la
  web en `@tablero/shared`).
- Los nombres de columna `publishedSlug` / `publishedPasswordHash` se conservan
  (ya existían desde la fase 3 y los usa `BoardSummary`); la fase 5 agrega
  `publishedAt` y `publicIncludeSubBoards`.

## Idioma

La interfaz y los comentarios del código están en español (idioma por defecto
del producto según el plan). El plan deja el inglés como segundo idioma: los
textos de la interfaz deben vivir agrupados y no incrustados en la lógica, para
poder traducirlos sin tocar componentes.

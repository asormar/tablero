# Fase 5 — Colaboración

Brief de implementación. El detalle de producto está en el plan maestro
(`plan-clon-milanote.md`, §8 y la fase 5 de §9); acá va **qué** construir, las
decisiones ya tomadas y **cómo** verificarlo.

## Criterios de aceptación (los define el proyecto para esta fase)

1. Invitar a una segunda cuenta con rol **lector** y comprobar que puede ver el
   tablero por la REST **y** por el socket, pero **no** puede escribir por ninguno
   de los dos caminos; con rol **editor** puede editar a la vez que el dueño.
2. Ver los **cursores ajenos** con nombre y color, la selección ajena resaltada y
   el indicador de quién está mirando el tablero.
3. **Publicar** un tablero: `/p/:slug` abre en solo lectura **sin sesión**; con
   contraseña la pide; los subtableros se ven o no según el ajuste.
4. Comentar una tarjeta con `@mención`: al mencionado le llega la notificación,
   el comentario aparece en el panel y el contador de la tarjeta sube.
5. El **registro de actividad** del tablero lista quién añadió o modificó qué.
6. Las notificaciones se marcan como leídas y el contador de no leídas cuadra.
7. Los permisos **se heredan** en subtableros: quien es miembro del padre abre el
   hijo; un lector del padre sigue sin poder escribir en el hijo. Se pueden
   sobrescribir por subtablero.

## Decisiones ya tomadas (no las rediseñes; van a ARCHITECTURE.md)

- **Autorización por tablero, en un solo lugar**. Una función
  `resolveBoardAccess(userId, boardId)` devuelve `owner | editor | commenter |
  viewer | none` y **la usan todas** las rutas por tablero y el servidor de
  colaboración. La herencia se resuelve subiendo por la cadena de ancestros: gana
  la primera fila explícita de `BoardMember`; si no hay ninguna, `none`. El dueño
  siempre es `owner`.
- **El socket también autoriza**: `onAuthenticate`/`onLoadDocument` comprueban
  lectura y escritura por tablero y el estado del cliente lleva el rol; un
  `viewer` no puede aplicar updates (el servidor los descarta, no los acepta).
  Cerrar por falta de permiso usa el mismo camino que `trashedAt` (código
  propio, reabrible, sin tumbar el proceso).
- **La publicación es de solo lectura y sin socket**: el visitante anónimo lee
  `GET /api/public/boards/:slug` (documento persistido + metadatos + mapa de
  assets firmados) y la web lo pinta en modo lectura, refrescando cada 15 s.
  Es una simplificación deliberada: la colaboración en vivo queda para las
  cuentas con sesión. El slug es inadvertible (12 caracteres base58), la
  contraseña opcional se guarda con argon2 y la ruta manda `noindex`.
- **Los comentarios viven en el documento Yjs** (un elemento `comment` con sus
  respuestas en los campos JSON, anclado a una tarjeta o suelto en el lienzo):
  así el tiempo real sale gratis. El servidor, en el hook de persistencia, los
  extrae a la tabla `Comment` para el panel, las notificaciones y la actividad.
  El documento sigue siendo la fuente de verdad, igual que con el índice de
  búsqueda.
- **La actividad la reporta el cliente** en un endpoint por lotes
  (`POST /api/boards/:id/activity`), con el usuario tomado de la sesión; el
  servidor descarta elementos que no existan y limita el lote. No es una
  frontera de seguridad (es un registro para leer), y evita diffear el documento
  en cada guardado.
- **Notificaciones**: tabla propia, contador de no leídas y `POST
  /api/notifications/read`. Las menciones se resuelven contra los miembros del
  tablero; las tareas vencidas se barren al abrir el panel (y cada 15 minutos en
  el servidor). El envío por email es **opcional** y en desarrollo escribe en el
  log (transporte enchufable documentado); no se configura ningún servidor de
  correo real.
- **El color del cursor** sale del `id` del usuario (los ocho tokens de la
  paleta), para que dos usuarios no se pisen el color.
- **Asignar tareas a miembros** es el único punto opcional (P2): si sobra tiempo,
  el elemento de tarea gana `assigneeId` y el selector usa los miembros del
  tablero; si no, se documenta como pendiente y las notificaciones de tareas
  quedan solo por vencimiento.

## Agente A — apps/api

1. **Esquema**: `BoardMember` (boardId, userId, role, createdAt, invitadoPor),
   `Invitation` (boardId, email, role, token, expiresAt, acceptedAt, invitedBy),
   `Comment` (boardId, elementId, parentCommentId, authorId, body, createdAt,
   resolvedAt), `Activity` (boardId, userId, action, elementId, elementType,
   meta, createdAt) y `Notification` (userId, kind, boardId, elementId, actorId,
   readAt, createdAt). Campos de publicación en `Board`: `publicSlug`,
   `publicPasswordHash`, `publicIncludeSubBoards`, `publishedAt`. Migración con
   índices por `boardId`/`userId`/`readAt`.
2. **Autorización**: `resolveBoardAccess` con herencia y su uso en todas las rutas
   existentes (listar, leer, escribir, assets, versiones, exportar, buscar: la
   búsqueda solo devuelve tableros accesibles) y en el servidor de colaboración.
   Tests de la matriz de permisos (dueño, editor, comentarista, lector, ajeno) y
   de la herencia en subtableros con sobrescritura.
3. **Miembros e invitaciones**: `GET/POST/PATCH/DELETE
   /api/boards/:id/members` (solo dueño para gestionar), `POST
   /api/boards/:id/invitations` (email + rol + caducidad), `GET
   /api/invitations/:token` y `POST /api/invitations/:token/accept`.
   En desarrollo el email se escribe en el log.
4. **Publicar**: `POST /api/boards/:id/publish` y `DELETE .../publish` (slug,
   contraseña opcional, incluir subtableros), `GET /api/public/boards/:slug`
   (con `?password=` cuando haga falta) y `GET /api/public/boards/:slug/document`
   con los assets firmados. Sin sesión, sin filtrar datos privados (nada de
   emails ni ids de miembros), `noindex`, y límite de intentos de contraseña.
5. **Socket con permisos**: rol en el estado de conexión, lectura/escritura
   comprobadas en `onAuthenticate`, `onLoadDocument` y al aplicar updates
   (descartar los de un lector), cierre con código propio y reapertura cuando el
   permiso cambia (al aceptar una invitación o al expulsar a alguien, cerrar sus
   conexiones de ese tablero).
6. **Presencia**: al conectar, el estado del usuario incluye `name` y `color`;
   endpoint `GET /api/boards/:id/presence` para el indicador de quién está
   mirando (últimos 60 s) aunque no haya socket.
7. **Comentarios**: extracción del documento en el hook de persistencia
   (upsert + borrado de los que ya no están), `GET
   /api/boards/:id/comments` (con hilos y anclaje), `PATCH
   /api/comments/:id/resolve`, `DELETE /api/comments/:id`. Menciones: resolver
   `@email` o `@nombre` contra los miembros y crear la notificación
   correspondiente, sin duplicarla si el comentario se edita.
8. **Actividad y notificaciones**: `POST /api/boards/:id/activity` (lote),
   `GET /api/boards/:id/activity` (paginado),
   `GET /api/notifications?filter=unread|all`, `POST /api/notifications/read`
   (ids o todas), `GET /api/notifications/count`. Barrido de tareas vencidas
   cada 15 minutos (reutiliza el índice de tareas o el documento) marcando la
   notificación como única por tarea y día.
9. **Tests y humos**: tests de vitest de la matriz de permisos, invitaciones
   (caducadas, ya aceptadas, de otro email), publicación (slug, contraseña,
   subtableros, sin sesión, datos no filtrados), comentarios, actividad y
   notificaciones; y un `smoke:colaboracion` con las comprobaciones de punta a
   punta (dos cuentas, rol lector rechazado por REST **y** por socket, edición
   simultánea, publicar y leer sin sesión, comentar con mención, actividad y
   contador de no leídas). Los cuatro humos existentes tienen que seguir en
   verde.

## Agente B — apps/web

1. **Compartir**: diálogo de compartir en la barra superior (miembros con rol,
   invitar por email, enlace de invitación con caducidad, copiar enlace),
   gestión de miembros para el dueño (cambiar rol, expulsar) y aceptación de
   invitación en `/invite/:token` (registro o ingreso si hace falta).
2. **Publicar**: panel con el slug, la contraseña, el interruptor de subtableros,
   copiar el enlace y abrir la vista pública; aviso claro cuando el tablero está
   publicado.
3. **Vista pública** `/p/:slug`: lienzo en modo lectura (sin barra de
   herramientas, sin edición, sin selección), pidiendo la contraseña si hace
   falta, con los subtableros navegables si el ajuste lo permite, refresco cada
   15 s y `noindex`.
4. **Tiempo real**: cursores ajenos con nombre y color sobre el lienzo, selección
   ajena resaltada, indicador de quién está mirando (avatares en la barra), y
   edición simultánea del texto enriquecido (ya viene de `y-prosemirror`, hay que
   comprobar que no se rompe con los cursores encima).
5. **Comentarios**: hilo anclado a la tarjeta (icono con contador que abre el
   hilo), chincheta libre en el lienzo, panel lateral con todos los comentarios
   del tablero (filtrar por abiertos y resueltos), responder, resolver, borrar el
   propio, escribir con `@` y autocompletar miembros.
6. **Notificaciones**: campana en la barra con contador de no leídas, panel con
   la lista (menciones, comentarios, respuestas, tablero compartido, tareas
   vencidas), clic que lleva al tablero y al elemento, y marcar como leídas (una
   o todas). Sin recargar la página.
7. **Actividad**: vista del registro del tablero (quién, qué y cuándo) con
   agrupación por día, alcanzable desde el menú del tablero; el cliente reporta
   sus acciones por lotes.
8. **Permisos en la interfaz**: con rol lector o comentarista la interfaz **no
   deja** intentar lo que no se puede (sin barra lateral de creación, sin
   arrastrar, sin editar texto, sin borrar; comentar sí con rol comentarista) y
   explica por qué; el modo lectura no depende del socket (un rechazo del
   servidor deja la interfaz en solo lectura con aviso, nunca en pantalla en
   blanco).
9. **Verificación en navegador**: dos sesiones a la vez (una normal y otra de
   incógnito o con otro almacén) para cursores, presencia, edición simultánea y
   notificaciones; capturas del estado en el documento del servidor y del rechazo
   real del socket para el rol lector.

## Verificación esperada (la hace el agente principal, no el implementador)

- `pnpm -r typecheck` limpio; `shared`, `api` y `web` con sus tests en verde y sin
  bajar (256 / 164 / 432) y el build de la web OK.
- Los cinco humos en verde, incluido `smoke:colaboracion`.
- Reproducción propia en el navegador: dos cuentas, cursor ajeno visible, lector
  rechazado al intentar editar (REST y socket), `/p/:slug` sin sesión, mención
  que notifica, actividad y contador.

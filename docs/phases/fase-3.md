# Fase 3 — Estructura y organización

Brief de implementación. Sale del plan maestro (§4.3, 5.5, 6.2, 6.3, 6.9, 6.12, 6.13, 6.14,
6.16, 7.4, 7.6 y la fase 3 de §9). Acá está **qué** construir y **cómo** verificarlo.

## Criterios de aceptación (los del plan)

1. Se puede montar un kanban de 4 columnas y mover tareas entre ellas.
2. Las flechas (conectores) siguen a las tarjetas cuando éstas se mueven.

Y los criterios generales que ya rigen el proyecto: TypeScript estricto, tests de dominio,
60 fps con 300 elementos visibles, nada se rompe de las fases 1 y 2.

## Contrato ya disponible (`packages/shared`) — no reinventar

| Módulo | Qué trae |
|---|---|
| `todos.ts` | Operaciones de listas de tareas: `addTask`, `toggleTask`, `updateTask`, `removeTask`, `indentTask`, `outdentTask`, `moveTask`, `flattenTasks`, `countTasks`, `progressLabel`, `bucketOf`, `filterTasks`, `sortTasks`, `parseDueDate`, `dueDateLabel`, `todoPlainText` |
| `connectors.ts` | Modelo y geometría: `createConnector`, `resolveEndpoint`, `autoSides`, `connectorGeometry` (devuelve `path` SVG + `labelPoint`), `pointOnPath`, `hitsPath`, `connectorBounds`, `dashArray`, `DEFAULT_CONNECTOR_STYLE` |
| `tables.ts` | `createTableData`, `addRow/removeRow/moveRow`, `addColumn/removeColumn/moveColumn`, `setCellValue`, `toggleCell`, `resizeColumn`, `setColumnType`, `columnSum`, `columnStats`, `parseDelimited`, `tableFromDelimited`, `tableToDelimited`, `tableToObjects`, `todoItemsFromDelimited` |
| `sketch.ts` | Trazos: `appendPoints`, `pointsOf`, `simplifyStroke`, `eraseStrokes` (recorte geométrico), `strokeToPathD`, `strokesBounds`, `scaleStroke`, `effectiveSize`, `toolOpacity` |
| `maps.ts` | `createMapData`, `addMarker/updateMarker/removeMarker`, `markersBounds`, `viewForMarkers`, `fitBounds`, `nominatimSearchUrl`, `parseNominatimResults`, `geocodeResponseSchema`, `osmLink` |
| `doc.ts` | Elementos, orden, conectores y **papelera**: `trashElements`, `restoreElements`, `getTrashedElements`, `purgeTrash`, `emptyTrash`, `TRASH_TTL_MS`, `isTrashed`. Los elementos en papelera llevan `deletedAt`/`deletedBy` y `getElements`/`getOrderedElements` ya los ocultan |
| `elements.ts` | Tipos: ya incluye `ColumnElement` (con `childrenIds`), `TableData`, `SketchStroke`, `MapData`, `TodoItem`, y los campos de papelera |

Las columnas guardan sus hijos en `childrenIds` (un `Y.Array<string>` en el propio elemento,
creado por `addElement` cuando el tipo es `column`). Los hijos conservan `parentId`.

## Reparto

Dos agentes, **directorios disjuntos**, ninguno edita `packages/shared` (si falta algo del
contrato, se resuelve en la app o se pide) y ninguno hace `git commit`.

### Agente A — `apps/api` + migración Prisma

1. Migración aditiva: `Board.favoriteAt` (`DateTime?`) y `Board.isUnsorted` (`Boolean @default(false)`).
2. `PATCH /api/boards/:id` acepta `favorite: boolean` → escribe/limpia `favoriteAt`.
3. `GET /api/boards?filter=`: `all` (por defecto) excluye los tableros `isUnsorted`; agrega
   `favorites` (con `favoriteAt` no nulo, más reciente primero) y `recent` (`updatedAt` desc).
4. `GET /api/boards/unsorted` → devuelve el tablero «Sin ordenar» del usuario, creándolo si no existe.
5. Papelera de **tableros** (§12 del plan): `GET /api/trash`, `POST /api/trash/:id/restore`,
   `DELETE /api/trash/:id` (borrado definitivo). `GET /api/trash` devuelve el árbol en papelera
   con lo que haga falta para restaurarlo (título, icono, color, padre).
6. `GET /api/tasks`: extender para aceptar `filter=all|overdue|today|upcoming|done`, `boardId` opcional
   y devolver las tareas aplanadas con `boardId`, `listId`, `itemId`, `text`, `checked`, `dueDate`,
   `depth`, `order`. Reusar `flattenTasks`, `filterTasks`, `sortTasks` de `todos.ts`; ordenar con
   `sortTasks`. La respuesta va validada con Zod.
7. `GET /api/maps/search?q=&limit=` → proxy de Nominatim (nunca desde el navegador): usa
   `nominatimSearchUrl`, manda un `User-Agent` propio identificando la aplicación, límite de tasa
   propio (máximo 1 request por segundo por proceso, con caché corta en memoria de 10 minutos),
   responde `geocodeResponseSchema` y traduce con `parseNominatimResults`. Respeta la política de
   uso de Nominatim: sin ráfagas, con caché, y fallando con 502 si el servicio no contesta.
8. Tests con vitest (como los que ya existen en `apps/api/src/**/*.test.ts`) y evidencia cruda.

### Agente B — `apps/web`

Orden de prioridad (si algo no llega, lo de arriba va primero):

1. **Columnas y kanban (§6.9)**. Crear desde la barra lateral y con `C`; soltar tarjetas dentro
   (se apilan en el orden de `childrenIds`) y sacarlas arrastrando afuera; reordenar con indicador
   de inserción; plegar/desplegar; contador de elementos; ancho redimensionable (los hijos se
   adaptan); título y color. Varias columnas en fila = kanban. Las tarjetas dentro de una columna
   no tienen posición libre: las coloca el layout.
2. **Listas de tareas (§6.3)**: casillas, `Enter` crea tarea, `Tab`/`Shift+Tab` sangra y desangra,
   arrastrar para reordenar y **arrastrar tareas entre listas**, barra de progreso (`progressLabel`),
   fecha de vencimiento con chip y selector que entiende lo que se escribe (`parseDueDate`,
   `dueDateLabel`), ocultar completadas, y acciones para convertir nota ↔ tarea ↔ encabezado ↔ documento.
3. **Conectores (§6.14)**: capa SVG sobre el lienzo; al pasar el ratón por el borde de una tarjeta
   aparecen los puntos de anclaje; arrastrar de uno a otra tarjeta (o a un punto libre) crea el
   conector; etiqueta de texto editable en el centro; panel de estilo (recta/curva, continua/
   discontinua/punteada, grosor, color, punta en inicio/fin/ambas/ninguna); tirador para curvar;
   borrar con `Supr`; los conectores **siguen a las tarjetas** porque su geometría se recalcula.
4. **Tablas (§6.13)**: rejilla editable con filas y columnas añadibles, redimensionables y
   reordenables; tipos de columna (texto, número con suma al pie, casilla, fecha); cabecera
   opcional; navegación con `Tab` y flechas; pegar desde Excel/Google Sheets con `tableFromDelimited`;
   copiar como TSV con `tableToDelimited`.
5. **Documento (§6.2)**: la tarjeta muestra título y extracto; al abrirla se expande en un editor
   de página completa (modal amplio) con el mismo formato que la nota más imágenes, tablas y
   separadores; índice automático a partir de los encabezados.
6. **Dibujo (§6.12)**: área de dibujo con `perfect-freehand` y Pointer Events (presión del lápiz);
   lápiz, rotulador, subrayador, goma, línea, rectángulo y elipse; color y grosor; deshacer dentro
   del dibujo; fondo transparente o blanco; redimensionable. Usar `appendPoints`, `simplifyStroke`
   y `eraseStrokes` para no inflar el documento.
7. **Mapa (§6.16)**: Leaflet + teselas de OpenStreetMap; marcadores con etiqueta; búsqueda de lugares
   contra `GET /api/maps/search`; encuadre con `viewForMarkers`.
8. **Mover entre tableros (§5.5)**: soltar tarjetas sobre una tarjeta de tablero las mueve dentro
   (resaltando el destino) y sobre una miga de pan las mueve al tablero antecesor; acción «Mover a…»
   con buscador de tableros. El movimiento de elementos es **del lado del cliente**: hay que abrir
   una sesión temporal del tablero destino, copiar los elementos (con su texto enriquecido) y
   borrarlos del origen; el movimiento de tableros es `POST /api/boards/:id/move`.
9. **Panel «Sin ordenar» (§4.3)**: bandeja lateral con los elementos del tablero «Sin ordenar»;
   se arrastran de ahí a cualquier tablero.
10. **Papelera (§7.4)**: panel que lista los elementos en papelera del documento (con `getTrashedElements`)
    y los tableros en papelera (API); restaurar a su sitio y borrar definitivamente; purgado de lo
    que pasó los 30 días al abrir el tablero (`purgeTrash`).
11. **Favoritos y recientes (§7.6)**: estrella en las tarjetas de tablero y en la página de inicio,
    más las listas de favoritos y recientes con los filtros del API.
12. **Vista de tareas global (§6.3)**: página «Tareas» con los filtros vencidas/hoy/próximas/hechas.

## Reglas

- TypeScript estricto, sin `any` sueltos. Nada de `innerHTML`/`dangerouslySetInnerHTML` con datos del usuario.
- La sensación de uso manda: la virtualización del lienzo y los 60 fps con 300 elementos no se negocian.
  Todo lo que agregues al DOM por elemento tiene que respetar el modo simplificado con zoom < 35 %.
- Los comentarios en español neutro; respetá el idioma de cada archivo que toques.
- No toques `packages/shared`: el contrato ya está cerrado.
- No hagas `git commit` ni `git push`: commitea el agente principal después de verificar.
- Nada de dependencias nuevas sin justificarlo en el informe (Leaflet y perfect-freehand ya están
  previstas por el plan; si falta alguna, se instala con pnpm y se dice).

## Trampas conocidas (ya nos pasaron)

- `@hocuspocus/provider` **no manda la autenticación si `token` está vacío**: hay que pasar el token
  de la sesión (ya resuelto en `BoardSession.ts`; cualquier sesión nueva que abran los conectores
  o el movimiento entre tableros tiene que repetirlo).
- El tablero activo tiene que ser del servidor: los documentos locales (`bd_…`) dan 404 y el WS los
  rechaza. Al abrir una sesión temporal para mover elementos, esperá la sincronización inicial
  (`provider.on('synced')`) antes de leer o escribir.
- Los elementos en papelera se ocultan solos en `getElements`/`getOrderedElements`, pero **los hijos
  en papelera de una columna no**: el layout de la columna tiene que filtrarlos, si no queda un hueco.
- El editor de texto (TipTap) necesita foco real: un `dblclick` sintético monta el editor pero no
  siempre le da foco.
- `requestAnimationFrame` no late en una pestaña de fondo: para medir FPS hay que traer la pestaña
  al frente (Page.bringToFront).
- El `localStorage` guarda JSON, no strings crudos (`tablero:lastBoard:v1`).
- El guardia CSRF exige `Origin` en las peticiones mutables y el WebSocket valida también el `Origin`.

## Verificación exigida (con salida cruda en el informe)

1. `pnpm -r typecheck`
2. `pnpm -r test` (hoy: 256 en shared, 143 en web + los nuevos del API)
3. `pnpm --filter @tablero/web build`
4. Smokes existentes: `bash apps/api/scripts/smoke-rest.sh`, `pnpm --filter @tablero/api smoke:collab`,
   `pnpm --filter @tablero/api smoke:assets` — los tres tienen que seguir en verde.
5. Prueba en navegador de los dos criterios de aceptación de la fase, con evidencia: (a) kanban de
   4 columnas con tareas movidas entre ellas, (b) una flecha que sigue a una tarjeta al moverla.
   Levantá el navegador antes de medir; dejá la pestaña al frente.

## Fuera del alcance de esta fase

Comentarios, compartir, publicar, cursores en tiempo real (fase 5); búsqueda global, plantillas,
exportación, historial de versiones, ajustes, PWA y móvil (fase 4). No los adelantes.

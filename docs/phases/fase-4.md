# Fase 4 — Productividad

Brief de implementación. El detalle de producto está en el plan maestro
(`plan-clon-milanote.md`, §7.1–7.11 y la fase 4 de §9); acá va **qué** construir, las
decisiones ya tomadas y **cómo** verificarlo.

## Criterios de aceptación (los define el proyecto para esta fase)

1. Buscar una palabra que esté en cualquier tablero, elegir el resultado y **llegar al elemento
   resaltado** dentro de su tablero.
2. Crear un proyecto desde una plantilla del sistema y organizarlo: la plantilla trae tarjetas e
   instrucciones de verdad, no un tablero vacío.
3. Exportar un tablero a Markdown, texto plano, PNG y ZIP de copia de seguridad, e **importar ese
   ZIP** en otra cuenta recuperando el contenido.
4. Recuperar una versión anterior del tablero desde el historial.
5. Instalar la app como PWA y capturar una nota rápida desde el atajo, que cae en «Sin ordenar».
6. Usar la app en un viewport de móvil (375×667) con la vista de lista del tablero y la barra de
   herramientas abajo.

## Decisiones ya tomadas (no las rediseñes; están en ARCHITECTURE.md)

- **Índice de búsqueda del lado del servidor**: el API ya tiene el documento Yjs persistido. Al
  guardarlo (hook de persistencia de Hocuspocus, con debounce) extrae el texto de cada elemento
  —`Y.XmlFragment.toString()` para notas, documentos, encabezados y tareas; los campos JSON para
  enlaces, archivos, pies de imagen y nombres— y hace upsert en `SearchIndex` (`tsvector`, con
  `boardId`, `elementId`, `elementType`). Hace falta además un endpoint de reindexado completo
  (`POST /api/search/reindex`) para rellenar lo que ya existía. **El cliente no indexa nada.**
- **Historial de versiones**: instantáneas en Postgres, un snapshot por tablero cada 10 minutos de
  actividad (throttle en el mismo hook de persistencia), con retención acotada (por ejemplo las
  últimas 50, más una por día para lo más viejo). Restaurar = sustituir el estado persistido y
  **cerrar las conexiones de ese tablero** para que los clientes reconecten y traigan la versión
  restaurada (no hay que reescribir el documento vivo). Documentá el mecanismo elegido.
- **Exportación**: Markdown, texto plano y ZIP (JSON del documento + archivos reales desde MinIO)
  los arma el **servidor**; PNG y PDF los resuelve el **navegador** (render de la página al
  elemento contenedor para PNG; diálogo de impresión con hoja de estilo de impresión para PDF, que
  es también la función «Imprimir»). El ZIP de importación lo lee el **cliente** (`fflate`), valida
  el JSON y crea los tableros y tarjetas; los Markdown entran como documentos y los CSV como tabla
  o lista de tareas, con los ayudantes que ya existen (`tableFromDelimited`, `todoItemsFromDelimited`).
- **Plantillas**: `Template` ya existe en la base. Las del sistema (12, con `ownerId` nulo) se crean
  con un script de seed que **construye el documento Yjs de cada plantilla** (tablero + tarjetas +
  notas de instrucciones). Instanciar una plantilla es copiar el estado Yjs de la plantilla al
  tablero nuevo (misma técnica que el historial). «Guardar como plantilla» guarda el tablero y sus
  subtableros.
- **Idioma**: la interfaz está en español, con los textos incrustados en los componentes. Esta fase
  introduce el andamiaje de traducción (un `t()` con diccionario es/en) y **migra la interfaz fija**
  (barra superior, barra lateral, paneles, menús contextuales, ajustes); el texto de las tarjetas y
  los textos profundos pueden quedar para después, pero el hueco se documenta.

## Reparto

Dos agentes, **directorios disjuntos**, ninguno edita `packages/shared` más allá de lo indicado y
ninguno hace `git commit`.

### Agente A — `apps/api` (+ migraciones)

1. `SearchIndex`: migración si falta el índice de `tsvector` (hay que verificar cómo está hoy la
   tabla) y todo el camino de indexado desde el documento persistido, más `GET /api/search?q=&type=&boardId=`
   que devuelve resultados agrupados por tablero con fragmento resaltado (`ts_headline`) y posición
   del elemento para poder centrarlo.
2. `POST /api/search/reindex`.
3. Historial: tabla de instantáneas, snapshot con throttle cada 10 minutos en el hook de
   persistencia, `GET /api/boards/:id/versions`, `POST /api/boards/:id/versions/:vid/restore`
   (con el cierre de conexiones), y poda por retención.
4. Exportación: `POST /api/boards/:id/export?format=markdown|text|json|zip`, incluyendo los archivos
   reales (streaming desde MinIO, sin cargarlos enteros en memoria) y `GET /api/export/account` para
   el ZIP de toda la cuenta.
5. Importación de ZIP: si el agente web necesita el descomprimido en el servidor, se acuerda acá;
   por defecto **no** hace falta (el cliente lo lee).
6. Plantillas: seed de las 12 del sistema con documentos Yjs de verdad, `GET /api/templates`
   (con categorías), y `POST /api/templates/:id/instantiate`; `POST /api/templates/from-board/:id`
   para guardar un tablero como plantilla.
7. Captura: `POST /api/capture` autenticado con **token personal** (nueva columna en `User` o tabla
   de tokens; el token se muestra en ajustes) que crea una nota en el tablero «Sin ordenar».
8. Ajustes: `GET/PATCH /api/settings` (tema, idioma, fondo del lienzo, guías) sobre `User.settings`,
   y `GET /api/storage` (espacio usado y archivos huérfanos) + `DELETE /api/storage/orphans`.
9. Tests con vitest y evidencia cruda.

### Agente B — `apps/web`

1. **Búsqueda global y paleta de comandos (`Ctrl/Cmd+K`)**: buscador con resultados agrupados por
   tablero y fragmento resaltado; al elegir uno, abrir el tablero, centrar y resaltar el elemento;
   filtros por tipo. La misma paleta ejecuta acciones («nuevo tablero», «cambiar tema», «ir a…»,
   «exportar»). Búsqueda **dentro del tablero** con `Ctrl/Cmd+F` y navegación entre coincidencias.
2. **Galería de plantillas** al crear un tablero (por categorías) y «Guardar como plantilla».
3. **Exportación e importación desde la interfaz**: menú de exportar (Markdown, texto, PNG, PDF,
   ZIP), subida del ZIP/Markdown/CSV para importar, y la impresión con su hoja de estilo.
4. **Historial de versiones**: panel con previsualización de la instantánea (título, cantidad de
   elementos, fecha) y restaurar con confirmación.
5. **Ajustes**: página con tema claro/oscuro/sistema, idioma, fondo del lienzo (liso, puntos,
   cuadrícula), guías y ajuste a rejilla, gestión de almacenamiento (espacio usado, huérfanos) y
   lista de atajos (que también abre `?`).
6. **Captura rápida**: atajo `Ctrl/Cmd+Shift+N` que crea una nota en «Sin ordenar» sin salir del
   tablero actual.
7. **PWA**: `vite-plugin-pwa` con instalación, caché de la aplicación y Share Target (compartir
   desde el móvil manda la nota a «Sin ordenar»).
8. **Móvil y vista de lista**: en pantallas chicas, barra de herramientas abajo, gestos para navegar
   el lienzo y **vista de lista** del tablero en orden de lectura; añadir foto con la cámara.
9. **Modo presentación**: recorrer tableros o zonas marcadas a pantalla completa, sin barras.
10. **Andamiaje de i18n** con diccionario es/en y migración de la interfaz fija.
11. **Tema oscuro** de verdad: las variables CSS de los tokens (`colors.ts`) ya tienen variantes
    oscuras; falta el interruptor, la persistencia y repasar contraste AA de las tarjetas.

## Reglas

Las mismas de la fase 3: TypeScript estricto, comentarios en español neutro, 60 fps con 300
elementos, virtualización intacta, nada de `innerHTML` con datos del usuario, no commitear, no tocar
el directorio del otro agente, y cualquier dependencia nueva se justifica en el informe.

## Verificación exigida (salida cruda en el informe)

1. `pnpm -r typecheck` y `pnpm -r test`.
2. `pnpm --filter @tablero/web build` (y comprobar que el chunk principal no vuelve a crecer: los
   paneles nuevos van con `React.lazy`).
3. Los smokes existentes en verde (`smoke-rest.sh`, `smoke:collab`, `smoke:assets`).
4. Pruebas en navegador de los 6 criterios de aceptación de arriba, con evidencia: búsqueda que
   centra y resalta el elemento, plantilla instanciada, exportación e importación del ZIP,
   restauración de una versión, PWA instalada con captura rápida, y viewport de móvil con vista de
   lista.

## Fuera del alcance

Colaboración (compartir, publicar, cursores en tiempo real, comentarios, notificaciones) y la
extensión de navegador: fases 5 y 6.

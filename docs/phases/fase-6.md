# Fase 6 — Extras (extensión, pruebas de punta a punta y pulido)

Brief de implementación. El detalle de producto está en el plan maestro (§9 fase 6
y §14 «definición de terminado»); acá va **qué** construir y **cómo** verificarlo.

## Criterios de aceptación (los define el proyecto para esta fase)

1. **La extensión de navegador captura a Tablero**: desde Chromium, con el token
   personal del usuario, manda a «Sin ordenar» la página actual (título, URL,
   selección de texto y una captura de la parte visible o de la página completa),
   y el resultado se ve en la app.
2. **Flujos principales automatizados**: una batería de Playwright que corre sola
   contra una instancia propia y cubre, con aserciones reales: registro e ingreso,
   crear un tablero desde una plantilla, añadir nota, tarea con fecha, columna,
   conector y una imagen, buscar y llegar al elemento, publicar y leer la vista
   pública sin sesión, restaurar una versión, exportar a Markdown y borrar/restaurar
   desde la papelera.
3. **Accesibilidad**: todo el flujo principal se puede hacer **sin ratón**
   (lienzo, tarjetas, paneles, diálogos), los controles tienen nombre accesible,
   el foco está siempre visible y no queda ningún problema de contraste AA en los
   dos temas.
4. **Rendimiento medido y documentado**: 300 tarjetas visibles a 60 fps con los
   números crudos (tiempo por fotograma, memoria, arranque) y sin regresiones
   frente a lo ya medido en la fase 1.

## Decisiones ya tomadas (no las rediseñes)

- **La extensión vive en el monorepo**, en `apps/extension`, con **Manifest V3** y
  sin dependencias de terceros: un popup propio, un *content script* que extrae
  título, URL, selección y una captura (`chrome.tabs.captureVisibleTab` →
  `dataUrl`), y llamadas directas a `POST /api/capture` con el token personal en
  la cabecera. El API ya existe (fase 4): **no hace falta tocarlo**, salvo que la
  captura de imagen necesite aceptar un `dataUrl` de imagen además de un objeto
  `image` (hoy devuelve 400 documentado) — en ese caso, ampliar el contrato es
  parte de esta fase y va con tests.
- **El token de captura se pega a mano** en el popup y se guarda en
  `chrome.storage.local`; no hay OAuth ni flujo de login en la extensión (el
  endpoint de captura está pensado justo para eso).
- **Playwright con Chromium**, suite en `apps/web/e2e`, contra una instancia
  propia del API y un build de la web (no el servidor de desarrollo), con datos
  de prueba propios y limpieza al final. Los flujos deben poder correr en paralelo
  sin pisarse (cuentas distintas por prueba).
- **Accesibilidad**: se arregla lo que la auditoría encuentre en el flujo
  principal; se documenta lo que quede fuera de alcance. Nada de reescribir el
  lienzo: es DOM con focusables, así que es alcanzable con teclado.
- **Rendimiento**: se mide con las mismas herramientas de la fase 1 (perf overlay
  y marcas de `performance`), sobre la misma máquina, y se documentan los números;
  si algo no llega a 60 fps, se anota con su causa y no se maquilla.

## Agente A — extensión de navegador (`apps/extension`)

1. Andamiaje: `apps/extension` en el workspace con `manifest.json` (MV3), popup
   (`popup.html`, `popup.ts`, `popup.css`), *service worker* de fondo y *content
   script*; build propio (Vite o `tsc` + copia de estáticos) que deje una carpeta
   cargable como «extensión sin empaquetar»; `README.md` con los pasos de carga.
2. Captura: el popup pide título, URL, selección y si se quiere captura de la
   parte visible; el *content script* extrae lo que corresponda; el popup llama a
   `POST /api/capture` con el token (cabecera `X-Capture-Token`) y muestra el
   resultado («Nota creada en Sin ordenar») o el error real.
3. Imagen: si la captura lleva imagen, enviarla como `dataUrl` y dejar el API
   aceptándola en el contrato de captura (con su test) si hoy devuelve 400.
4. Opciones: pegar/guardar/borrar el token, elegir la URL base del API, y un
   botón de «probar conexión» que distinga token inválido de API inalcanzable.
5. Verificación: cargar la extensión en Chromium con Playwright (o a mano y
   documentado) y **probar de punta a punta** contra una instancia local: capturar
   una página real, comprobar con `GET /api/boards/unsorted` que la nota llegó
   con su título, su URL y su selección, y que un token inválido da el error
   claro. Evidencia cruda.

## Agente B — pruebas de punta a punta (`apps/web/e2e`)

1. Andamiaje: Playwright instalado en `apps/web` (`@playwright/test`), `e2e/` con
   configuración propia, arranque automático de API y web de prueba en puertos
   dedicados, base de datos propia detectable por variable de entorno y limpieza
   de datos al terminar cada archivo.
2. Flujos (uno por archivo, con aserciones sobre el DOM y sobre la API):
   registro e ingreso; tablero desde plantilla; nota, tarea con fecha, columna y
   conector; imagen subida (con un archivo real pequeño generado en el propio
   test); búsqueda global con `Ctrl+K` que abre el tablero y resalta el elemento;
   publicar y abrir `/p/:slug` sin sesión; restaurar una versión desde el
   historial; exportar a Markdown y comprobar el contenido descargado; papelera
   (borrar, restaurar) y exportación/importación de un ZIP.
3. Robustez: nada de esperas fijas largas — usá las esperas de Playwright por
   elemento/estado; cada prueba crea su propia cuenta y limpia lo suyo.
4. Verificación: correr la batería completa dos veces seguidas sin fallos y dejar
   la salida cruda (resumen del runner y el listado de pruebas) en el informe.

## Agente C — accesibilidad y rendimiento (`apps/web`)

1. Auditoría primero: con teclado, recorrer el flujo principal (abrir tablero,
   crear nota, editarla, moverla, abrir los paneles, usar la paleta `Ctrl/Cmd+K`,
   los diálogos de compartir y publicar) y anotar cada bloqueo con su reproducción;
   auditar contraste en los dos temas y nombres accesibles de los controles.
2. Arreglos: foco visible y orden de tabulación coherente; `aria-label` en los
   controles que solo tienen icono; trampa de foco y cierre con `Esc` en los
   diálogos; anuncios con `role="status"` en las acciones asíncronas; contraste AA
   donde falle; nada de `div` clicleables sin rol.
3. Rendimiento: medir 300 tarjetas (creación, fotograma medio, memoria, arranque)
   con los instrumentos de la fase 1 y documentar los números crudos; arreglar lo
   que sea evidente (trabajo en el camino de render, re-render por estado global)
   y anotar lo que no.
4. Verificación: typecheck limpio, tests de la web sin bajar (532), build OK, y la
   evidencia cruda de la auditoría y de las mediciones antes/después.

## Verificación esperada (la hace el agente principal)

- `pnpm -r typecheck`, las tres suites y el build en verde; los seis humos del API
  sin regresiones.
- Reproducción propia en el navegador de una captura de la extensión y de la
  batería de Playwright (corrida completa, con la salida cruda).
- Las mediciones de rendimiento repetidas en la misma máquina.

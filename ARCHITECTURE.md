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

## Trampas conocidas

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

## Idioma

La interfaz y los comentarios del código están en español (idioma por defecto
del producto según el plan). El plan deja el inglés como segundo idioma: los
textos de la interfaz deben vivir agrupados y no incrustados en la lógica, para
poder traducirlos sin tocar componentes.

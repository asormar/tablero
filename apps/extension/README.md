# Extensión de navegador de Tablero

Extensión **Manifest V3** que manda la página actual a «Sin ordenar» con el
**token personal** del usuario (`POST /api/capture` con la cabecera
`X-Capture-Token`). Sin dependencias de terceros: popup propio, service worker,
content script y un build con `tsc` + copia de estáticos.

```
apps/extension
├── manifest.json          # MV3: action, service worker (módulo), content script, permisos
├── popup.html / popup.css # interfaz del popup
├── src/
│   ├── popup.ts           # junta los datos de la pestaña, ajustes y resultado
│   ├── background.ts      # service worker: único que habla con el API
│   ├── content.ts         # extrae título, URL y selección de la página
│   ├── api.ts             # POST /api/capture y GET /api/health + composición del texto
│   ├── settings.ts        # chrome.storage.local (URL base y token)
│   ├── types.ts           # tipos y mensajes compartidos
│   └── chrome.d.ts        # tipos mínimos de las APIs de Chrome que se usan
├── scripts/
│   ├── build-assets.mjs   # copia manifiesto, popup e iconos a dist/
│   └── make-icons.mjs     # genera los PNG del icono (node:zlib, sin dependencias)
└── dist/                  # salida del build: extensión sin empaquetar (gitignoreada)
```

## Qué hace

- **Captura**: lee de la pestaña activa el **título**, la **URL** y la
  **selección de texto** (content script; si la página se abrió antes de
  instalar la extensión, se inyecta `content.js` al momento). El texto de la nota
  se compone igual que en la PWA al compartir: título, selección y URL, una línea
  cada uno y sin repetir lo que ya esté incluido.
- **Imagen opcional**: con la casilla marcada se captura la parte visible
  (`chrome.tabs.captureVisibleTab` → `dataUrl`) y se manda `type: "image"`.
- **Resultado real**: el popup muestra `Nota creada en «Sin ordenar»` con el
  tablero y el elemento creados, o el error del API tal cual, con su código.
- **Ajustes**: URL base del API y token personal en `chrome.storage.local`
  (pegar, guardar, borrar) y un botón **«Probar conexión»**.

## Build

```bash
pnpm install
pnpm --filter @tablero/extension build
```

Deja `apps/extension/dist` listo para cargar: `manifest.json`, `popup.html`,
`popup.css`, `popup.js`, `background.js`, `content.js`, `api.js`, `settings.js`,
`types.js` e `icons/` (13 archivos). Los iconos se generan solos si faltan
(`pnpm --filter @tablero/extension icons` para rehacerlos).

## Cargar la extensión sin empaquetar

1. Abrí `chrome://extensions` en Chromium/Chrome.
2. Activá **«Modo de desarrollador»** (arriba a la derecha).
3. **«Cargar descomprimida»** y elegí la carpeta `apps/extension/dist`.
4. Después de cada `build`, apretá el botón de recargar (⟳) en la tarjeta de la
   extensión y volvé a abrir el popup.

## Conseguir el token

El token personal se muestra en la web de Tablero: `GET /api/settings`
(campo `captureToken`). Se pega a mano en el popup, en **Ajustes → Token
personal**, y queda guardado en `chrome.storage.local`. No hay OAuth ni login en
la extensión: el endpoint de captura está pensado para esto.

## Uso

1. Abrí la página que querés guardar (y seleccioná el texto que te interese).
2. Clic en el icono de la extensión.
3. Revisá/ajustá **título**, **URL** y **selección**.
4. Marcá **«Adjuntar la parte visible»** si querés la imagen.
5. **«Enviar a «Sin ordenar»»**. Abajo aparece el resultado o el error.

## Ajustes y «Probar conexión»

El botón prueba en dos pasos y distingue los tres finales posibles:

| Resultado | Qué significa |
| --- | --- |
| `Conexión correcta: Token válido y API alcanzable (…404 not_found)` | El API responde y autenticó el token. El sondeo usa un `boardId` inexistente justamente para no crear nada. |
| `Token inválido: el API responde, pero rechaza el token. … (invalid_capture_token, HTTP 401)` | El API está vivo pero el token no sirve. |
| `API inalcanzable: No se pudo contactar el API en …` | No hay nada escuchando en esa URL (o la URL base está mal). |

## Límites conocidos (contrato actual del API)

- **La captura de imagen todavía no entra por `POST /api/capture`**: con
  `type: "image"` el API responde
  `400 {"error":"La captura de tipo «image» todavía no está soportada","code":"capture_unsupported_type"}`
  (lo mismo para `type: "file"`). La extensión manda igual la captura visible
  como `imageDataUrl` y, al recibir ese código, **guarda la nota** y muestra el
  error del API tal cual, sin tocar el contrato desde acá.
- **Páginas internas del navegador** (`chrome://`, `edge://`, visor de PDF, web
  store, `file://`): no se puede inyectar el content script ni capturar la
  selección. El popup lo avisa y deja completar título y URL a mano.
- El token no se sincroniza entre equipos: es el mismo token personal del API.

## Permisos

`storage` (ajustes), `tabs` y `activeTab` (leer la pestaña activa y capturar la
parte visible), `scripting` (inyectar el content script en páginas abiertas
antes de instalar la extensión) y `host_permissions: <all_urls>` (hablar con la
URL base que configure el usuario y poder capturar cualquier página).

## Verificación de punta a punta

Con una instancia propia del API (base `f6ext`, puerto 8955) y Chromium con la
extensión cargada se comprobó: captura de una página real (Wikipedia) con
título, URL y selección; `GET /api/boards/unsorted` y el documento Yjs del
tablero con la nota creada; token inválido (`invalid_capture_token`, HTTP 401) y
API inalcanzable como errores distintos; y la opción de imagen devolviendo el
400 documentado. Los pasos exactos y la salida cruda están en el informe de la
fase 6.

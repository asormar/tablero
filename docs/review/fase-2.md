# Revisión independiente — Fase 2

- **Alcance**: `git diff fase-1..HEAD` (etiqueta `fase-2`)
- **Revisor**: subagente independiente con otro modelo (`meta/muse-spark-1.3-contributor`), contexto
  distinto al que escribió el código, sin permiso de escritura sobre el repo.
- **Brief**: `docs/review/prompt.md`
- **Veredicto**: **la fase se puede dar por cerrada. Sin bloqueantes.** Tres importantes y seis
  menores para el próximo ciclo.

## Bloqueantes

Ninguno: sin inyección, XSS ejecutable, traversal, SSRF abierta, bypass de autorización ni pérdida
de datos en el camino feliz.

## Importantes

| # | Ubicación | Hallazgo | Estado |
|---|---|---|---|
| I1 | `apps/web/src/api/assets.ts:122-123` | el parseo de error de subida lee `payload.error.message` (anidado) pero la API responde `{ error: string, code }` plano: toda subida fallida muestra «Error 413/500» genérico y pierde el motivo real | **Pendiente** (ronda de arreglos siguiente) |
| I2 | `apps/web/src/elements/cards/AssetStates.tsx:50-57, 120-125` | la tarjeta en error no ofrece acción: `retryUpload` existe y funciona, pero nadie lo llama desde la UI | **Pendiente** |
| I3 | `apps/web/src/api/assets.ts:151` + `canvas/commands.ts:253-260` | `deleteAsset` no tiene llamadores: borrar una tarjeta del lienzo deja la fila `Asset` y los objetos S3 para siempre | **Pendiente** (requiere decisión de diseño: biblioteca de assets vs. borrado en cascada, y anotarla en `ARCHITECTURE.md`) |

## Menores

| # | Ubicación | Hallazgo | Estado |
|---|---|---|---|
| M1 | `apps/web/src/app/Workspace.tsx:126-128` | `ImageViewer`, `CropEditor` y `RecorderPanel` montados estáticos: chunk principal ~787 kB | **Pendiente** (`React.lazy` + `manualChunks`) |
| M2 | `apps/web/src/elements/cards/PdfPreview.tsx:75` | `PdfPageViewer` muerto (se usa el panel local) | **Pendiente** |
| M3 | `apps/web/src/lib/pdf.ts:88`, `lib/waveform.ts:115` | `forgetPdfDocument` y `forgetPeaks` sin llamadas: las cachés no se purgan al borrar tarjetas | **Pendiente** |
| M4 | `packages/shared/src/schema.ts:96` | `presignAssetSchema` muerto (la subida firmada quedó fuera de alcance a propósito) | **Pendiente** |
| M5 | `apps/api/src/lib/storage.ts:151` | `objectExists` sin uso en `src` | **Pendiente** |
| M6 | `apps/web/src/elements/cards/AssetCards.tsx:496-504` + `apps/api/src/routes/assets.ts:347-355` | «Abrir» un SVG en pestaña nueva ejecuta su `<script>` en el origen de MinIO: riesgo bajo (monousuario, en `<img>` no ejecuta) pero existe | **Pendiente** (forzar `Content-Disposition: attachment` para SVG/HTML en `/raw`) |

## Qué verificó el revisor con ejecución

`pnpm -r typecheck` limpio · `shared` 135/135 en `HEAD` · `web` 143/143 · `png build` OK con el
visor de PDF en chunk aparte (436 kB) · `smoke:assets` **24/24** con API+Postgres+MinIO levantados
(EXIF-6, vídeo con miniatura, MP3 con portada, dedupe 201/200, 413 con y sin `Content-Length`,
404 cruzado, DELETE que limpia fila y objetos) · sondas `curl` propias (subida 201, `/raw` sin
sesión 401, origen maligno 403, sin `Origin` en mutante 403) · **navegador real** (pegado de YouTube
→ `.link-card` con `iframe` y `sandbox` correctos) · escaneos estáticos del diff (sin secretos, sin
`eval`/`innerHTML`, sin `console.log` de producto, sin `TODO`).

## Qué no pudo verificar

El criterio de las 20 imágenes con progreso no lo repitió (exige archivos reales y red estrangulada);
acepta la evidencia del implementador sin darla por verificada. Render de miniatura y visor de PDF en
cliente, forma de onda audible, grabación con micrófono, cuentagotas y selector nativo (estos dos
últimos necesitan gesto humano). Tampoco re-ejecutó el rendimiento de 300 tarjetas con los tipos
nuevos.

Nota de contexto: durante la revisión el árbol tenía trabajo de la fase 3 sin commitear, así que
tests y build corrieron sobre un árbol cambiante. El alcance `fase-1..HEAD` no se vio afectado.
El objeto S3 que el revisor creyó huérfano de su sonda no está: el bucket quedó vacío (verificado).

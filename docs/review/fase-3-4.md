# Revisión independiente — Fases 3 y 4

- **Alcance**: el trabajo commiteado de las fases 3 y 4, `git diff fase-2..fase-4`
  (etiquetas `fase-2`, `fase-3`, `fase-4`; último commit revisado `34e02d2`).
- **Revisor**: modelo independiente (`meta/muse-spark-1.3-contributor`, familia
  distinta a la del implementador), sin permiso de escritura sobre el repositorio.
- **Cómo se hizo**: ocho auditorías en paralelo, cada una en un **worktree
  aislado** (`rev4`, etiqueta `fase-4`) con **su propia base** y su propio puerto,
  escribiendo su informe incrementalmente. El asistente verificó por separado
  todo lo que se afirma acá. La revisión de la fase 3 sola había muerto dos veces
  (sueño de la máquina y una pausa pedida); esta corrida por bloques sobrevivió a
  los cortes porque cada bloque dejaba su parte escrita.
- **Nota de método**: hubo un bloque (la matriz de autorización) que se colgó dos
  veces; su informe quedó terminado igual y se conserva. También se detectó y
  descartó una contaminación real: una de las bases de auditoría había recibido la
  migración de la fase 5 (`DROP TABLE Share`) y el bloque la descartó y repitió
  todo sobre una base limpia.

## Veredicto

**Apto con arreglos.** Las fases 3 y 4 hacen lo que prometen y la autorización por
tablero está sana: 15 endpoints probados con una cuenta ajena no dejan leer ni
escribir nada ajeno, y ningún camino de rechazo probado tumba el proceso. Hay **un
hallazgo alto** (la restauración de versiones no aguanta la copia local del
cliente), cinco medios y una lista de menores.

## Hallazgos

### Alta

1. **La fusión CRDT revive lo restaurado** (`apps/web`). El servidor hace bien su
   parte (cierra conexiones, vacía el debounce, escribe la instantánea y guarda un
   `pre-restore` con guardia de 8 s), pero el cliente hace `location.reload()` sin
   limpiar su copia local y `BoardSession` **fusiona** (`Y.applyUpdate`) el
   documento viejo con el restaurado: la unión revive lo borrado y el provider lo
   vuelve a subir. La ventana es la caché local (días), no los 8 s de la guardia.
   *Arreglo*: descartar el documento local del tablero antes de reconectar
   (`clearLocalDocument`) y reconstruir desde el remoto en vez de fusionar; cubrir
   también el cierre 4205. **En arreglo.**

### Medias

2. **`DELETE /api/assets/:id` borra un archivo en uso** sin comprobar
   referencias: la fila y el objeto de MinIO desaparecen y el documento queda con
   un `assetId` colgado. *Arreglo*: reutilizar `referencedAssetIds()` y responder
   409 `asset_in_use` salvo `?force=true`. *(El borrado de huérfanos, en cambio,
   **no** toca archivos en uso: probado con el asset en portada, en documento, en
   la papelera de elementos y en un tablero en la papelera.)*
3. **Instanciar una plantilla y duplicar un tablero no indexaban**: el tablero
   nuevo quedaba con 0 filas en `SearchIndex` y su contenido era invisible hasta un
   reindex manual. *Arreglado y verificado*: `reindexBoards` en los dos caminos,
   con dos tests nuevos (la suite del API pasó de 164 a 224 tests; los dos últimos
   son los del índice) y la evidencia del antes (`total: 0`) y el después.
4. **El token de captura es un `cuid()` predecible y no se puede rotar ni
   revocar.** *Arreglo*: generarlo aleatorio y agregar un endpoint de rotación.
5. **`preview.firstText` siempre `null`** en las versiones: campo declarado y
   nunca asignado. *Arreglo*: poblarlo o eliminarlo.
6. **Sockets semiabiertos sin autenticar**: un upgrade sin sesión deja el TCP
   abierto hasta el timeout de autenticación. *Arreglo*: confirmar/bajar el
   `timeout` de Hocuspocus.

### Menores

7. El texto plano exportado pierde fecha y prioridad de las tareas (el Markdown sí
   las lleva).
8. Cualquier rol con acceso (incluido lector) puede exportar el `document.state`
   completo; conviene exigir editor.
9. El `createdBy` del usuario de sistema se conserva en las copias de plantilla.
10. El 404 devuelve el id recibido sin truncar (ids de 10 000 caracteres).
11. El log de los 500 guarda el stack con rutas absolutas de la máquina.
12. Un rechazo por CSRF devuelve 403 en vez de 401 cuando falta la credencial.
13. La URL firmada de un asset expone la estructura del bucket y el id de usuario
    (aceptable, queda anotado).

## Lo que se comprobó con ejecución

- **Línea base**: `pnpm -r typecheck` limpio; `shared` 256, `api` 164, `web` 432
  tests; build de la web OK; el lockfile commiteado resuelve desde cero y el diff
  no trae basura (el único `.env*` es `.env.example`, que debe estar).
- **Búsqueda**: aislamiento correcto (la cuenta ajena no ve contenido, `boardId`
  ajeno → 404, reindex ajeno → 403, papelera fuera del alcance); reindex parcial y
  completo; `q` vacío/ausente, `limit` fuera de rango, `type` inválido y `q` de
  10 000 caracteres → 400 con el servidor vivo; los operadores de `tsquery` no
  rompen; la normalización sin diacríticos funciona en ambos sentidos; `headline`
  escapa el HTML (`&lt;<mark>script</mark>&gt;`).
- **Versionamiento**: auth cruzada sin oráculo (404 `not_found`), `pre-restore`
  reversible, la búsqueda pasa de 2 a 1 resultados tras restaurar, retención
  59 → 50 filas (50 recientes + 1/día por 30 días) y throttle de 10 minutos
  verificado.
- **Exportación**: los cuatro formatos con contenido real; el ZIP no pisa nombres
  duplicados, neutraliza `../../evil.png` → `assets/1--..-evil.png`, y el archivo
  sale byte a byte idéntico al de MinIO con CRC válido; streaming real para
  binarios; `account.json` con lo que promete; `?format=docx` → 400 y servidor vivo.
- **Plantillas y captura**: doble instanciación sin duplicar ni ensuciar al usuario
  de sistema; las tarjetas de tablero de la copia apuntan a las copias; el token de
  otra cuenta escribe en **su** bandeja; `boardId` ajeno → 404; `Origin: evil` con
  cabecera de token → 201 (no explotable cross-site: lo impiden CORS y el
  preflight; el token en el cuerpo con `Origin` ajeno → 403).
- **Ajustes y almacenamiento**: defaults completos, `PATCH` mixto atómico, tipos
  raros con detalle por campo, `usedBytes` cuadra con la suma de los assets.
- **Autorización (15 endpoints de las fases 3 y 4)**: ninguno sin comprobar
  propiedad; `parentBoardId` ajeno, mover/duplicar/borrar/renombrar/favoritear lo
  ajeno, papelera, bandeja, tareas y documento → todos 404 sin revelar existencia;
  ids malformados (`'`, `../../`, uuid, vacío, 5 000 caracteres) → 400/404, ningún
  500.
- **Resistencia y filtración**: cero caídas tras upgrades rechazados por `Origin`,
  ráfagas, JSON malformado y de 5 MB, multipart corrupto, ids con NUL y traversal,
  login inexistente; sin emails ajenos, secretos, hashes, tokens ni rutas en las
  respuestas; 500 sin stack para el cliente; sin cabecera `Server`.
- **Los cuatro puntos abiertos de la fase 3**: el doble clic **sí** abre el
  tablero anidado (lo rescata el fallback geométrico incluso si el DOM se recrea
  entre los dos clics); el arrastre de filas de tarea mueve en los tres puntos
  (fila hermana, hueco inferior y sangrado como subtarea); los cuatro paneles
  abren con datos reales y sus seis acciones funcionan; al vaciar la papelera el
  asset se libera con conteo de referencias (aguanta hasta que cae la última
  copia).

## Lo que no se pudo verificar

- Edición real por WebSocket contra la guardia de 8 s de la restauración (se leyó
  el mecanismo en el código y se reprodujo el efecto por el camino del cliente,
  pero no con un cliente WS propio conectado en el momento exacto).
- Restaurar con el tablero en la papelera (la ruta no mira `trashedAt`: posible
  inconsistencia, sin reproducir).
- La guardia de restauración es un `Map` por proceso: con más de una instancia del
  API no está coordinada.
- `POST /api/templates/from-board/:id`, el rate-limit y la rotación del token de
  captura (no existen todavía).
- Compartir tableros con roles: es fase 5, no existe en la etiqueta revisada.
- Concurrencia en el borrado de huérfanos y documentos Yjs corruptos.

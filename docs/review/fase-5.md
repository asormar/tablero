# Revisión independiente — Fase 5 (colaboración)

- **Alcance**: el trabajo commiteado de la fase 5, `git diff fase-4..fase-5`
  (etiqueta `fase-5`, commit `f6d9a2c`).
- **Revisor**: modelo independiente (`meta/muse-spark-1.3-contributor`, familia
  distinta a la del implementador), sin permiso de escritura sobre el repositorio.
- **Cómo se hizo**: cuatro auditorías en paralelo sobre un **worktree aislado**
  (`rev5`, en la etiqueta) con sus propias bases (`rev5b/c/d`) y puertos, cada una
  escribiendo su informe incrementalmente. El asistente verificó por separado todo
  lo que se afirma acá (typecheck, las tres suites, build, los seis humos, la
  publicación y los permisos reproducidos en el navegador).

## Veredicto

**Apto con arreglos.** La colaboración hace lo que promete y el modelo de permisos
está bien construido: **ninguno** de los endpoints nuevos deja leer o escribir sin
permiso, la herencia y la sobrescritura en subtableros funcionan, la publicación no
filtra datos y la ruta pública no permite escribir. Los hallazgos son de forma y de
casos de borde; hay uno funcional que importa (el rol comentarista no puede
comentar) y uno de arranque limpio (`typecheck` sin `prisma generate`).

## Hallazgos

### Importantes

1. **El rol comentarista no tiene forma de comentar.** El socket descarta todos los
   updates de quien no tiene `canEdit`, y no hay endpoint para escribir
   comentarios: los comentarios viven en el documento (`doc.getMap('comments')`) y
   solo se pueden crear con permiso de edición. Es decir: el rol existe, se elige
   en la interfaz y no sirve para lo único que promete. *Arreglo*: aceptar en el
   servidor los updates que solo tocan `comments` de un comentarista (filtrando
   por tipo de cambio) o exponer un `POST /api/boards/:id/comments` que escriba en
   el documento con permiso `comment`.
2. **`pnpm -r typecheck` falla en un checkout limpio** (45 errores) porque nada
   ejecuta `prisma generate`: no hay `postinstall` y el diff no toca ningún
   pipeline de CI. *Arreglo*: `"postinstall": "pnpm --filter @tablero/api exec
   prisma generate"` en la raíz (o un `pretest`) y documentarlo en el README.

### Medias

3. **Un comentario huérfano sobrevive**: `syncBoardComments` no valida el
   `elementId` contra el documento (a diferencia de `recordActivity`), así que un
   comentario anclado a una tarjeta borrada queda en el listado apuntando a nada.
   *Arreglo*: dejar el `elementId` en `null` (chincheta libre) o excluir la fila.
4. **`GET /api/invitations/:token` exige sesión** aunque el contrato lo documenta
   como público («el token es la credencial»): el invitado sin cuenta no puede
   previsualizar la invitación. *Arreglo*: quitar el requisito de sesión en esa
   ruta, o corregir el contrato y documentar que hay que registrarse antes.
5. **500 con `authorId` inválido** en la sincronización de comentarios: un
   documento con un comentario cuyo autor no existe tumba la petición. *Arreglo*:
   validar/ignorar autores desconocidos al extraer, sin lanzar.

### Menores

6. El `meta.dueDate` de la notificación de tarea vencida guarda **hoy**, no el
   vencimiento real.
7. Las menciones no resuelven por palabra del nombre cuando este tiene prefijo
   («D Caro» con `@Caro`).
8. El esquema de actividad no acepta `elementType: "sticky"` aunque el documento
   guarda elementos de ese tipo.
9. `PATCH /api/members` informa `connectionsClosed: 0` aunque el cierre de la
   conexión sí ocurre.
10. `POST /api/boards/:id/publish` distingue 403 (miembro no dueño) de 404 (ajeno),
    lo que revela la existencia del tablero a un miembro.
11. El 401 de la vista pública con contraseña confirma la existencia del slug
    (riesgo bajo: el slug tiene ~70 bits).
12. El dueño puede invitarse a sí mismo (crea una invitación basura; aceptarla
    devuelve `alreadyMember`).
13. `ARCHITECTURE.md` dice que el cierre al expulsar usa el código «4409»; el real
    es **4403** (consistente en código, tests, humo y cliente).
14. `assigneeId` (P2) no quedó documentado como pendiente, aunque el barrido de
    vencidas lo consume.
15. `phase5.css` son 1121 líneas en un archivo (mantenibilidad).
16. Los 400 de validación enumeran los valores internos válidos (informativo).

## Lo que se comprobó con ejecución

- **Línea base**: typecheck, `shared` 268, `api` 224, `web` 532 y build en verde;
  sin basura commiteada; los tests nuevos cubren el contrato de la fase.
- **Permisos**: lector → 403 `forbidden_role` al escribir por REST y update
  descartado por el socket (el documento del servidor no cambia); comentarista →
  no edita, resuelve hilos, no borra los ajenos; editor → escribe por los dos
  caminos; herencia padre→hijo y sobrescritura por fila propia (renombrar el hijo
  da 403 con rol lector en el hijo y 200 en el padre); cambio de rol en vivo →
  cierre real con **4403** y reconexión con el permiso nuevo.
- **IDOR**: con la sesión de otra cuenta, todos los endpoints nuevos responden 404
  sin revelar existencia; **ningún endpoint sin comprobar permiso**.
- **Publicación**: slug de 12 caracteres base58 aleatorio (y la rotación invalida
  el anterior); `state` en el nivel superior; subtableros con slug compuesto
  `<raíz>~<idHijo>`; sin fugas (ni emails, ni miembros, ni tokens, ni rutas del
  sistema; el Yjs va saneado y los assets con HMAC de 15 minutos); escribir desde
  la ruta pública es imposible (REST 401/404 y el WS exige sesión);
  `noindex, nofollow, noarchive` y `no-store`; contraseña con argon2id y límite de
  20 intentos por minuto (429 temporal que se recupera); al despublicar la ruta da
  404 y se borra el hash.
- **Invitaciones**: validación, idempotencia, orden correcto de comprobaciones
  (miembro, caducada, ya aceptada, otro email), solo el dueño puede invitar
  (un editor recibe 403 y un ajeno 404) y el email de desarrollo solo se escribe en
  el log.
- **Comentarios, notificaciones, actividad y presencia**: extracción desde el
  documento con hilos, resolver y borrar; menciones que notifican sin duplicar al
  editar; `unread` en el nivel superior y marcado de una o de todas; validación de
  lotes de actividad y paginado por cursor; presencia con la ventana de 60 s.

## Lo que no se pudo verificar

- El WebSocket anónimo de la vista pública (solo lectura de código: la ruta exige
  sesión).
- El upsert de rol al aceptar una invitación siendo ya miembro (solo código).
- Los assets públicos con un archivo real (no se subió ninguno).
- El límite de intentos de contraseña **bajo carga** (funciona; no se midió el
  comportamiento con muchos clientes).
- La ventana de presencia en tiempo real y la deduplicación de la notificación de
  vencidas cruzando medianoche (verificadas por código y tests, no en vivo).
- Concurrencia: dos sockets escribiendo comentarios a la vez.

## Resolución (arreglos posteriores)

Aplicada por otro agente, sin commits en este paso; cada punto con su test.

| # | Arreglo |
| --- | --- |
| 1 | **El comentarista comenta por el socket.** `beforeHandleMessage` filtra por **tipo de cambio** (`apps/api/src/collab/comment-writes.ts`): un update que solo toca `doc.getMap('comments')` se aplica ahí mismo y el resto de los updates se descarta. El update se aplica en el hook (no con `readOnly = false`: el flag es estado de la conexión y dos mensajes seguidos del cliente —los dos de `addComment`— se pisaban). Tests en `collab/comment-writes.test.ts` y `collab/server.test.ts`; pasos nuevos en `smoke:colaboracion` (comentarista comenta y no edita; el lector no comenta). |
| 2 | **`postinstall` de la raíz** (`prisma generate`) y nota en el README. Comprobado en un checkout limpio: `pnpm install` + `pnpm -r typecheck` en verde (sin el cliente generado: 48 errores). |
| 3 | **Comentarios huérfanos**: `elementId` se valida contra el documento; si el ancla no existe queda en `null` (chincheta libre, el comentario no se pierde). Contrato documentado en `lib/comments.ts` y en `ARCHITECTURE.md`. |
| 4 | **`GET /api/invitations/:token` es público**: ruta movida a su propio plugin fuera del scope con sesión (registrada en `routes/index.ts`) y test contra el registro real (`routes/public-invitation.test.ts`). |
| 5 | **Autor inexistente en la sincronización**: se ignora (y también una respuesta sin su hilo padre) en vez de tumbar la petición; test en `routes/comments.test.ts`. |
| 6 | `meta.dueDate` guarda el vencimiento real (`today` queda solo en la `dedupeKey`); `elementType` de actividad acepta cualquier tipo del documento (ya no rechaza `sticky`); el cambio de rol/expulsión cierra (y cuenta) las conexiones del afectado **en todo el subárbol**; publicar responde 404 a cualquier no-dueño; el dueño no puede invitarse (409 `already_owner`); las menciones resuelven por cualquier palabra del nombre; `ARCHITECTURE.md` dice 4403 (no 4409). |

Quedan sin tocar los hallazgos 11 (el 401 de la vista pública con contraseña
confirma el slug), 14 (`assigneeId` sin documentar), 15 (`phase5.css` de 1121
líneas) y 16 (los 400 enumeran valores válidos): no estaban en el alcance de esta
ronda de arreglos.

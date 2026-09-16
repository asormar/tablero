# Revisión independiente — Fase 1

- **Alcance**: `git diff <commit inicial>..fase-1`
- **Revisor**: subagente independiente con otro modelo (`meta/muse-spark-1.3-contributor`), contexto
  distinto al que escribió el código, sin permiso de escritura sobre el repo.
- **Brief**: `docs/review/prompt.md`
- **Veredicto**: fase funcionalmente sólida y bien arquitecturada, **no dar por cerrada** hasta
  corregir la creación de raíces múltiples por API.

## Bloqueantes

| # | Ubicación | Hallazgo | Estado |
|---|---|---|---|
| B1 | `apps/api/src/routes/boards.ts:213-232` | `POST /boards/:id/move` con `parentBoardId: null` crea una segunda raíz; después no se puede borrar (`cannot_trash_root`) | **Arreglado** en `deleg_c3e44390` |
| B2 | `apps/api/src/routes/boards.ts:239-266` | `POST /boards/:id/duplicate` de la raíz copia `parentBoardId: null` → segunda raíz | **Arreglado** en `deleg_c3e44390` |
| B3 | `packages/shared/src/boards.ts:87-91` | `canMoveBoard` devuelve `true` con `targetId === null` (la política errónea vive en la fuente de verdad) | **Arreglado** en `deleg_c3e44390` |

Los tres son el mismo defecto por tres puertas: solo el registro puede crear raíces.

## Importantes

| # | Ubicación | Hallazgo | Estado |
|---|---|---|---|
| I1 | `apps/api/src/collab/server.ts:52-65` | `onAuthenticate` no mira `trashedAt`: un tablero en papelera sigue sincronizando y editable por WebSocket mientras el REST lo rechaza | **Arreglado** en `deleg_c3e44390` |
| I2 | `apps/api/src/lib/link-preview.ts:59-75, 184-207` | SSRF con TOCTOU (la validación resuelve DNS y el `fetch` vuelve a resolver → rebind) y formas no canónicas de loopback que `isIP` no cubre | **Arreglado** en `deleg_c3e44390` |
| I3 | `apps/api/src/routes/boards.ts:163-166` | `PATCH /boards/:id` acepta `settings` y lo descarta con 200 | **Arreglado** en `deleg_c3e44390` |

## Menores

| # | Ubicación | Hallazgo | Estado |
|---|---|---|---|
| M1 | `apps/api/src/seed.ts:15, 28` | imprime la contraseña del usuario demo | **Arreglado** en `deleg_c3e44390` |
| M2 | `apps/api/src/app.ts:35-50, 142` + `collab/server.ts:103-106` | el upgrade del WebSocket no valida `Origin` | **Arreglado** en `deleg_c3e44390` |
| M3 | — | Backend adelantado sin UI (`link-preview`, `Template`, `GET /tasks`) | Sin acción: es superficie de fases siguientes, no un defecto |
| M4 | `apps/web/dist` | chunk principal por encima de 500 kB | Sin acción en fase 1; se vigila en cada build |

## Qué verificó el revisor con ejecución

`pnpm -r typecheck` (con `prisma:generate` previo) · `pnpm -r test` (99 shared + 69 web) ·
`pnpm --filter @tablero/web build` · `smoke-rest.sh` contra una instancia propia en :8791 con base
aparte (26/26) · `smoke:collab` (11/11) · sondas `curl` que **reprodujeron los bugs B1, B2 e I3** ·
escaneos estáticos (sin secretos, sin `innerHTML`, sin `eval`, sin `.env` versionado).

## Qué no pudo verificar

Interfaz en navegador real (doble clic, migas, 302 tarjetas a 60 fps, deshacer visual): no levantó
navegador; los claims de rendimiento y UX del README quedan como declarados. Esos criterios sí se
verificaron por el agente principal en la misma fase (navegador por CDP, `localStorage` borrado,
medición de FPS con la pestaña al frente).

# Despliegue de Tablero

Cómo publicar Tablero en una VM gratuita de Oracle Cloud para usarlo desde
cualquier dispositivo, con los archivos y las copias de seguridad en
Cloudflare R2. Coste: cero.

## Cómo queda

```
Internet ──HTTPS──> Caddy (VM, 80/443)
                      ├── /            → SPA (dist/ de Vite)
                      ├── /api/*       → Fastify :8787
                      └── /collab      → Hocuspocus :8787 (WebSocket)

VM (Oracle Ampere A1, 2 OCPU / 12 GB, Ubuntu 24.04)
  ├── Caddy        TLS automático (Let's Encrypt, desafío HTTP-01)
  ├── API          Fastify + Hocuspocus + Prisma
  ├── PostgreSQL   16
  └── ballast      lastre de memoria contra el reclamo por inactividad

Cloudflare R2      archivos + copias de seguridad (10 GB gratis, egreso gratis)
```

Todo en **un mismo origen** a propósito: la cookie de sesión es httpOnly y la
guarda CSRF de la API exige que el `Origin` coincida con `APP_ORIGIN`
(`apps/api/src/app.ts`). Separar la web y la API en dominios distintos rompe
las dos cosas.

## Resumen rápido

Una vez creadas la VM, la lista de seguridad, el subdominio y el bucket:

```bash
# En la VM, como usuario ubuntu
git clone https://github.com/asormar/tablero.git ~/tablero
bash ~/tablero/docker/provision.sh          # Docker, iptables, .env.prod, cron
# cerrar la sesión SSH y volver a entrar (grupo docker)
~/tablero/docker/deploy.sh --no-pull        # construye y levanta
docker compose -f ~/tablero/docker/docker-compose.prod.yml --env-file ~/tablero/docker/.env.prod \
  run --rm api ./apps/api/node_modules/.bin/tsx apps/api/scripts/r2-setup.ts   # CORS + caducidad
```

El resto del documento explica cada paso.

## 1. La VM en Oracle Cloud

Cree una instancia **Always Free**:

- **Shape**: `VM.Standard.A1.Flex` (ARM), **2 OCPU y 12 GB** de memoria.
- **Imagen**: Ubuntu 24.04.
- **Boot volume**: 50 GB.
- **Clave SSH**: suba la suya (la consola ofrece generar una; guarde la privada).
- **IP pública**: asignada automáticamente. Conviene que sea **reservada**
  (Networking → Reserved public IPs) para que no cambie si se recrea la VM.

Dos avisos que casi toda documentación vieja dice mal:

- **No son 4 OCPU / 24 GB.** Oracle bajó la cuota a la mitad; la documentación
  oficial dice "the first 1,500 OCPU hours and 9,000 GB hours per month... For
  Always Free tenancies, this is equivalent to 2 OCPUs and 12 GB of memory".
  Pedir más no se puede, aunque la consola todavía muestre el banner viejo.
- **Capacidad**: los errores "out of host capacity" son comunes en las regiones
  populares. Pruebe otra *availability domain*, otra región, o espere.

Sobre el reclamo por inactividad, vea [el apartado 9](#9-evitar-el-reclamo-por-inactividad).

## 2. La lista de seguridad de la VCN

Oracle filtra el tráfico dos veces: en la **VCN** (esto) y en el **cortafuegos
de la propia VM** (lo hace `provision.sh`). Hacen falta las dos.

En la consola: **Networking → Virtual Cloud Networks → su VCN → Security →
Security Lists → Default Security List → Add Ingress Rules**. Tres reglas,
todas con *Source CIDR* `0.0.0.0/0`:

| Protocolo | Puerto de destino | Para qué |
| --- | --- | --- |
| TCP | 80 | Desafío HTTP-01 de Let's Encrypt y redirección a HTTPS |
| TCP | 443 | HTTPS y WebSocket de colaboración |
| UDP | 443 | HTTP/3 (opcional, pero el compose ya lo publica) |

El puerto 22 (SSH) ya viene abierto. La base de datos y la API **no** se
publican: sólo hablan por la red interna de Docker.

## 3. El dominio

Sin dominio propio, un **subdominio de DuckDNS** (gratis) alcanza:

1. Cree el subdominio en <https://www.duckdns.org> y apúntelo a la IP pública
   de la VM.
2. El TLS lo pide Caddy con el desafío HTTP-01 normal, porque la VM tiene IP
   pública y los puertos 80/443 abiertos. No hace falta el módulo de DuckDNS.

Compruebe que resuelve antes de desplegar: `nslookup mi-tablero.duckdns.org`.
Si más adelante compra un dominio, sólo cambia `SITE_ADDRESS`.

## 4. El bucket en Cloudflare R2

En <https://dash.cloudflare.com> → **Storage & Databases → R2 → Create bucket**
(por ejemplo `tablero`). Después, **Manage R2 API Tokens → Create API token →
Object Read & Write** limitado a ese bucket, y anote el *Account ID*, el
*Access Key ID* y el *Secret Access Key*.

El bucket **puede y debe quedar privado**: la API entrega al navegador URLs
firmadas de 15 minutos (`apps/api/src/lib/storage.ts`), así que es la firma la
que da acceso, no el bucket. Por eso no hace falta un dominio público extra.

R2 no acepta `CreateBucket` por la API S3, así que `ensureBucket()` sólo
verifica que exista y avisa si falta: el bucket se crea desde el panel.

**Límites del plan gratuito de R2**: 10 GB de almacenamiento, 1 millón de
operaciones de escritura (clase A) y 10 millones de lectura (clase B) al mes, y
**egreso gratuito** (no se paga por descargar). Las copias de seguridad cuentan
dentro de esos 10 GB. `MAX_UPLOAD_MB` se queda en **500**: es el tope por
archivo, no el espacio total; si el almacenamiento va justo, bájelo en
`docker/.env.prod`.

## 5. Aprovisionar la VM (`provision.sh`)

Conéctese por SSH como `ubuntu` y ejecute:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/asormar/tablero.git ~/tablero
bash ~/tablero/docker/provision.sh            # o con otra URL: ... provision.sh https://github.com/usuario/fork.git
```

Se ejecuta **una vez**, pero es idempotente (repetirlo no duplica nada). Hace:

1. Instala **Docker Engine** y el plugin de **Compose** desde el repositorio apt
   oficial de Docker (arm64) y añade al usuario al grupo `docker`.
2. Activa `unattended-upgrades` (parches de seguridad automáticos; no reinician
   la VM solos, así que de vez en cuando revise `/var/run/reboot-required`).
3. Abre **80/tcp, 443/tcp y 443/udp en iptables** *antes* de la regla `REJECT`
   que traen las imágenes de Oracle en `/etc/iptables/rules.v4`, y lo persiste.
4. Clona o actualiza el repositorio en `~/tablero`.
5. Crea `docker/.env.prod` si falta: genera `SESSION_SECRET` y
   `POSTGRES_PASSWORD` (sin mostrarlos), pregunta el dominio, el correo de
   Let's Encrypt y las credenciales de R2, y deja el archivo en modo `600`.
   Si pulsa Intro en una pregunta, el valor queda como en la plantilla:
   edítelo luego con `nano ~/tablero/docker/.env.prod`.
6. Instala el cron de la copia de seguridad (todos los días a las 03:30).

Al terminar, **cierre la sesión SSH y vuelva a entrar** para que el grupo
`docker` tenga efecto. Sólo el compose necesita `docker/.env.prod`; el archivo
no se versiona.

## 6. Desplegar (`deploy.sh`)

```bash
~/tablero/docker/deploy.sh             # git pull --ff-only + build + up
~/tablero/docker/deploy.sh --no-pull   # sin tocar el repositorio
```

Ejecuta `docker compose ... up -d --build`, espera hasta 180 s a que responda
`https://$SITE_ADDRESS/api/health` (si el dominio aún no resuelve pero la API
responde por dentro, lo avisa y termina bien) y muestra `docker compose ps`.
Si la API no arranca, imprime las últimas 80 líneas de los registros de `api` y
`web` y sale con error.

La primera vez tarda: compila la imagen de la API con `ffmpeg` y el cliente de
Prisma, la de la web con el build de Vite y la del lastre. Las migraciones se
aplican solas en cada arranque (`prisma migrate deploy`). Para mirar a mano:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod ps
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod logs -f api
curl -s https://su-dominio/api/health
```

## 7. Configurar R2: CORS y caducidad (`r2-setup.ts`)

La web lee las URL firmadas de R2 **desde otro origen**: pdf.js con
`withCredentials`, `fetch` para la forma de onda de audio e imágenes con
`crossOrigin='anonymous'` para la paleta de color. Sin cabeceras CORS en el
bucket, el navegador bloquea las tres. El script lo configura, además de la
caducidad de las copias de seguridad:

```bash
cd ~/tablero
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  run --rm api ./apps/api/node_modules/.bin/tsx apps/api/scripts/r2-setup.ts
```

Qué hace (es idempotente, se puede repetir):

1. Comprueba que el bucket existe (`HeadBucket`).
2. Aplica CORS: `GET`/`HEAD` desde `APP_ORIGIN` (cabeceras `*`, expone `ETag`,
   `Content-Length`, `Content-Type`, `Content-Range` y `Accept-Ranges`,
   `MaxAge` 3600 s).
3. Crea la regla de ciclo de vida que borra el prefijo `backups/` a los
   `BACKUP_RETENTION_DAYS` días (14 por defecto; si lo cambia en `.env.prod`,
   vuelva a ejecutar el script). Conserva las demás reglas del bucket.

**Permisos del token.** Un token de R2 de *Object Read & Write* probablemente
no pueda cambiar la configuración del bucket (el script lo dirá con un
`AccessDenied`). Dos salidas:

- Cree un token temporal de *Admin Read & Write* y páselo sólo a este comando,
  sin guardarlo en `.env.prod`:

  ```bash
  docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
    run --rm -e R2_ADMIN_ACCESS_KEY_ID=... -e R2_ADMIN_SECRET_ACCESS_KEY=... \
    api ./apps/api/node_modules/.bin/tsx apps/api/scripts/r2-setup.ts
  ```

  Después, revoque el token temporal.
- O configúrelo a mano en el panel: bucket → **Settings → CORS Policy** (pegue
  el mismo JSON: origen `https://su-dominio`, métodos `GET` y `HEAD`) y
  **Object lifecycle rules → Add rule** (prefijo `backups/`, borrar tras 14 días).

### Comprobar CORS (hay que verificarlo en la VM real)

Las peticiones con credenciales (`withCredentials`) exigen que la respuesta de
R2 lleve el origen exacto en `Access-Control-Allow-Origin` **y**
`Access-Control-Allow-Credentials: true`. Que R2 lo devuelva en todos los casos
no está verificado desde aquí, así que pruébelo:

1. Abra Tablero con sesión iniciada, suba un PDF y una imagen a un tablero.
2. Abra las herramientas de desarrollo (F12) → **Network**, y abra el PDF.
   Busque la petición a `*.r2.cloudflarestorage.com` (la API responde `302` a
   una URL firmada). Debe verse `200`/`206` y, en las cabeceras de respuesta,
   `access-control-allow-origin: https://su-dominio`.
3. Desde cualquier terminal, con una URL firmada copiada de esa petición (caduca
   a los 15 minutos):

   ```bash
   curl -sI -H "Origin: https://su-dominio" "URL_FIRMADA" | grep -i '^access-control'
   ```

   Esperado: `access-control-allow-origin: https://su-dominio` y, para el PDF,
   `access-control-allow-credentials: true`.
4. Si el PDF falla con un error CORS en la consola pero las imágenes y el audio
   cargan, el motivo es `Access-Control-Allow-Credentials`. Hay dos salidas: sacar
   `withCredentials: true` de `getDocument` en `apps/web/src/lib/pdf.ts` (la URL
   ya está firmada, no necesita cookies), o servir R2 por un dominio propio con una
   regla de transformación de cabeceras en Cloudflare.

## 8. Cambiar de versión

```bash
~/tablero/docker/deploy.sh
```

Hace el `git pull --ff-only`, reconstruye lo que cambió y espera a la sonda de
salud. Las migraciones de la base se aplican en el arranque de la API. Si el
pull falla por cambios locales en el repositorio, resuélvalos (`git status`) o
use `--no-pull`.

## 9. Evitar el reclamo por inactividad

Según la documentación de Oracle ([Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)),
Oracle considera ociosa una instancia Always Free —y puede reclamarla— si
**durante un periodo de 7 días se cumplen las tres condiciones**:

- el percentil 95 de utilización de **CPU** es inferior al 20%,
- la utilización de **red** es inferior al 20%, y
- la utilización de **memoria** es inferior al 20% (esta última sólo se aplica
  a las formas A1).

Como hacen falta las tres a la vez, basta con mantener **una** por encima del
20%. La CPU y la red son difíciles de sostener sin gastar de verdad; la memoria
es fácil: el 20% de 12 GB son unos **2,4 GB**.

Por eso el compose incluye el servicio **`ballast`** (`docker/Dockerfile.ballast`
y `docker/ballast.py`): reserva `BALLAST_MB` de memoria (3000 por defecto), la
escribe una sola vez y se queda dormido. Después no gasta CPU ni red; sólo
ocupa RAM. Sólo el lastre ya aporta ~25% de los 12 GB; con PostgreSQL, la API y
el sistema la memoria usada queda claramente por encima del umbral.

- `restart: unless-stopped`, límite de memoria `BALLAST_LIMIT_MB` (3200 por
  defecto, unos MB por encima del lastre) y `oom_score_adj` alto: si la VM se
  quedara corta de memoria, el kernel sacrificaría antes el lastre que la base
  de datos.
- Para **desactivarlo**: `BALLAST_MB=0` en `docker/.env.prod` y
  `docker compose ... up -d` (el contenedor queda dormido sin reservar nada).
  Para cambiar el tamaño, ajuste `BALLAST_MB` (y `BALLAST_LIMIT_MB` si pasa de
  ~3100); si el límite se queda corto, el script se recorta solo y lo avisa en
  `docker logs tablero-ballast`.
- PostgreSQL arranca con `shared_buffers=1GB` y `effective_cache_size=4GB`
  (ver `docker/docker-compose.prod.yml`): también cuenta como memoria usada.

El antiguo cron de `curl /api/health` cada 17 minutos **ya no hace falta**: casi
no mueve la CPU ni la red, que es lo único que movía.

### Comprobar la métrica de memoria

Después de desplegar (la métrica tarda unos minutos en aparecer):

1. En la consola de Oracle: **Compute → Instances → su instancia → Monitoring**
   (pestaña *Metrics*).
2. Busque el gráfico **Memory Utilization**. Debe marcar por encima del 20%
   (esperado: 25–35%). Si el gráfico no aparece, el plugin *Compute Instance
   Monitoring* del Oracle Cloud Agent no está activo: en la instancia,
   **Oracle Cloud Agent** → activar *Compute Instance Monitoring*.
3. Dentro de la VM: `free -m` (la columna *used* debe ser de al menos 3 GB) y
   `docker stats --no-stream` (el contenedor `tablero-ballast` ocupa ~3 GB y
   cerca de 0% de CPU).
4. Una vez al mes, mire el percentil 95 de los últimos 7 días en esas mismas
   métricas.

Alternativa más drástica: pasar la cuenta a *Pay As You Go* (los recursos
Always Free siguen sin coste mientras se respeten sus límites). Muchos usuarios
cuentan que así no se reclaman las instancias, pero no está verificado en la
documentación oficial y exige tener una tarjeta asociada; compruébelo antes
de apoyarse en ello.

## 10. Copias de seguridad y restauración

La base es lo único irreemplazable (R2 y el resto se regeneran).

**Automático.** `provision.sh` instala un cron que ejecuta `docker/backup.sh`
todos los días a las 03:30 (hora de la VM, UTC por defecto):

```cron
30 3 * * * /home/ubuntu/tablero/docker/backup.sh >> $HOME/tablero-backup.log 2>&1 # tablero-backup
```

El script hace `pg_dump` dentro del contenedor `tablero-postgres`, lo comprime,
comprueba que el `gzip` es válido y lo sube al **mismo bucket de R2** como
`backups/tablero-AAAA-MM-DD-HHMM.sql.gz` (con la imagen oficial `amazon/aws-cli`,
que es multi-arquitectura). Si algo falla sale con código distinto de cero y
un mensaje. Las credenciales salen de `docker/.env.prod`.

**Retención.** No la aplica el script, sino la regla de ciclo de vida de R2 que
crea `r2-setup.ts` (apartado 7): borra `backups/` pasados `BACKUP_RETENTION_DAYS`
días (14 por defecto). Hasta que ejecute `r2-setup.ts`, las copias se acumulan.

**Probar a mano.**

```bash
~/tablero/docker/backup.sh
tail ~/tablero-backup.log
```

**Restaurar.** `docker/restore.sh` baja una copia de R2 y la restaura en el
PostgreSQL en marcha, **reemplazando los datos actuales**:

```bash
~/tablero/docker/restore.sh --list                          # copias disponibles
~/tablero/docker/restore.sh                                 # la más reciente
~/tablero/docker/restore.sh tablero-2026-01-31-0330.sql.gz  # una concreta
```

Pide confirmación (hay que escribir el nombre de la base; `--yes` la omite),
detiene la API mientras restaura, restaura en una sola transacción (un fallo
deja la base como estaba) y arranca la API de nuevo. **Pruebe una restauración
al menos una vez** antes de necesitarla: lo más seguro es hacerlo en otra VM o
en un entorno local con el mismo `docker/.env.prod`. `restore.sh` ya descarga la
copia y comprueba con `gzip -t` que no está corrupta antes de tocar nada.

Las copias viven en R2 —otra infraestructura distinta de la VM—, de modo que
si Oracle reclama la instancia se recupera todo con una VM nueva: repita los
apartados 5 y 6 y ejecute `restore.sh`.

## 11. Solución de problemas

**No llega nadie a la web (timeout).** Compruebe, en este orden:

1. La *Security List* de la VCN tiene las reglas de entrada del apartado 2.
2. `sudo iptables -L INPUT -n --line-numbers`: las reglas `ACCEPT` de 80 y 443
   deben estar **antes** de la regla `REJECT`. Si falta alguna, vuelva a
   ejecutar `provision.sh`. (Los puertos que publica Docker suelen saltarse la
   cadena `INPUT`, así que si ya había funcionado antes, lo más probable es la
   VCN.)
3. `docker compose ... ps`: `web` debe estar `Up` y publicar `0.0.0.0:80->80` y
   `0.0.0.0:443->443`.

**Caddy no obtiene el certificado.** Mire `docker compose ... logs web`. Causas
habituales: el DNS aún no apunta a la IP de la VM (`nslookup`), el puerto 80
está cerrado en la VCN o en iptables (Let's Encrypt entra por el 80), o se
alcanzó el límite de tasa de Let's Encrypt (5 certificados duplicados por
semana). El volumen `tablero-caddy-data` guarda el certificado: **no lo borre**
ni ejecute `docker compose down -v`, o Caddy pedirá uno nuevo y agotará el
límite. Si ya se agotó, espere o pruebe unas horas con otro subdominio.

**`/api/health` responde por dentro pero no por HTTPS.** `deploy.sh` lo
avisa. Es DNS, VCN o certificado (los dos puntos anteriores).

**Comprobar que el WebSocket de colaboración funciona.** Abra un tablero con
las herramientas de desarrollo → **Network → WS**: debe aparecer `collab` con
estado `101 Switching Protocols` y mensajes fluyendo. Si queda en `pending` o
falla, mire `docker compose ... logs api web`. Abra el mismo tablero en dos
pestañas o dos dispositivos y compruebe que los cambios se ven en ambas.

**Cabeceras y caché.** `curl -sI https://su-dominio/` debe mostrar
`cache-control: no-cache` y las cabeceras de seguridad; un archivo de
`/assets/` debe llevar `cache-control: public, max-age=31536000, immutable`.
Si tras un despliegue el navegador sigue con la versión antigua, el service
worker se actualiza solo al recargar (`skipWaiting`); fuerce con Ctrl+Shift+R.

**IP del cliente.** Caddy ≥ 2.5 (la imagen es `caddy:2.8`) ignora el
`X-Forwarded-For` que mande el cliente y lo sustituye por la IP real de la
conexión, salvo que se configure `trusted_proxies`. Así, `trustProxy: true` de
la API ve la IP verdadera (la usan el límite de peticiones y los registros) y
nadie puede falsearla.

**La base no arranca tras cambiar `POSTGRES_PASSWORD`.** La contraseña sólo se
aplica al crear el volumen. Para cambiarla en una base ya creada: `docker exec
-it tablero-postgres psql -U tablero -c "ALTER USER tablero PASSWORD '...'"` y
actualice `.env.prod`.

**Poca memoria o `ballast` reiniciándose.** `docker logs tablero-ballast`.
Reduzca `BALLAST_MB` (con 0 se desactiva) o suba `BALLAST_LIMIT_MB`.

## Desarrollo local

`docker/docker-compose.yml` (Postgres + MinIO) y `pnpm dev` siguen siendo el
camino de trabajo diario. MinIO en local, R2 en producción: lo único que los
distingue es la configuración de S3 (`S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`), así que el código es el mismo.

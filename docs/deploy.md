# Despliegue de Tablero

Cómo publicar Tablero en una VM gratuita de Oracle Cloud para usarlo desde
cualquier dispositivo, con los archivos en Cloudflare R2.

## Cómo queda

```
Internet ──HTTPS──> Caddy (VM, 80/443)
                      ├── /            → SPA (dist/ de Vite)
                      ├── /api/*       → Fastify :8787
                      └── /collab      → Hocuspocus :8787 (WebSocket)

VM (Oracle Ampere A1, 2 OCPU / 12 GB)
  ├── Caddy        TLS automático
  ├── API          Fastify + Hocuspocus + Prisma
  └── PostgreSQL   16

Cloudflare R2      archivos (10 GB gratis, egreso gratis)
```

Todo en **un mismo origen** a propósito: la cookie de sesión es httpOnly y la
guarda CSRF de la API exige que el `Origin` coincida con `APP_ORIGIN`
(`apps/api/src/app.ts`). Separar la web y la API en dominios distintos rompe
las dos cosas.

## 1. La VM en Oracle Cloud

Creá una instancia **Always Free**:

- **Shape**: `VM.Standard.A1.Flex` (ARM), **2 OCPU y 12 GB** de memoria.
- **Imagen**: Ubuntu 24.04.
- **Boot volume**: 50 GB.

Dos avisos que casi toda documentación vieja dice mal:

- **No son 4 OCPU / 24 GB.** Oracle bajó la cuota a la mitad; la documentación
  oficial dice "the first 1,500 OCPU hours and 9,000 GB hours per month... For
  Always Free tenancies, this is equivalent to 2 OCPUs and 12 GB of memory".
  Pedir más no se puede, aunque la consola todavía muestre el banner viejo.
- **Capacidad**: los errores "out of host capacity" son comunes en las regiones
  populares. Probá otra *availability domain*, otra región, o esperá.

**Sobre la inactividad**: Oracle puede reclamar una instancia si durante 7 días
seguidos el CPU (percentil 95), la red y la memoria quedan todos por debajo del
20%. Para un tablero personal eso es un riesgo real. El paso 6 lo mitiga.

## 2. El dominio

Sin dominio propio, un **subdominio de DuckDNS** (gratis) alcanza:

1. Creá el subdominio en <https://www.duckdns.org> y apuntalo a la IP de la VM.
2. El TLS lo pide Caddy con el desafío HTTP-01 normal, porque la VM tiene IP
   pública y los puertos 80/443 abiertos. No hace falta el módulo de DuckDNS.

Si más adelante comprás un dominio, sólo cambiás `SITE_ADDRESS`.

## 3. El bucket en Cloudflare R2

En <https://dash.cloudflare.com> → **Storage & Databases → R2 → Create bucket**
(por ejemplo `tablero`). Después, **Manage R2 API Tokens → Object Read & Write**
y anotá el *Account ID*, el *Access Key ID* y el *Secret Access Key*.

El bucket **puede y debe quedar privado**: la API entrega al navegador URLs
firmadas de 15 minutos (`apps/api/src/lib/storage.ts`), así que es la firma la
que da acceso, no el bucket. Por eso no hace falta un dominio público extra.

R2 no acepta `CreateBucket`, así que `ensureBucket()` sólo verifica que exista
y avisa si falta — el bucket se crea desde el panel.

## 4. La configuración

```bash
cp docker/.env.prod.example docker/.env.prod
$EDITOR docker/.env.prod      # dominio, contraseña, session secret, credenciales de R2
```

`SESSION_SECRET` necesita 32 caracteres o más (en producción la API se niega a
arrancar). Generalo con `openssl rand -base64 48`.

## 5. Levantar

```bash
git clone https://github.com/asormar/tablero.git
cd tablero
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d --build
```

La primera vez tarda: compila la imagen de la API con `ffmpeg` y el cliente de
Prisma, y la de la web con el build de Vite. Después:

```bash
docker compose -f docker/docker-compose.prod.yml ps
docker compose -f docker/docker-compose.prod.yml logs -f api
```

Las migraciones se aplican solas en cada arranque (`prisma migrate deploy`).

Verificá:

```bash
curl -s https://tu-dominio/api/health
```

## 6. Evitar el reclamo por inactividad

Un cron que despierte la API cada pocas horas mantiene el uso por encima del
umbral. En la VM:

```bash
crontab -e
```

```cron
*/17 * * * * curl -fsS https://tu-dominio/api/health >/dev/null 2>&1
```

Cada 17 minutos hay tráfico de red y CPU. Es lo bastante seguido como para que
ninguna ventana de 7 días supere el umbral.

## 7. respaldos

La base es lo único irreemplazable (R2 y el resto se regeneran):

```bash
docker exec tablero-postgres pg_dump -U tablero tablero | gzip > tablero-$(date +%F).sql.gz
```

Copiá ese archivo a otro lado: el volumen de Docker vive en la misma VM que
Oracle puede reclaimar.

## 8. Actualizar

```bash
git pull
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d --build
```

## Developimiento local

`docker/docker-compose.yml` (Postgres + MinIO) y `pnpm dev` siguen siendo el
camino de trabajo diario. MinIO en local, R2 en producción: lo único que los
distingue es la configuración de S3 (`S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`), así que el código es el mismo.

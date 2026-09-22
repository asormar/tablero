# Tablero

**An infinite visual canvas of nested boards: the Milanote that runs on your
own machine.** Notes, kanban, tables, maps, drawings, images and files on a
free-form canvas — with real-time collaboration, templates, global search and
a browser extension to capture whatever you are reading.

A functional Milanote clone for personal, self-hosted use, with its own visual
identity. The interface is in Spanish (English is also available) and it is
meant to run locally with Docker.

## Features

**Canvas**
- Infinite canvas with zoom, lasso selection, dragging with magnetic alignment
  guides and an 8 px grid — sustained 60 fps with 300+ cards.
- Nested boards with breadcrumbs; move and duplicate whole subtrees.
- Undo/redo per gesture: a drag is a single step, and text undoes inside its
  own editor.

**Content**
- Rich-text notes (TipTap), headings, board cards, kanban columns, tasks with
  due dates and subtasks, tables, long-form documents, freehand drawing and a
  map with place search.
- Images, video, audio, PDF, links with previews and files: queued uploads,
  thumbnails, deduplication and custom viewers.
- Smart paste: `Ctrl/Cmd+V` with text, an image or a YouTube link creates the
  matching card type.

**Organization and productivity**
- Global search (Spanish full-text) and a `Ctrl/Cmd+K` command palette.
- 12 system templates, a trash with 30-day retention, favorites, an
  «Unsorted» inbox and a global tasks view.
- Version history with reversible restore.
- Export to PNG, PDF, Markdown, text, JSON and ZIP; import from Markdown and
  CSV.
- Light/dark themes, per-account settings, an installable PWA with an offline
  shell and a mobile-optimized view.

**Collaboration**
- Share boards with roles (owner, editor, commenter, viewer) inherited down
  the hierarchy, and publish a board with a public link (`/p/:slug`, optional
  password).
- Real-time cursors and selection, presence, comments with @mentions,
  notifications and an activity log.

**Extras**
- Browser extension (Manifest V3) that sends the current page — title, URL and
  selection — to «Unsorted» using your personal token.
- Quick capture API (`POST /api/capture`) for shortcuts and scripts.
- Accessibility: full keyboard flow, visible focus, focus traps in dialogs and
  AA contrast in both themes (0 violations in a real-browser audit).

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18 · Vite · TypeScript · Zustand · Yjs + TipTap · Leaflet |
| Backend | Fastify · Prisma · PostgreSQL 16 · Hocuspocus (Yjs collaboration) |
| Storage | MinIO (S3-compatible) · sharp · ffmpeg |
| Monorepo | pnpm workspaces — `apps/web`, `apps/api`, `packages/shared` |
| Quality | Vitest · Playwright (e2e) · HTTP/WebSocket smoke tests · real-browser accessibility audit |

## Getting started

Requirements: **Node 22**, **pnpm 9** (`npm install -g pnpm@9`) and **Docker**
with Compose (PostgreSQL 16 and MinIO).

```bash
# 1. Infrastructure
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml ps      # wait for "healthy"

# 2. Environment variables
cp .env.example .env
cp .env.example apps/api/.env

# 3. Dependencies and database
pnpm install
# `pnpm install` generates the Prisma client by itself (the root `postinstall`
# script); after a schema change, regenerate it with `pnpm db:generate`.
pnpm --filter @tablero/api exec prisma migrate dev --name init

# 4. Run (two terminals)
pnpm --filter @tablero/api dev      # REST API + WebSocket on :8787
pnpm --filter @tablero/web dev      # UI on :5173
```

Open <http://localhost:5173>: with no session you get the **sign-in** screen
(log in or create an account; registering creates the root board «Inicio»).
The panel never blocks: «continue without an account» lets you work locally in
that browser, and anything created that way is adopted by the server when you
sign in. Then start dragging cards from the sidebar.

### Ports

| Service | Port | Note |
| --- | --- | --- |
| REST API + WebSocket `/collab` | 8787 | share the HTTP server |
| UI (development) | 5173 | proxies `/api` and `/collab` to 8787 |
| Build preview | 4173 | `pnpm --filter @tablero/web preview` |
| PostgreSQL | **5433** | the compose file publishes 5433 (see the comment in `docker/docker-compose.yml`); `.env` already points at 5433 |
| MinIO | 9000 (S3) / 9001 (console) | bucket created by the init container |

## Repository layout

```
apps/web           React 18 + Vite + Zustand + Yjs + TipTap (canvas, PWA)
apps/api           Fastify + Prisma + PostgreSQL + Hocuspocus (REST + WebSocket)
apps/extension     Manifest V3 browser extension (capture to «Unsorted»)
packages/shared    types, Zod schemas and domain logic (with tests)
docker             Postgres and MinIO compose
```

## Tests

```bash
pnpm test                            # vitest across all packages
pnpm typecheck                       # strict TypeScript in all four packages
pnpm --filter @tablero/web build     # production build

bash apps/api/scripts/smoke-rest.sh              # full CRUD cycle over HTTP
pnpm --filter @tablero/api smoke:collab          # real time: write, disconnect, verify persistence
pnpm --filter @tablero/api smoke:assets          # files: upload, thumbnails, dedupe, limits, permissions
pnpm --filter @tablero/api smoke:productividad   # search, templates, export
pnpm --filter @tablero/api smoke:colaboracion    # roles, publishing, comments
pnpm --filter @tablero/web e2e                   # Playwright: 14 end-to-end tests
```

Current numbers: **1124 unit tests** (280 in `shared`, 267 in `api`, 577 in
`web`) all green, typecheck clean across the four packages and **14
end-to-end tests** with Playwright. The domain logic lives in
`packages/shared` and has no browser dependency.

## Documentation

| Document | Contents |
| --- | --- |
| [`apps/extension/README.md`](apps/extension/README.md) | how to install and use the browser extension |
| [`apps/web/e2e/README.md`](apps/web/e2e/README.md) | how the Playwright end-to-end suite runs |

## Status

Complete: all six phases of the plan (base and canvas, media content,
structure, productivity, collaboration and extras) implemented, verified with
real execution and reviewed by an independent reviewer.

# DA2: Phone & Accessories Store + NoSQL Telemetry Platform

E-commerce store for phones and electronic accessories (LKR), with a telemetry platform that tracks customer behaviour. It uses MongoDB (document + time-series) and Redis (key-value + streams).

Design docs: [use cases](docs/use-cases-and-roles.md) · [architecture](docs/architecture.md) · [data model](docs/data-model.md) · [roadmap](docs/todo.md) · [evidence](evidence/README.md)

## Prerequisites

- Node.js 22+
- Docker Desktop (running)
- Microsoft Edge (used for evidence screenshots)

Screenshots in the `catalog` evidence set (and later sets) need the API and web app running.

## First-time setup

```bash
npm install
cp .env.example .env
npm run infra:up        # 3-node MongoDB replica set + Redis; waits until healthy
npm run db:bootstrap    # collections, validators, indexes, settings
npm run db:seed         # 80 products (replaces the catalog)
```

Then run the API and the web app in two terminals:

```bash
npm run dev:api         # http://localhost:4000
npm run dev:web         # http://localhost:5173  (storefront)
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm run infra:up` / `infra:down` | Start / stop the containers (data is kept) |
| `npm run infra:reset` | Stop containers **and delete all data** |
| `npm run db:seed` | Replace the product catalog with the seed data |
| `npm run dev:api` | API on http://localhost:4000 (auto-reloads) |
| `npm run dev:web` | Storefront on http://localhost:5173 (proxies `/api` to the API) |
| `npm run dev:worker` | Background worker (stream consumer, rollups) |
| `npm run typecheck` | Type-check all workspaces |
| `npm run evidence -- --list` | List evidence capture sets |
| `npm run evidence -- <set>` | Capture report evidence into `evidence/` |

Health check: http://localhost:4000/api/health shows the current replica set primary and Redis status.

## Repository layout

```
apps/api          Express API
apps/worker       Redis Stream consumer + rollup jobs
apps/web          React storefront + staff dashboard
packages/shared   Zod schemas and types shared by all apps (server-only helpers under /server)
scripts/db        Database bootstrap
scripts/evidence  Evidence capture (command output + Playwright screenshots)
infra             Docker Compose
docs              Design documents
evidence          Generated report evidence (index: evidence/README.md)
```

## Evidence

`npm run evidence -- <set>` runs a set of captures and writes each one to `evidence/<phase>/`:

- **Text evidence** (`.md`): command/query output with a header saying what it proves and which report section it supports.
- **Screenshots** (`.png`): taken with Playwright driving the installed Microsoft Edge.

`evidence/README.md` is regenerated as an index after every capture. Captures are re-runnable, so after a change you refresh the evidence instead of retaking screenshots by hand.

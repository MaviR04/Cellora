# DA2: Phone & Accessories Store + NoSQL Telemetry Platform

E-commerce store for phones and electronic accessories (LKR), with a telemetry platform that tracks customer behaviour. It uses MongoDB (document + time-series) and Redis (key-value + streams).

Design docs: [use cases](docs/use-cases-and-roles.md) · [architecture](docs/architecture.md) · [data model](docs/data-model.md) · [roadmap](docs/todo.md) · [study guide](docs/study-guide.md) · [evidence](evidence/README.md)

## Prerequisites

- Node.js 22+
- Docker Desktop (running)
- Microsoft Edge (used for evidence screenshots)

Evidence sets from `catalog` onwards need the API and web app running (screenshots, and API calls as the demo accounts).

## First-time setup

```bash
npm install
cp .env.example .env
npm run infra:up        # 3-node MongoDB replica set + Redis; waits until healthy
npm run db:bootstrap    # collections, validators, indexes, settings
npm run db:seed         # 80 products (replaces the catalog)
npm run db:seed-users   # demo accounts: admin/analyst/support/customer@cellora.test (password: SEED_USER_PASSWORD)
```

Then run these in three terminals:

```bash
npm run dev:api         # http://localhost:4000
npm run dev:worker      # moves telemetry from the Redis Stream into MongoDB
npm run dev:web         # http://localhost:5173  (storefront)
```

## Staff dashboards

Log in at http://localhost:5173/login with a demo account, then click **Staff** (or go to `/staff`). Each role sees only its own dashboards, and the API enforces the same rules.

| Account | Dashboards |
|---|---|
| `analyst@cellora.test` | Live activity, purchase funnel, trends & top lists, CSV/JSON export |
| `support@cellora.test` | Find a customer, customer 360, session timeline + notes, failed checkouts, escalations (contact details masked) |
| `admin@cellora.test` | Everything above, plus users & access (roles, revoke, GDPR erasure), data & indexes (retention, rollups), system health, audit log |

For a lively Live-activity page, run `npm run sim:live` in a fourth terminal.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run infra:up` / `infra:down` | Start / stop the containers (data is kept) |
| `npm run infra:reset` | Stop containers **and delete all data** |
| `npm run db:seed` | Replace the product catalog with the seed data |
| `npm run db:seed-users` | Create/reset the demo accounts (one per role) |
| `npm run dev:api` | API on http://localhost:4000 (auto-reloads) |
| `npm run dev:web` | Storefront on http://localhost:5173 (proxies `/api` to the API) |
| `npm run dev:worker` | Background worker (stream consumer, rollups) |
| `npm run db:shell` | mongosh as the app user (`-- --analyst` for the read-only user) |
| `npm run redis:cli` | redis-cli inside the Redis container |
| `npm run sim:backfill -- --days 14 --per-day 900` | Generate historical traffic through the pipeline (worker must run); `-- --reset` removes it |
| `npm run sim:live -- --rate 12 --minutes 10` | Live simulated shoppers using the real API (for demos) |
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
scripts/simulate  Traffic simulator (backfill + live)
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

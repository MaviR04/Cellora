# Roadmap & TODO

End-to-end plan for the assignment: application **and** report, through to the viva.

**Deliverables** (from the brief)
- Application + report explaining the **characteristics, applications, strengths and limitations** of the NoSQL solution. Report submitted as **PDF only**. *(65 marks)*
- Viva, 30–45 min. *(35 marks)*

**Conventions**
- 📸 = evidence for the report, captured *while* doing the task with `npm run evidence -- <set>` into [`evidence/`](../evidence/README.md). Each phase gets a capture set.
- ⭐ = stretch goal; do it only if the core items are done and on schedule.
- After each phase, its section in [study-guide.md](study-guide.md) is written: study it the same day.
- Related docs: [use-cases-and-roles.md](use-cases-and-roles.md) · [architecture.md](architecture.md) · [data-model.md](data-model.md)

---

## Schedule

**Hard deadline:** Friday 2 Oct 2026. **Target:** everything done by **Tuesday 29 Sep**; Wed–Thu are buffer (other assignments).

| When | Goal | Phases | Done when |
|---|---|---|---|
| **Sun 27 (evening)** | Infrastructure up, catalog in the DB | 1, 2 (seed + catalog API) | `docker compose up` gives a healthy replica set + Redis; seeded products queryable through the API |
| **Mon 28** | The customer side works end to end and produces telemetry | 2 (UI), 3, 4, 5, 6 | Browse → cart → checkout works in the browser; events flow browser → stream → `events`; simulator fills a few days of history |
| **Tue 29** | Staff side + evidence + report draft | 7, 8, 9, 10 | Analyst, Support and Admin dashboards work; 📸 evidence captured; full report draft exists |
| Wed 30 – Thu 1 | Buffer only | 10 (polish), 11 | PDF exported; demo rehearsed |
| **Fri 2** | Submit | 11 | Submitted |

**Scope rules for this timeline**
- Functional, clean UI over polished UI. No design work beyond a simple consistent layout.
- ⭐ items are cut unless a day finishes early. They are still mentioned in the report as future work where relevant.
- If a day slips, cut from Phase 8 (Admin UC6 extras, audit log viewer) before touching the telemetry pipeline, funnels or checkout. Those carry the NoSQL story.
- Report sections 2–5 mostly repackage the existing docs; draft them in any gap (e.g. while the simulator runs).
- **Understand as you go.** The viva is 35 marks. Read and ask about each piece as it lands, rather than learning it all on Wednesday.

---

## Phase 0: Planning ✅

- [x] Select business problem (phone & accessories e-commerce + telemetry platform)
- [x] Use case diagram approved by lecturer
- [x] Extended roles and use cases (Customer, Support Agent, UC8–UC15)
- [x] Architecture & technology justification (MongoDB + Redis; Cassandra/Neo4j/Elasticsearch rejected)
- [x] Data model (schemas, event catalogue, indexes)
- [x] Docker Desktop installed
- [x] Decide store currency: Sri Lankan Rupees (LKR)
- [x] Commit docs to git

---

## Phase 1: Foundation · Sun 27

- [x] npm workspaces monorepo: `apps/api`, `apps/worker`, `packages/shared`, `scripts/`, `infra/` (`apps/web` created in Phase 2)
- [x] TypeScript config (shared base `tsconfig`)
- [ ] ⭐ ESLint + Prettier
- [x] `infra/docker-compose.yml`: 3-node MongoDB replica set (`rs0`, self-initiating healthcheck), Redis with AOF
- [x] `.env.example` + config loader (Mongo URI, Redis URL, session secret)
- [x] `packages/shared`: Zod schemas for event envelope + event types, product kinds, roles
- [x] DB bootstrap script: create `events` time-series collection, `products` `$jsonSchema` validator, all indexes from data-model §8
- [x] Root `README.md`: prerequisites + how to run
- [x] Evidence tooling: `npm run evidence -- <set>` (text captures + Edge screenshots, auto-generated index)
- [x] MongoDB authentication: keyfile between members; `root`, `da2_app` (readWrite + dbAdmin + clusterMonitor) and read-only `da2_analyst` users
- [x] 📸 `foundation` set: containers, replica set status, database access control, collections & indexes, Redis persistence, API health

## Phase 2: Catalog & storefront · Sun 27 (seed + API), Mon 28 (UI)

- [x] Mongoose `Product` base model + 7 discriminators
- [x] Seed script: 80 real products / 173 SKUs (approximate LKR prices); accessories linked to seeded `modelKey`s; 3 SKUs seeded with stock 1 for the race test
- [x] API: categories, list/filter by kind, brand and price, `$facet` filters, product by slug, weighted text search, two-way compatibility (`/related`)
- [x] React (Vite) app shell, routing, layout (Tailwind)
- [x] Pages: home, category listing with filters, search results, product page (variant picker, per-kind spec table, compatible accessories)
- [x] 📸 Two very different product documents side by side (phone vs screen protector): the flexible-schema evidence
- [x] 📸 `$jsonSchema` validation: new attribute accepted, invalid documents rejected
- [x] 📸 `explain("executionStats")` for 5 catalog queries vs forced COLLSCAN
- [x] 📸 Storefront screenshots (home, listing, filtered listing, phone page, accessory page, search)

## Phase 3: Auth, sessions & cart · Mon 28

- [x] `User` model; signup/login with scrypt password hashing
- [x] Redis sessions (`sess:*`, `user_sessions:*`), httpOnly session cookie, logout, admin "revoke all sessions" (+ audit_log)
- [x] RBAC middleware (`customer` / `analyst` / `support` / `admin`)
- [x] Seed demo accounts (one per role): `npm run db:seed-users`
- [x] Redis cart: guest `cart:{cartId}` + user `cart:u:{userId}`, 30-day TTL, merge on login; anonymous ID linked to the user at login
- [x] Cart UI (add / remove / change quantity; live prices from MongoDB); login/signup pages; staff placeholder
- [x] 📸 `auth-cart` set: RBAC matrix, guest-cart merge, session revocation, user document, 4 screenshots

## Phase 4: Checkout & orders · Mon 28

- [x] Checkout flow: contact, address, simulated payment (COD / card approve / card decline, no card data collected), guest or logged-in
- [x] Multi-document transaction: per-variant stock decrement (`$elemMatch` + positional `$inc`) + order insert, `w: "majority"`, snapshot read concern, `withTransaction` retries
- [x] Failure paths: out of stock (409), simulated payment declined (402); server events `order_placed` / `checkout_failed` sent to the Redis Stream
- [x] Order confirmation + "My orders" page; order numbers from an atomic counter document
- [x] 📸 Concurrency test: 20 parallel checkouts for the last unit, exactly one succeeds; naive read-then-write oversells; explicit rollback; order document; stream; 3 screenshots

## Phase 5: Telemetry pipeline · Mon 28

- [x] Frontend tracker: `anonymousId` (localStorage), `sessionId` (30-min inactivity), batching, `sendBeacon` on page hide
- [x] Instrument storefront: `page_view`, `category_view`, `product_view`, `search`, cart events, `checkout_started`, `payment_submitted`, `identify`
- [x] `X-Session-Id` / `X-Anonymous-Id` headers on all API calls (identity in the body for `/api/events`, because `sendBeacon` can't set headers)
- [x] `POST /api/events`: per-event Zod validation, device parsing, `receivedAt`, pipelined `XADD events:ingest MAXLEN ~`
- [x] Server-side events: `order_placed`, `checkout_failed`
- [x] Worker: consumer group, `XREADGROUP` → `insertMany({ordered:false})` → counters (`PFADD`, `INCR`) → `XACK`; dead-letter stream for unparseable entries
- [x] Worker: `XAUTOCLAIM` recovery of pending entries
- [x] Worker: identity backfill on `identify` (`updateMany` on `meta`)
- [x] ⭐ Worker: best-effort `eventId` dedupe (`seen:{eventId}` keys, 1 h TTL, written after a successful insert)
- [x] 📸 `telemetry` set: real browser journey → session timeline, identity stitching, event document, throughput (20k events), stream/consumer/counters

## Phase 6: Traffic simulator · Mon 28

- [ ] `scripts/simulate-traffic.ts`: N synthetic sessions with configurable drop-off per funnel step, device mix, guest vs logged-in mix, some out-of-stock failures
- [ ] Backfill mode: generate historical days (so funnels/trends have data); live mode: steady trickle for "real-time" widgets
- [ ] 📸 Collection stats after load (`events` document count, storage size, compression ratio from `collStats`)

## Phase 7: Rollups · Tue 29

- [ ] `session_summaries` rollup (`$merge`, replace)
- [ ] `metrics_hourly` rollup
- [ ] `funnel_daily` rollup (ordered funnel pipeline, data-model §11)
- [ ] ⭐ `byDevice` funnel breakdown
- [ ] Schedule with `node-cron` in worker (interval from `settings`)
- [ ] 📸 Query time: funnel from raw `events` vs from `funnel_daily` vs Redis cache hit

## Phase 8: Staff dashboards · Tue 29

**Analyst (read-only)**
- [ ] UC1 Live activity: active users now (HyperLogLog), events/min, recent event feed, top pages/products
- [ ] UC2 Funnel chart with date range + step conversion %
- [ ] UC3 Export report to CSV/JSON
- [ ] Analyst queries use `secondaryPreferred`
- [ ] Analyst queries go through the read-only `da2_analyst` connection (`connectAnalystMongo`)

**Support**
- [ ] UC12 Find customer (email / order number / anonymous ID) → sessions list → session timeline
- [ ] UC12 "Failed checkouts" queue
- [ ] UC13 Order & cart history
- [ ] UC14 Flag / annotate session; escalation queue
- [ ] PII masking in API responses for `support`

**Admin**
- [ ] UC4 Manage users & roles; revoke sessions
- [ ] UC5 Data retention setting → `collMod expireAfterSeconds`
- [ ] UC6 Index list + `$indexStats` usage; trigger rollup rebuild
- [ ] ⭐ UC6 In-app explain viewer (use `mongosh` output as report evidence instead)
- [ ] UC7 Health: replica set members/lag, `serverStatus` metrics, Redis `INFO`, stream backlog
- [ ] UC15 Erase customer data (GDPR) + `audit_log`
- [ ] ⭐ Audit log viewer (entries are still written)
- [ ] 📸 Every dashboard page (report + viva backup)

## Phase 9: Testing & evidence · Tue 29

- [ ] Funnel correctness check on a small fixed dataset (script)
- [ ] ⭐ Unit test suite: Zod event schemas, PII masking
- [x] Scripted check: stock race (`npm run evidence -- checkout`)
- [ ] Scripted check: GDPR erasure
- [ ] ⭐ Automated integration tests (checkout, identity backfill)
- [ ] Failover test: `docker stop` the primary → election → app recovers
- [ ] Measure and record: ingest throughput, dashboard latency (raw vs rollup vs cache), index vs collection scan
- [ ] 📸 Failover sequence (before / during / after)
- [ ] Code freeze: tidy up, remove dead code, final README pass

## Phase 10: Report · draft Tue 29, polish Wed 30 – Thu 1

Draft in Markdown under `docs/report/`, export to **PDF**.

- [ ] **1. Introduction:** business problem, objectives, scope
- [ ] **2. NoSQL background:** definition and origins; families (document, key-value, wide-column, graph) with examples; ACID vs BASE; CAP theorem; schema-on-read vs schema-on-write
- [ ] **3. Requirements:** actors, use case diagram (approved + extended), use case descriptions
- [ ] **4. Solution design:** architecture diagram; technology selection with justification per use case; considered and rejected alternatives
- [ ] **5. Data model:** document design, embed vs reference vs denormalise decisions, time-series design and `metaField` trade-off, indexes (ESR), Redis structures; SQL-equivalent comparison
- [ ] **6. Implementation:** key features with screenshots + short code excerpts (checkout transaction, ingestion pipeline, funnel aggregation, TTL, identity stitching)
- [ ] **7. Characteristics:** as demonstrated in the app: flexible schema, horizontal scale / replication, tunable consistency (write concerns, read preference), eventual consistency (rollups, cache), TTL, key-value speed
- [ ] **8. Applications:** where NoSQL fits in industry (telemetry/IoT, catalogs, caching, sessions, real-time analytics) and where each appears in this app
- [ ] **9. Strengths:** each backed by evidence from Phase 9 measurements
- [ ] **10. Limitations:** each backed by evidence: no referential integrity, duplicate events (at-least-once), GDPR erasure across denormalised data, joins/ad-hoc analysis, transactions require replica set, storage cost of duplication, identity backfill race
- [ ] **11. Evaluation:** testing results; comparison with an equivalent relational design; what I'd change at larger scale (sharding key, Redis Cluster, when Cassandra becomes justified)
- [ ] **12. Conclusion & future work**
- [ ] References (consistent citation style) + appendices (setup guide, API list)
- [ ] Proofread, check figures are numbered and referenced, export PDF, check the PDF renders correctly

## Phase 11: Submission & viva prep · Wed 30 – Fri 2

- [ ] Package application (source zip / repo link per submission instructions), excluding `node_modules`
- [ ] ⭐ Clean-machine test: follow README from scratch → app runs
- [ ] Submit PDF + application
- [ ] Demo script (~10 min): storefront journey → live telemetry → funnel → support timeline → admin (TTL, indexes, health) → failover
- [ ] Pre-demo checklist: Docker running, data seeded, simulator running, accounts ready
- [ ] ⭐ Backup screen recording of the demo in case the live demo fails
- [ ] Viva Q&A prep: be able to answer these without notes:
  - What is NoSQL? Name the families and give an example of each.
  - Why MongoDB? Why Redis? Why *not* Cassandra / Neo4j / just SQL?
  - Embed vs reference: examples from this app and the reasons
  - How do "foreign keys" work here? What happens to integrity?
  - Explain the time-series collection and the `metaField` trade-off
  - Explain the ingestion pipeline and its delivery guarantee
  - CAP / consistency: where is this app eventually consistent, and where is it strongly consistent?
  - How does the checkout avoid overselling?
  - Walk through the funnel aggregation
  - How would you scale this 100×?
  - What are the biggest limitations of your solution?
- [ ] Rehearse demo + Q&A at least twice (Wed/Thu)

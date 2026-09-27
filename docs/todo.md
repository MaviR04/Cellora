# Roadmap & TODO

End-to-end plan for the assignment: application **and** report, through to the viva.

**Deliverables** (from the brief)
- Application + report explaining the **characteristics, applications, strengths and limitations** of the NoSQL solution. Report submitted as **PDF only**. *(65 marks)*
- Viva, 30–45 min. *(35 marks)*

**Conventions**
- 📸 = capture a screenshot, output or measurement for the report *while* doing the task. Save to `docs/report/evidence/`.
- ⭐ = stretch goal; do it only if the core items are done and on schedule.
- Related docs: [use-cases-and-roles.md](use-cases-and-roles.md) · [architecture.md](architecture.md) · [data-model.md](data-model.md)

---

## Phase 0: Planning ✅

- [x] Select business problem (phone & accessories e-commerce + telemetry platform)
- [x] Use case diagram approved by lecturer
- [x] Extended roles and use cases (Customer, Support Agent, UC8–UC15)
- [x] Architecture & technology justification (MongoDB + Redis; Cassandra/Neo4j/Elasticsearch rejected)
- [x] Data model (schemas, event catalogue, indexes)
- [x] Docker Desktop installed
- [x] Decide store currency: rupees (confirm LKR vs INR before seeding prices)
- [x] Commit docs to git

---

## Phase 1: Foundation

- [ ] npm workspaces monorepo: `apps/web`, `apps/api`, `apps/worker`, `packages/shared`, `scripts/`, `infra/`
- [ ] TypeScript config (shared base `tsconfig`), ESLint + Prettier
- [ ] `infra/docker-compose.yml`: 3-node MongoDB replica set (`rs0`) + init container, Redis with AOF
- [ ] `.env.example` + config loader (Mongo URI, Redis URL, session secret)
- [ ] `packages/shared`: Zod schemas for event envelope + event types, product kinds, roles
- [ ] DB bootstrap script: create `events` time-series collection, `products` `$jsonSchema` validator, all indexes from data-model §8
- [ ] Root `README.md`: prerequisites + how to run
- [ ] 📸 `rs.status()` showing 3 members; `docker compose ps`

## Phase 2: Catalog & storefront

- [ ] Mongoose `Product` base model + 7 discriminators
- [ ] Seed script: ~60–100 real products; accessories linked to seeded `modelKey`s
- [ ] API: list/filter by kind, brand and price; product by slug; text search; "compatible accessories" for a phone
- [ ] React (Vite) app shell, routing, layout
- [ ] Pages: home, category listing with filters, search results, product page (variant picker + compatible accessories)
- [ ] 📸 Two very different product documents side by side (phone vs screen protector): the flexible-schema evidence
- [ ] 📸 `explain("executionStats")` for category + search queries (IXSCAN, keys vs docs examined)

## Phase 3: Auth, sessions & cart

- [ ] `User` model; signup/login with password hashing
- [ ] Redis sessions (`sess:*`, `user_sessions:*`), session cookie, logout
- [ ] RBAC middleware (`customer` / `analyst` / `support` / `admin`)
- [ ] Seed staff accounts (one per role)
- [ ] Redis cart: guest `cart:{cartId}` + user `cart:u:{userId}`, 30-day TTL, merge on login
- [ ] Cart UI (add / remove / change quantity; live prices from MongoDB)
- [ ] 📸 Redis `HGETALL cart:*` + `TTL` output

## Phase 4: Checkout & orders

- [ ] Checkout flow: address, simulated payment, place order
- [ ] Multi-document transaction: per-variant stock decrement (`$elemMatch` + positional `$inc`) + order insert, `w: "majority"`
- [ ] Failure paths: out of stock, simulated payment declined
- [ ] Order confirmation + "My orders" page
- [ ] 📸 Concurrency test: parallel checkouts for the last unit of stock; exactly one succeeds (no overselling)

## Phase 5: Telemetry pipeline

- [ ] Frontend tracker: `anonymousId` (localStorage), `sessionId` (30-min inactivity), batching, `sendBeacon` on page hide
- [ ] Instrument storefront: `page_view`, `category_view`, `product_view`, `search`, cart events, `checkout_started`, `payment_submitted`, `identify`
- [ ] `X-Session-Id` / `X-Anonymous-Id` headers on all API calls
- [ ] `POST /api/events`: Zod validation, device parsing, `receivedAt`, `XADD events:ingest MAXLEN ~`
- [ ] Server-side events: `order_placed`, `checkout_failed`
- [ ] Worker: consumer group, `XREADGROUP` → `insertMany({ordered:false})` → counters (`PFADD`, `INCR`) → `XACK`
- [ ] Worker: `XAUTOCLAIM` recovery of pending entries
- [ ] Worker: identity backfill on `identify` (`updateMany` on `meta`)
- [ ] ⭐ Worker: best-effort `eventId` dedupe via Redis set
- [ ] 📸 A raw event document; `XINFO GROUPS` / `XPENDING`; events/sec ingest throughput measurement

## Phase 6: Traffic simulator

- [ ] `scripts/simulate-traffic.ts`: N synthetic sessions with configurable drop-off per funnel step, device mix, guest vs logged-in mix, some out-of-stock failures
- [ ] Backfill mode: generate historical days (so funnels/trends have data); live mode: steady trickle for "real-time" widgets
- [ ] 📸 Collection stats after load (`events` document count, storage size, compression ratio from `collStats`)

## Phase 7: Rollups

- [ ] `session_summaries` rollup (`$merge`, replace)
- [ ] `metrics_hourly` rollup
- [ ] `funnel_daily` rollup (ordered funnel pipeline, data-model §11)
- [ ] ⭐ `byDevice` funnel breakdown
- [ ] Schedule with `node-cron` in worker (interval from `settings`)
- [ ] 📸 Query time: funnel from raw `events` vs from `funnel_daily` vs Redis cache hit

## Phase 8: Staff dashboards

**Analyst (read-only)**
- [ ] UC1 Live activity: active users now (HyperLogLog), events/min, recent event feed, top pages/products
- [ ] UC2 Funnel chart with date range + step conversion %
- [ ] UC3 Export report to CSV/JSON
- [ ] Analyst queries use `secondaryPreferred` + read-only DB user

**Support**
- [ ] UC12 Find customer (email / order number / anonymous ID) → sessions list → session timeline
- [ ] UC12 "Failed checkouts" queue
- [ ] UC13 Order & cart history
- [ ] UC14 Flag / annotate session; escalation queue
- [ ] PII masking in API responses for `support`

**Admin**
- [ ] UC4 Manage users & roles; revoke sessions
- [ ] UC5 Data retention setting → `collMod expireAfterSeconds`
- [ ] UC6 Index list + `$indexStats` usage + explain viewer; trigger rollup rebuild
- [ ] UC7 Health: replica set members/lag, `serverStatus` metrics, Redis `INFO`, stream backlog
- [ ] UC15 Erase customer data (GDPR) + `audit_log`
- [ ] Audit log viewer
- [ ] 📸 Every dashboard page (report + viva backup)

## Phase 9: Testing & evidence

- [ ] Unit tests: Zod event schemas, funnel pipeline on a fixed dataset, PII masking
- [ ] Integration tests: checkout transaction, stock race, identity backfill, GDPR erasure
- [ ] Failover test: `docker stop` the primary → election → app recovers
- [ ] Measure and record: ingest throughput, dashboard latency (raw vs rollup vs cache), index vs collection scan
- [ ] 📸 Failover sequence (before / during / after)
- [ ] Code freeze: tidy up, remove dead code, final README pass

## Phase 10: Report (write alongside Phases 1–9, finalise here)

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

## Phase 11: Submission & viva prep

- [ ] Package application (source zip / repo link per submission instructions), excluding `node_modules`
- [ ] Clean-machine test: follow README from scratch → app runs
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
- [ ] Rehearse demo + Q&A at least twice

# Study Guide

What to understand after each phase so you can explain and defend the project in the viva (35 marks). Each phase covers:

- **Concepts:** the NoSQL ideas the phase demonstrates, in plain language
- **Read these files:** in this order, with what to look for
- **Try it yourself:** commands to run so it sticks
- **Viva questions:** likely questions, with the points a good answer covers
- **Evidence:** what the phase captured for the report

> **How to use this:** after each phase, spend 20–30 minutes on its section. Answer the viva questions **out loud** without looking. If you can't, re-read the file it points to. On viva day, the "One-minute summary" at the end of each phase is your cheat sheet.

**Shells used in the exercises**

```bash
npm run db:shell                  # mongosh as the app user (da2_app)
npm run db:shell -- --analyst     # mongosh as the read-only analyst user
npm run redis:cli                 # redis-cli
```

---

## Phase 0: Design (use cases, architecture, data model)

### Concepts

**What "NoSQL" means.** A family of databases that are *not* relational tables queried with SQL. They give up some relational guarantees (fixed schema, JOINs, and in some systems strict consistency) in exchange for flexible data shapes, horizontal scaling and speed on specific access patterns. "Not only SQL" is the common reading.

**The four families**, with the example you'd give:

| Family | Data shape | Example product | Where it's used in this project |
|---|---|---|---|
| Document | JSON-like documents, nested fields and arrays | MongoDB | Catalog, orders, users, telemetry events |
| Key-value | A key maps to a value (string, hash, set, stream…) | Redis | Carts, sessions, live counters, cache, ingestion stream |
| Wide-column | Rows with dynamic columns, partitioned across nodes | Cassandra | Considered and rejected (no aggregation for funnels) |
| Graph | Nodes and relationships | Neo4j | Considered and rejected (no multi-hop use case) |

**Polyglot persistence.** Using more than one database, each for the job it's best at. The rule we applied: *a store is only included if removing it would break a use case or make it meaningfully worse.*

**Query-driven design** (the big mindset shift from SQL):
- **SQL:** model the entities, normalise, then write any query with JOINs.
- **NoSQL:** list the queries first, then shape documents so each common query hits **one collection** with **one index**.

**Embed vs reference vs denormalise.** The three ways to connect data (see [data-model.md §9](data-model.md)):
- **Embed** when the data is read together, owned by one parent and bounded in size (variants inside a product).
- **Reference** (store another document's `_id`) when it's unbounded or shared (order → customer).
- **Denormalise** (copy) when the copy is a historical fact or avoids a join on a hot path (order line items, `kind`/`price` copied into events).

**No foreign keys.** A reference is just a stored `_id`. MongoDB does not check it exists and does not cascade deletes. The application is responsible for integrity.

**ACID vs BASE, and CAP.**
- ACID: Atomic, Consistent, Isolated, Durable. Classic relational guarantees.
- BASE: Basically Available, Soft state, Eventually consistent. What many NoSQL systems favour for scale.
- CAP theorem: during a network **P**artition, a distributed system must choose between **C**onsistency and **A**vailability.
- This project uses both models on purpose: checkout is strongly consistent (ACID transaction, majority writes); analytics are eventually consistent (rollups, caches, reads from secondaries).

### Read these files
1. [use-cases-and-roles.md](use-cases-and-roles.md): the 4 actors and 15 use cases. Know which actor does what.
2. [architecture.md §3](architecture.md): the "justification" tables. **Most important section for the viva.**
3. [data-model.md §2, §9](data-model.md): modelling principles and the embed/reference register.

### Viva questions
- **"What is NoSQL? Name the families."** Definition + the four families with an example each, and which ones you used.
- **"Why MongoDB?"** Heterogeneous product attributes (flexible schema), time-series collections for telemetry, the aggregation pipeline for funnels, TTL for purging, replica sets for availability, and transactions for checkout.
- **"Why add Redis? Couldn't MongoDB do it all?"** Tie each Redis feature to a use case: real-time counters (UC1), dashboard cache (UC6), carts (UC10), instantly revocable sessions (UC4), and a stream to decouple event ingestion from the request path. MongoDB *could* store carts, but they change on nearly every request, are temporary and are only looked up by key. That's exactly the key-value sweet spot.
- **"Why not Cassandra?"** It's excellent for append-only writes, but has no aggregation, so funnels (UC2) would need Spark. It only pays off at a scale far beyond this project.
- **"Why not Neo4j?"** No use case needs multi-hop traversal. Compatibility is just an array of model IDs.
- **"How do you do a JOIN in MongoDB?"** `$lookup` in an aggregation, or two queries in code. But the design *avoids* joins on hot paths by embedding and denormalising.
- **"What happens to integrity without foreign keys?"** The app enforces it. Show the examples: order line items are snapshots (they never go stale), and events copy `kind`/`price` as historical facts.

### One-minute summary
> A phone store whose customers generate telemetry. MongoDB is the main store because product data is heterogeneous and telemetry is time-series; Redis handles the fast, temporary, key-based data. Every technology choice is tied to a use case, and the rejected options (Cassandra, Neo4j) are documented with reasons. The data model is query-driven: embed what's read together, reference what's unbounded, copy what's a historical fact.

---

## Phase 1: Infrastructure (replica set, authentication, bootstrap)

### Concepts

**Replica set.** Several MongoDB servers (here 3) holding the **same data**.
- One **PRIMARY** accepts all writes. The **SECONDARIES** copy its operation log (the *oplog*) and apply the same changes.
- If the primary dies, the remaining members hold an **election** and promote a secondary within seconds. This is **automatic failover**, i.e. high availability.
- Priorities decide who is preferred as primary (mongo1 has priority 2).
- Replication ≠ sharding. Replication copies *all* data to every node, for availability. Sharding *splits* data across nodes, for scale. We use replication; sharding is discussed in the report as a scaling path.

**Why a replica set on one laptop?** Multi-document transactions require one (checkout, Phase 4). It also lets you demonstrate failover live in the viva.

**Read preference and write concern** (tunable consistency, a key NoSQL characteristic):
- *Write concern* = how many nodes must confirm a write before it counts: `w:1` (primary only: fast, could be lost on failover) vs `w:"majority"` (safe).
- *Read preference* = which node to read from: `primary` (always up to date) vs `secondaryPreferred` (offloads the primary but may lag slightly).
- We choose **per operation**: orders use majority, events use `w:1`; analysts read from secondaries.

**Authentication and RBAC at the database level.**
- The members authenticate to each other with a shared **keyfile**.
- Users: `root` (operations only), `da2_app` (readWrite + dbAdmin + clusterMonitor) and `da2_analyst` (**read only**).
- *Localhost exception:* on a fresh server with no users, a connection from inside the machine may create the **first** user. After that, everyone must log in. Our init script uses this once.

**Time-series collection.** A special collection type for measurements over time.
- You declare a `timeField` (`ts`) and a `metaField` (`meta`: who or what the event is about).
- MongoDB groups events with the same `meta` into compressed **buckets**, which saves space and speeds up time-range queries.
- `expireAfterSeconds` makes old events delete themselves (TTL), which is UC5.

**Bootstrap is idempotent.** Running it twice gives the same result, so it's safe to re-run (`createIndexes` and `collMod` are no-ops when nothing changed).

### Read these files
1. [infra/docker-compose.yml](../infra/docker-compose.yml): 3 mongod containers and Redis. Look at `--replSet rs0`, `--keyFile`, and the healthcheck.
2. [infra/mongo/init-replica-set.js](../infra/mongo/init-replica-set.js): `rs.initiate`, waiting for a primary, creating the users. **Know the role of each user.**
3. [scripts/db/bootstrap.ts](../scripts/db/bootstrap.ts): the time-series collection, the `$jsonSchema` validator and the index list.
4. [packages/shared/src/events.ts](../packages/shared/src/events.ts): the telemetry event catalogue as Zod schemas. Why validation lives in the app: MongoDB doesn't enforce a schema by default.

### Try it yourself
```js
// npm run db:shell
rs.status().members.map(m => m.name + " " + m.stateStr)   // who is PRIMARY?
db.hello().primary
db.getCollectionInfos({ name: "events" })                  // timeseries options + expireAfterSeconds
db.products.getIndexes()
```
```js
// npm run db:shell -- --analyst
db.products.findOne()                  // works
db.products.insertOne({ x: 1 })        // MongoServerError: not authorized
```
**Failover preview** (it's the viva demo later): run `docker stop mongo1`, wait ~10 s, then run `rs.status()` in `db:shell` and a new PRIMARY has been elected. Run `docker start mongo1`, and it rejoins as SECONDARY, then takes PRIMARY back because it has a higher priority.

### Viva questions
- **"What is a replica set and why do you need one?"** Copies of the same data on 3 nodes, automatic failover. Needed for transactions and high availability.
- **"What happens if the primary crashes?"** Election within seconds; the driver reconnects to the new primary; writes without majority acknowledgement could be rolled back.
- **"Replication vs sharding?"** Copies vs splits; availability vs scale.
- **"What is a time-series collection and why use it for events?"** Buckets and compression, built for time-range queries, built-in TTL.
- **"How is the analyst prevented from modifying data?"** Two layers: app-level role checks (Phase 3) and a database user with only the `read` role. Show the `database-access-control` evidence.
- **"Is MongoDB schemaless?"** No, it's *schema-flexible*. There's no schema by default, but you can add a `$jsonSchema` validator. We validate the shared base fields in the DB and the kind-specific ones in the app.

### Evidence
`evidence/01-foundation/`: containers, replica set status, database access control, collections and indexes, Redis persistence, API health.

### One-minute summary
> Three MongoDB nodes form a replica set with automatic failover, running with authentication and three least-privilege users; the analyst user can only read, and MongoDB itself rejects its writes. Telemetry goes into a time-series collection with a 90-day TTL. Consistency is tuned per operation using write concern and read preference.

---

## Phase 2: Catalog & storefront

### Concepts

**Polymorphic collection (one collection, many shapes).**
- All 7 product kinds live in `products`, told apart by a `kind` field (a *discriminator*).
- A phone has `chipset`, `batteryMah` and `cameras`. A screen protector has `material` and `packCount`. **Neither stores the other's fields.**
- The SQL alternatives are worse: one wide table full of NULLs, a table per kind (and UNIONs to list them together), or an EAV table (`product_id, attribute, value`) that is painful to query and can't type-check values.

**Mongoose discriminators.** One base schema (shared fields) plus one child schema per kind. Mongoose validates the kind-specific fields, then MongoDB's `$jsonSchema` validates the base fields.

**Two layers of validation:**

| Layer | Checks | Why here |
|---|---|---|
| Zod (API) | Query parameters, request bodies | Reject bad input before touching the DB |
| Mongoose (app) | Kind-specific product fields | Different rules per kind |
| `$jsonSchema` (MongoDB) | Base fields, `stock >= 0` | Last line of defence even if app code is wrong |

**Embedded variants.** Colour and storage options live *inside* the product document.
- **Why:** they're always shown with the product, there are only a few of them, and stock can be updated *atomically* in one document (important in Phase 4).
- **SQL equivalent:** a separate `product_variants` table plus a JOIN.

**Denormalised `basePrice`.** The lowest variant price, copied to the top level so listings can **sort and filter on one indexed field**. It's recomputed on every save (the `pre("validate")` hook).

**Indexes and the ESR rule.** An index is a sorted structure that lets MongoDB jump to matching documents instead of reading them all.
- Order compound index fields as **E**quality → **S**ort → **R**ange.
- `{kind: 1, basePrice: 1}`: equality on `kind`, then sorted by `basePrice`, which also serves price *range* filters. The query needs no in-memory sort.
- **Multikey index** (`compatibleModels`): indexing an array field indexes *each element*, so "accessories for this phone" is an index lookup.
- **Text index** with weights: name matches rank higher than description matches (`name: 10, brand: 5, description: 1`).

**Reading `explain()`:**

| Term | Meaning |
|---|---|
| `IXSCAN` | Walked an index (good) |
| `COLLSCAN` | Read every document (fine at 80 products, a disaster at 8 million) |
| `FETCH` | Loaded the full documents the index pointed to |
| `SORT` | Sorted in memory, because no index provided the order |
| `keysExamined` / `docsExamined` / `nReturned` | Ideal is all three roughly equal: you read only what you return |

**Aggregation pipeline.** Data flows through stages (`$match` → `$group` → `$project` …), like a Unix pipe.
- `/categories` uses `$group` to count products per kind.
- `/products/facets` uses **`$facet`** to compute brand counts *and* the price range in one pass.
- This is the tool that replaces GROUP BY (and, via `$lookup`, JOINs).

**Two-way compatibility without joins.**
- A phone's accessories: `{compatibleModels: phone.modelKey}` for cases and protectors, `{ports: phone.port}` for chargers, `{compatiblePlatforms: phone.os}` for watches.
- The reverse, an accessory's phones: `{modelKey: {$in: accessory.compatibleModels}}`.

### Read these files
1. [packages/shared/src/server/models/product.ts](../packages/shared/src/server/models/product.ts): base schema, variants, discriminators, `basePrice` hook.
2. [scripts/db/seed-data.ts](../scripts/db/seed-data.ts): skim one phone and one case, and see how cases point at `modelKey`.
3. [apps/api/src/routes/catalog.ts](../apps/api/src/routes/catalog.ts): every route has a comment naming its index. Know `/products`, `/search` and `/related`.
4. [apps/web/src/lib/specs.ts](../apps/web/src/lib/specs.ts): how the UI copes with the flexible schema (a different spec table per kind).
5. [apps/web/src/pages/CategoryPage.tsx](../apps/web/src/pages/CategoryPage.tsx): filters stored in the URL; TanStack Query fetches and caches.

### Try it yourself
```js
// npm run db:shell
db.products.findOne({ kind: "phone" })
db.products.findOne({ kind: "screen_protector" })          // compare the fields

db.products.find({ kind: "phone" }).sort({ basePrice: 1 }).explain("executionStats").executionStats
// then force a collection scan and compare totalDocsExamined:
db.products.find({ kind: "phone" }).sort({ basePrice: 1 }).hint({ $natural: 1 }).explain("executionStats").executionStats

db.products.find({ compatibleModels: "apple-iphone-16-pro" }, { name: 1 })
db.products.find({ $text: { $search: "magsafe" } }, { name: 1, score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } })

db.products.aggregate([{ $group: { _id: "$kind", n: { $sum: 1 }, from: { $min: "$basePrice" } } }])

db.products.insertOne({ kind: "laptop", slug: "x", name: "x", brand: "x", basePrice: 1, isActive: true, variants: [{ sku: "X", price: 1, stock: 1 }] })
// -> Document failed validation. Why? (kind is not in the enum)
```

### Viva questions
- **"How would you model this catalog in SQL, and why is MongoDB better here?"** NULL-heavy wide table, a table per kind, or EAV. In MongoDB each document holds just its own attributes, and a new product kind or attribute needs no migration (the `schema-validation` evidence shows a new attribute being accepted).
- **"If there's no fixed schema, how do you stop bad data?"** Three validation layers (table above). `stock >= 0` is enforced by the database itself.
- **"Why embed variants instead of a separate collection?"** Read together, bounded, and atomic single-document updates for stock.
- **"Isn't `basePrice` duplicated data? How does it stay correct?"** Yes, deliberately denormalised for indexed sorting, and recomputed on every save. Caveat: a raw `updateOne` bypasses the hook, so price changes must go through Mongoose.
- **"Explain the `{kind: 1, basePrice: 1}` index."** ESR: equality on kind, then basePrice serves both the sort and the price range. Show the `query-plans` evidence: 17 keys → 17 docs → 17 returned, versus the COLLSCAN reading 80 and adding a SORT stage.
- **"What's a multikey index?"** An index on an array field; one index entry per element.
- **"How does search rank results?"** Text index with weights, sorted by `textScore`.
- **"Why aren't the query times different?"** Only 80 documents. The meaningful metric is documents examined, which grows with data size for a COLLSCAN but not for an IXSCAN.

### Evidence
`evidence/02-catalog/`: polymorphic documents, schema validation, query plans (index vs COLLSCAN), and 6 storefront screenshots.

### One-minute summary
> All seven product types live in one `products` collection. Each document carries only its own attributes, so adding a product type needs no migration. Validation is layered: Zod at the API, Mongoose per kind, and MongoDB's `$jsonSchema` for the shared base fields, including `stock >= 0`. Variants are embedded for atomic stock updates, and `basePrice` is denormalised so listings sort on an index. Every storefront query is served by a purpose-built index following the ESR rule, and the explain plans prove it.

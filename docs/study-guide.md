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

---

## Phase 3: Auth, sessions & cart

### Concepts

**Key-value store (Redis).** Every piece of data is reached by its **key**, and the value has a type:

| Redis type | Used for | Commands you'll see |
|---|---|---|
| HASH (a small map of fields) | a cart (`sku → qty`), a session (`userId, role, …`) | `HSET`, `HGETALL`, `HINCRBY`, `HDEL` |
| SET (unique members) | all session ids of one user | `SADD`, `SMEMBERS`, `SREM` |
| any key + TTL | carts expire after 30 days, sessions after 7 d / 8 h | `EXPIRE`, `TTL` |

- No query language and no secondary indexes: you design the **key names** so that you always know the key you need (`cart:u:{userId}`, `sess:{id}`).
- It's in-memory, so reads and writes take well under a millisecond. It's persisted with AOF (Phase 1), so at most ~1 s of data could be lost in a crash.

**Why carts are in Redis, not MongoDB.**
- They change on nearly every click, are temporary (abandoned carts should just disappear), and are always fetched by one key.
- That's the key-value sweet spot. TTL handles cleanup for free, with no cron job and no delete query.
- **Prices are not stored in the cart.** The API joins the Redis quantities with *live* prices and stock from MongoDB on every view, so a cart can't lock in a stale price. That's a deliberate "reference, don't copy" decision, the opposite of order snapshots (Phase 4).

**Guest cart merge.** A guest gets a random cart id in a cookie (`cart:{cid}`). At login, each line is folded into the customer's cart with `HINCRBY`, and the guest key is deleted, inside a `MULTI` transaction (all commands run together).

**Server-side sessions vs JWT.**
- *Our design:* the browser holds only a random 256-bit id in an **httpOnly** cookie (JavaScript can't read it, which protects against XSS). The session data lives in Redis.
- *JWT:* the token itself contains the user data, signed. Nothing needs to be stored on the server, but **it can't be revoked** before it expires.
- **Revocation (UC4):** each user's session ids are kept in a SET, so "log this user out everywhere" is: read the set, delete those keys. The very next request fails. That's the trade-off that justifies Redis here.

**RBAC (role-based access control) in the API:**
- `requireAuth` → **401** if there's no valid session.
- `requireRole("admin")` → **403** if you're logged in but have the wrong role.
- This is the *application* layer. The *database* layer (the read-only analyst user) was Phase 1. Two layers = defence in depth.

**Password storage.** Never store passwords, only a slow, salted hash.
- **scrypt** (built into Node) is deliberately slow and memory-hard, so brute-forcing a leaked hash is expensive.
- A random salt per user means identical passwords give different hashes.
- `timingSafeEqual` compares hashes in constant time, so response timing doesn't leak how many bytes matched.
- The same error message for "no such email" and "wrong password" means the login form doesn't reveal which accounts exist.

**Identity stitching (preview of Phase 5).**
- Every request carries `X-Anonymous-Id` (one per browser) and `X-Session-Id` (one per visit, renewed after 30 min of inactivity).
- At login, the anonymous id is added to `users.anonymousIds` with `$push` + `$each` + `$slice: -20`: a **bounded array**, so the embedded list can never grow without limit. That's the embedding rule from Phase 0 in action.

### Read these files
1. [apps/api/src/lib/sessions.ts](../apps/api/src/lib/sessions.ts): the session key layout, `createSession`, `revokeAllSessions`.
2. [apps/api/src/middleware/session.ts](../apps/api/src/middleware/session.ts): how `req.user` is loaded; `requireAuth` vs `requireRole`.
3. [apps/api/src/lib/cart.ts](../apps/api/src/lib/cart.ts): cart keys, `loadCart` (Redis + MongoDB join), `mergeGuestCart`.
4. [apps/api/src/routes/auth.ts](../apps/api/src/routes/auth.ts): login flow: verify → session → link anonymous id → merge cart.
5. [packages/shared/src/server/auth.ts](../packages/shared/src/server/auth.ts): scrypt hashing (about 20 lines).
6. [apps/web/src/lib/identity.ts](../apps/web/src/lib/identity.ts): where the anonymous and session ids come from.

### Try it yourself
Add a couple of items to the cart in the browser (logged out), then:
```bash
npm run redis:cli
```
```
SCAN 0 MATCH cart:* COUNT 100        # find your guest cart key
HGETALL cart:<id>                    # sku -> qty
TTL cart:<id>                        # seconds until it expires (~30 days)
```
Log in as `customer@cellora.test` and run `SCAN 0 MATCH cart:* COUNT 100` again: the guest key is gone and `cart:u:<userId>` holds the merged items.
```
SCAN 0 MATCH sess:* COUNT 100
HGETALL sess:<id>                    # userId, role, name, email, createdAt
TTL sess:<id>                        # 604800 = 7 days for customers, 28800 = 8 h for staff
DEL sess:<id>                        # refresh the browser: you're logged out instantly
```

### Viva questions
- **"Why use Redis for carts and sessions instead of MongoDB?"** Frequent small writes, temporary data with a natural expiry (TTL), and always looked up by a single key: the key-value sweet spot, served from memory. For sessions specifically: instant revocation.
- **"What happens to a cart if Redis crashes?"** AOF with `everysec`: at most ~1 s of changes lost. Acceptable for carts (the customer re-adds an item); that's why **orders are never stored only in Redis**.
- **"Why not JWT?"** A JWT can't be revoked before it expires. UC4 needs "remove access now". Server-side sessions trade a Redis lookup per request for that ability.
- **"Why don't you store the price in the cart?"** So the displayed and charged price is always the current one. Compare with orders, which *do* copy prices because an order is a historical record.
- **"How do you stop an analyst calling admin endpoints?"** `requireRole` returns 403 (show the `rbac-matrix` evidence), and even if that failed, the analyst's database login can't write (Phase 1).
- **"How are passwords stored?"** scrypt with a per-user random salt, compared in constant time; the same error for an unknown email and a wrong password.
- **"What's `$slice: -20` doing in the login code?"** Keeps the embedded `anonymousIds` array bounded, following the embed-only-if-bounded rule.

### Evidence
`evidence/03-auth-cart/`: RBAC matrix, guest cart merge (Redis before/after), session revocation (with audit log), user document, and 4 screenshots.

### One-minute summary
> Redis holds the fast, temporary, key-addressed data. Carts are hashes of SKU to quantity with a 30-day TTL, merged from guest to customer at login, and always priced live from MongoDB. Sessions are Redis hashes behind an httpOnly cookie, indexed per user in a set, so an admin can revoke them instantly, which a JWT can't do. The API enforces roles with 401/403, backed by the read-only database user from Phase 1. Passwords are scrypt-hashed with per-user salts.

---

## Phase 4: Checkout & orders

### Concepts

**Atomic single-document operations.**
- Every write to *one* MongoDB document is atomic: the filter and the update happen as one indivisible step.
- The checkout relies on this:
  ```js
  updateOne(
    { _id, variants: { $elemMatch: { sku, stock: { $gte: qty } } } },   // only if enough stock
    { $inc: { "variants.$.stock": -qty } }                               // "$" = the matched variant
  )
  ```
- If two customers race for the last unit, only one can match `stock >= 1`. The other gets `matchedCount: 0`.
- **This is why variants are embedded** (Phase 2): the stock lives inside the product document, so one atomic update is enough.

**The lost-update bug (why "read, check, write" is wrong).** If the app does `stock = find(); if (stock >= 1) set(stock - 1)`, all 20 buyers read "1" before anyone writes, so all 20 "buy" it. The evidence shows **18 units sold of 1**. The fix is to let the database do the check and the write together (the conditional update above).

**Multi-document ACID transactions.**
- A checkout touches several documents: one product per cart line, plus the new order. Either **all** of these writes happen or **none** do.
- `session.withTransaction(fn)` commits at the end, **aborts** if `fn` throws (we throw `OutOfStock`), and **retries** automatically on transient errors such as a write conflict with a concurrent checkout.
- **Rollback in the evidence:** inside the transaction the charger's stock went 108 → 107; then the phone was sold out → abort → back to 108.
- They **require a replica set.** That's one reason we run three nodes (Phase 1).
- **Trade-off:** transactions add latency and contention. MongoDB's guidance is to use them only when a single-document operation isn't enough. We use exactly one: checkout.

| ACID | What it means in the checkout |
|---|---|
| **A**tomic | Stock decrements + order insert: all or nothing |
| **C**onsistent | Validator: stock can never be negative; the order always matches the stock taken |
| **I**solated | `readConcern: "snapshot"`: the transaction sees one consistent point in time |
| **D**urable | `writeConcern: { w: "majority" }`: committed on 2 of 3 nodes, so it survives a primary crash |

**Tunable consistency, in practice.** Orders use `w: "majority"` (slower, safe). Telemetry events will use `w: 1` (fast; losing one click on a failover is acceptable). You choose per operation. Relational databases usually give you one global setting.

**Embedded snapshot vs reference (the opposite of the cart).**
- An **order** copies name, variant and unit price into `items`. It's a *historical record*: if the product is repriced tomorrow, the order must still show what was paid.
- A **cart** stores only `sku → qty` and looks up live prices (Phase 3).
- Same data, opposite decisions, both justified by how the data is used. **Great viva point.**

**Order numbers from a counter document.**
- MongoDB has no auto-increment. The pattern: `findOneAndUpdate({_id: "order-20260928"}, {$inc: {seq: 1}}, {upsert: true})`. It's atomic, so no duplicates.
- It's kept **outside** the transaction on purpose: every checkout hits that one document, and inside a transaction it would become a write-conflict hotspot. A failed checkout leaves a gap in the numbers (e.g. 0001 → 0021 after the race), which is harmless.

**Server-side events.** `order_placed` and `checkout_failed` are emitted by the API, not the browser. They're **trusted** (a browser could fake a "purchase" event) and appended to the Redis Stream `events:ingest` with `XADD … MAXLEN ~ 100000`. Phase 5's worker moves them into MongoDB.

**Guest checkout.** `customerId: null` plus `guestEmail`. A guest can view the order only from the same browser session (`sessionId` matches), so order numbers can't be guessed to see other people's orders.

### Read these files
1. [apps/api/src/routes/checkout.ts](../apps/api/src/routes/checkout.ts): **the most important file for the viva.** Read the transaction block line by line.
2. [packages/shared/src/server/models/order.ts](../packages/shared/src/server/models/order.ts): the snapshot line items and the embedded `statusHistory`.
3. [apps/api/src/lib/telemetry.ts](../apps/api/src/lib/telemetry.ts): `emitServerEvent` → `XADD`.
4. [scripts/evidence/captures/checkout.ts](../scripts/evidence/captures/checkout.ts): sections 1–3 are the race experiments. Understand what each proves.

### Try it yourself
```js
// npm run db:shell
db.orders.find({}, { orderNumber: 1, "totals.total": 1, status: 1 }).sort({ createdAt: -1 }).limit(3)
db.orders.findOne({}, { items: 1 })                 // the embedded snapshot
db.counters.find()                                  // the order-number sequences
db.products.findOne({ "variants.sku": "IP16PM-1T-DT" }, { "variants.$": 1 })   // the contested phone

// Try the conditional update yourself (run twice: the second matches 0 documents)
db.products.updateOne({ variants: { $elemMatch: { sku: "IP16PM-1T-DT", stock: { $gte: 1 } } } }, { $inc: { "variants.$.stock": -1 } })
db.products.updateOne({ "variants.sku": "IP16PM-1T-DT" }, { $set: { "variants.$.stock": 1 } })   // put it back
```
```bash
npm run redis:cli
XLEN events:ingest
XREVRANGE events:ingest + - COUNT 2
```
Then re-run the race and read the output: `npm run evidence -- checkout`.

### Viva questions
- **"How do you prevent overselling?"** A conditional atomic update (`$elemMatch` with `stock >= qty`, plus `$inc`) inside a transaction. Quote the evidence: 20 buyers, 1 unit, 1 order and 19 × 409; the naive approach sold 18.
- **"Doesn't NoSQL mean no transactions?"** Not for MongoDB: multi-document ACID transactions since 4.0, on replica sets. But they cost performance, so the design keeps them to the one place that needs them. Single-document writes are always atomic anyway.
- **"What happens if the second item is out of stock after the first was decremented?"** The transaction aborts and the first decrement is rolled back (`transaction-rollback` evidence).
- **"Why `w: majority` for orders?"** So a committed order survives the primary crashing: it's on at least 2 of 3 nodes. With `w: 1` a failover could roll back an acknowledged order.
- **"Why copy prices into the order but not into the cart?"** Order = historical record (snapshot); cart = current intent (live lookup).
- **"How do you generate sequential order numbers without auto-increment?"** An atomic `$inc` on a counter document; outside the transaction to avoid a hotspot; gaps are fine.
- **"Why are purchase events sent from the server, not the browser?"** Trust: client events can be forged or blocked by ad-blockers. Revenue analytics must come from the server.

### Evidence
`evidence/04-checkout/`: naive vs atomic overselling, transaction rollback, the 20-way checkout race, the order document, server events in the stream, and 3 screenshots.

### One-minute summary
> Checkout is the one place I use a multi-document ACID transaction: for each cart line, a conditional atomic update decrements stock only if enough remains, then the order is inserted with an embedded snapshot of the items, all committed with majority write concern. If any item has sold out, the whole transaction rolls back. In a 20-way race for the last unit, exactly one customer wins; a naive read-then-write approach sold 18 units of 1. Orders copy prices because they're historical records; carts don't because they must stay current.

---

## Phase 5: Telemetry pipeline

This is the heart of the NoSQL story. Know this flow by heart:

```
browser tracker ──POST /api/events──▶ API ──XADD──▶ Redis Stream ──XREADGROUP──▶ worker ──insertMany──▶ MongoDB time-series
   (batches, sendBeacon)          (validate, 202)   events:ingest   (consumer group)   (+ counters, XACK)        events
```

### Concepts

**Why not write straight to MongoDB from the API?** Decoupling.
- The request path only validates and appends to an in-memory log, then answers **202 Accepted** ("I've got it, it'll be processed").
- A traffic spike fills the stream buffer instead of slowing the storefront.
- MongoDB receives **big batches** (up to 500 per `insertMany`), which are far cheaper than one insert per click.
- **Evidence:** the API accepted 20,000 events in 0.66 s (~30k/s); the worker stored them all within ~3.2 s (~6.3k/s). The gap between the two *is* the buffering.
- This is **eventual consistency** on purpose: an event shows up in MongoDB a moment after it happened.

**Redis Streams.** An append-only log inside Redis.
- `XADD` appends an entry with an auto-generated, time-ordered id (`1790534475814-7`).
- `MAXLEN ~ 100000` caps its length. The `~` means "approximately", which makes trimming cheap.
- Entries stay in the stream after they're processed; it's a log, not a queue that empties.

**Consumer groups (the key concept):**
- A group (`ingest-workers`) tracks which entries have been **delivered** to which consumer and which have been **acknowledged**.
- `XREADGROUP … >` = "give me entries nobody in my group has seen". Add more workers to the same group and they **share** the work: horizontal scaling.
- Each delivered entry sits in the **Pending Entries List** until `XACK`.
- `XAUTOCLAIM` = "hand me entries that another consumer took more than 60 s ago and never acknowledged" (it probably crashed). That's the recovery path.

**Delivery guarantees.** Say these precisely:

| Guarantee | Meaning | Here? |
|---|---|---|
| At most once | may lose, never duplicates | no |
| **At least once** | never loses (once in the stream), may duplicate | **yes**: ack only *after* `insertMany` succeeds |
| Exactly once | neither | hard; needs idempotent writes |

- Why duplicates are possible: the worker could crash after inserting but before acknowledging, so the entry is redelivered.
- A time-series collection **can't have a unique index**, so MongoDB can't reject the duplicate.
- **Mitigation:** the worker remembers inserted `eventId`s for an hour (`seen:{eventId}` keys in Redis) and skips repeats. It's best effort, and this is a *limitation* for the report.

**Dead-letter stream.** An entry that can't even be parsed is moved to `events:dead` and acknowledged, so one poisoned message can't block the pipeline forever.

**Two write paths, two trust levels:**
- *Client events* (`page_view`, `add_to_cart`…) are validated per event with Zod, and bad ones are dropped individually. They're **untrusted**: a user could fake them or an ad-blocker could drop them.
- *Server events* (`order_placed`, `checkout_failed`) are emitted by the API itself, so they're trusted. Revenue numbers must come from these.
- `customerId` is **never** taken from the browser; the API derives it from the session cookie.

**The tracker (browser side):**
- Events are queued and sent in batches (every 4 s or 20 events), fewer requests than one per click.
- `navigator.sendBeacon` on page hide/close: the browser delivers it even while the page unloads. It can't set custom headers, so identity travels in the request body.
- `useTrackView` de-duplicates "view" events per navigation (React StrictMode runs effects twice in development).

**Identity stitching, end to end:**
- Before login, events have `meta.customerId: null`.
- The `identify` event reaches the worker, which runs `updateMany({"meta.anonymousId": a, "meta.customerId": null}, {$set: {"meta.customerId": id}})`.
- This is **allowed on a time-series collection only because it touches the `metaField`**. That's the reason identity lives in `meta` (data-model §4.4).
- **Evidence:** 12 of 12 pre-login events linked.

**Live counters with Redis (UC1: "real-time customer activity"):**
- `INCR evt:{type}:{minute}` counts events per minute.
- `PFADD active:{minute} sessionId` adds to a **HyperLogLog**, a probabilistic structure that counts *distinct* items in **12 KB max** (112 bytes here) with about 0.81% error, however many sessions there are.
- "Active users in the last 5 minutes" = `PFCOUNT` over 5 keys, which merges them. An exact count would need to store every session id.
- Keys expire after 2 hours (TTL), so there's no cleanup job.

**Time-series collection, in use.**
- Events with the same `meta` (same browser/session) are stored together in compressed **buckets**, so a session's timeline is cheap to read (UC12).
- Deletes by `meta` field are allowed. The benchmark cleans up with `deleteMany({"meta.anonymousId": …})`, and right-to-erasure requests (UC15) will use the same mechanism.

### Read these files
1. [apps/web/src/lib/tracker.ts](../apps/web/src/lib/tracker.ts): queue, batch, flush, sendBeacon.
2. [apps/api/src/routes/events.ts](../apps/api/src/routes/events.ts): per-event validation, enrichment, pipelined `XADD`, 202.
3. [apps/worker/src/ingest.ts](../apps/worker/src/ingest.ts): **read all of it**: `ensureGroup`, `run` (XREADGROUP loop), `recoverPending` (XAUTOCLAIM), `process` (parse → dedupe → insertMany → counters → stitching → XACK).
4. [packages/shared/src/events.ts](../packages/shared/src/events.ts): the event catalogue again, now you know where each event is sent.
5. `evidence/05-telemetry/session-timeline.md`: a real session, event by event.

### Try it yourself
Open http://localhost:5173 in a private window, click around, then:
```bash
npm run redis:cli
XINFO GROUPS events:ingest          # pending should be 0, lag 0
XREVRANGE events:ingest + - COUNT 3
XPENDING events:ingest ingest-workers
KEYS evt:all:*                      # fine on a dev box; use SCAN in production
PFCOUNT active:<the latest minute key>
```
```js
// npm run db:shell
db.events.find().sort({ ts: -1 }).limit(5)
db.events.aggregate([{ $group: { _id: "$type", n: { $sum: 1 } } }, { $sort: { n: -1 } }])
db.events.find({ "meta.sessionId": "<a sessionId from above>" }).sort({ ts: 1 })
db.events.stats().timeseries          // buckets, bucket count, compression details
```
**Crash test:** stop the worker (Ctrl+C in its terminal), browse a bit, and run `XINFO GROUPS events:ingest`: `lag` grows (events waiting). Start the worker again and it catches up, with nothing lost.

### Viva questions
- **"Walk me through what happens when a customer clicks 'Add to cart'."** API updates the Redis cart → the browser tracks `add_to_cart` → batched to `/api/events` → validated, `XADD` to the stream, 202 → worker `XREADGROUP` → `insertMany` into the time-series collection → counters → `XACK`.
- **"Why have a queue between the API and MongoDB?"** Decoupling and buffering spikes, batching writes, fast responses. Quote the 30k/s vs 6.3k/s evidence.
- **"What if the worker crashes?"** Unacknowledged entries stay pending; when it restarts (or another worker takes over via `XAUTOCLAIM`) they're processed. At least once, so possible duplicates, mitigated by `eventId` de-duplication.
- **"Why not Kafka?"** Kafka is the industry standard at scale (partitions, long retention, replay across many services). Redis Streams give the same consumer-group model with a store we already run for other reasons. At this scale, adding Kafka would add a system without a use case, the same rule that excluded Cassandra.
- **"What is a HyperLogLog and why use it?"** A probabilistic distinct counter: fixed ≤12 KB of memory, ~0.81% error, and mergeable across minutes. Perfect for "active users now", where exactness doesn't matter.
- **"How can you update events if time-series collections are append-only?"** Updates and deletes are allowed when they filter or modify only the `metaField`; that's why identity is stored there.
- **"Can users fake events?"** Client events, yes. That's why purchases are server-side events and `customerId` comes from the session, not the request body.

### Evidence
`evidence/05-telemetry/`: session timeline (a real 18-event browser session), identity stitching, event document, ingest throughput (20,000 events), stream/consumer group/live counters, journey screenshot.

### One-minute summary
> The browser batches telemetry to `/api/events`. The API validates each event, enriches it with device and server-side identity, appends it to a Redis Stream and replies 202, so ingestion never slows the store. A worker in a consumer group reads the stream in batches of up to 500, bulk-inserts into MongoDB's time-series collection, updates per-minute counters and HyperLogLogs for "active now", links anonymous events to the customer after login, and only then acknowledges. That gives at-least-once delivery with crash recovery through `XAUTOCLAIM`, and best-effort de-duplication. On a laptop it accepted 30k events/s and stored 6.3k/s.

---

## Phase 6: Traffic simulator

### Concepts

**Why simulate at all?** Analytics needs volume. An empty dashboard proves nothing, and performance claims about indexes, rollups and caching only mean something with real data sizes. The simulator produced **~13,000 sessions, ~99,000 events and ~600 orders over 14 days**.

**It uses the real pipeline, not a shortcut.**
- **Backfill mode** builds historical sessions and `XADD`s their events into the **same Redis Stream**, so the **same worker** ingests them (including identity stitching). Events are validated with the **same Zod schemas** as the API.
- **Live mode** goes further: simulated shoppers call the real HTTP API (search, cart, login, checkout), so orders, stock and server events are all genuine.
- Simulated records are flagged (`events.sim: true`, `orders.simulated: true`, users `sim-NNN@cellora.test`) so they can be removed with `--reset`. Honest labelling of test data is itself a good practice to mention.

**Backpressure (worth explaining in the viva).**
- The stream is capped at `MAXLEN ~ 100000`. If the simulator pushed faster than the worker reads, Redis would **trim entries that were never processed**: silent data loss.
- So the backfill checks the consumer group's lag (`XINFO GROUPS`) and pauses while more than 30,000 entries are waiting.
- **Report angle:** a capped stream trades memory safety for possible loss under sustained overload. That's a real *limitation*, and why systems like Kafka keep data on disk with retention by time instead.

**The behaviour model** ([scripts/simulate/model.ts](../scripts/simulate/model.ts)):
- **Funnel probabilities:**
  - 25% of sessions bounce after the landing page.
  - Each viewed product is added to the cart with a 5% chance on mobile and 8.5% on desktop; returning customers are more likely.
  - 50% of carts reach checkout, and 80% of those submit payment.
  - Of submitted payments, 90% succeed, 6% are declined and 4% hit sold-out stock.
- **Result:** ~4.7% of sessions order. That's realistic for e-commerce, where 2–5% is typical.
- **Shape:**
  - traffic peaks in the Sri Lankan evening, weekends are 25% busier, and a promotion day has 1.8× the traffic
  - devices are 62% mobile, 32% desktop and 6% tablet
  - after viewing a phone, shoppers often look at an accessory that fits it
- **Seeded randomness:** the same seed produces the same dataset, so results are reproducible.

**What the data revealed** (evidence you can quote):
- **Time-series storage:** buckets hold on average only **7.4 events**, so it's just ~22% smaller on disk than a regular collection (9.4 MB vs 12.1 MB). The indexes are *larger*: four secondary indexes vs `_id` only.
  - That's the **metaField cardinality trade-off**: `sessionId` in `meta` means every session gets its own buckets. You'd get far better compression with low-cardinality meta (e.g. `type`), but then session timelines and erasure deletes by customer would be expensive.
  - It's a design decision with a measured cost. Excellent limitations material.
- **Text search limitation:** "iphone 17" (a phone the store doesn't sell) returns **25 results**, because `$text` matches *any* word and "iphone" alone matches every iPhone. There's no phrase matching or typo tolerance, which is where a dedicated search engine would come in.
- **Raw-aggregation baseline:** funnel counts computed by scanning all 99k events take a median of **~106 ms**, and that grows linearly as data grows. Phase 7 will beat this with rollups and a cache.

### Read these files
1. [scripts/simulate/model.ts](../scripts/simulate/model.ts): `FUNNEL`, `planSession`. Understand how a session is planned.
2. [scripts/simulate/backfill.ts](../scripts/simulate/backfill.ts): `sessionEvents` (plan → events + order), the `lag()` backpressure loop, order numbers from the shared counter.
3. [scripts/simulate/live.ts](../scripts/simulate/live.ts): the same plan replayed through real API calls.

### Try it yourself
```bash
npm run sim:live -- --rate 30 --speed 0.05 --minutes 2      # watch the worker log ingest in real time
```
```js
// npm run db:shell
db.events.countDocuments()
db.events.countDocuments({ sim: true })
db.events.aggregate([{ $match: { type: "search", "props.resultCount": 0 } }, { $group: { _id: "$props.query", n: { $sum: 1 } } }])
db.orders.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }])
db.events.aggregate([{ $collStats: { storageStats: {} } }]).next().storageStats.timeseries.bucketCount
```

### Viva questions
- **"Where does your data come from?"** A seeded behaviour simulator: backfill pushes through the real stream and worker, and live mode uses the real HTTP API. It's clearly flagged as simulated and removable.
- **"How realistic is it?"** Funnel rates from typical e-commerce ranges (~4.7% conversion), mobile-first device mix, evening peaks, a promo spike, catalog-aware browsing. But it's still a model, so real users would be messier.
- **"What would happen if you pushed events faster than the worker could process them?"** The stream grows; beyond `MAXLEN` the oldest entries are trimmed even if unread (data loss). Hence the backpressure, and more consumers or a disk-based log (Kafka) at scale.
- **"Did the time-series collection compress well?"** Only ~22% smaller, because high-cardinality `sessionId` in `meta` gives small buckets (7.4 events each). That trade-off was chosen to make session timelines and per-customer deletes cheap.
- **"Any limitation you discovered?"** Text search OR-matching ("iphone 17" returns 25 iPhones).

### Evidence
`evidence/06-simulator/`: daily volume and conversion, event/device/search breakdowns, raw-aggregation baseline, time-series vs regular storage.

### One-minute summary
> A seeded simulator generated two weeks of realistic traffic (13k sessions, 99k events, 600 orders, about 4.7% conversion, mobile-first) and pushed it through the real Redis Stream and worker, with backpressure so the capped stream never drops unprocessed events. A live mode drives real shoppers through the HTTP API for demos. The data exposed two honest limitations: time-series buckets are small (7.4 events) because of the high-cardinality metaField, so compression is modest, and `$text` search matches any word. It also set a 106 ms baseline for raw funnel aggregation, which the Phase 7 rollups will improve on.

---

## Phase 7: Rollups (pre-aggregation) & caching

### Concepts

**The problem.** Dashboards ask the same big questions again and again ("how many sessions reached checkout in the last 14 days?"). Answering from raw events means scanning ~94,000 documents every time, and that cost **grows with every event**. At a million events a day it would become unusable.

**The NoSQL answer: pre-compute (materialised views).**
- A background job periodically aggregates raw events into small summary collections.
- Dashboards read those instead. The work is done once per interval, not once per page view.

| Rollup | One document per… | Used by |
|---|---|---|
| `session_summaries` | session (landing page, device, steps reached, orders) | Support session lists (UC12) |
| `metrics_hourly` | local hour × event type (count, distinct sessions) | Analyst trends (UC1, UC3) |
| `funnel_daily` | day (ordered funnel, overall + per device) | Analyst funnel (UC2) |

**How: aggregation + `$merge`.**
- Each rollup is one aggregation pipeline over `events` ending in **`$merge`**, which *upserts* each result into the target collection: `whenMatched: "replace"`, `whenNotMatched: "insert"`.
- The whole thing runs **inside the database**; no data travels to Node.

**Incremental, not full.**
- Every 5 minutes the worker recomputes only the recent window (from the last run, minus a 10-minute overlap for late-arriving events).
- Buckets are always recomputed *whole* (whole hours, whole days). Recomputing half a bucket would overwrite it with a partial count. I hit exactly this bug with Sri Lanka's +5:30 offset, and fixed it by shifting into local time before truncating.
- **Evidence:** full rebuild ~500 ms, incremental ~30 ms. The cost tracks new data, not total history.

**The ordered funnel** (the most complex query; know it):
1. `$match` the four funnel event types.
2. `$group` by session: the **first time** it did each step (`$min` of a `$cond`; `$min` ignores nulls).
3. `$set` s1…s4: a step only counts if the **previous step happened earlier** (`$gte` on the timestamps).
4. `$group` by local day and device and sum, then `$group` by day into `steps` + `byDevice`.
5. `$merge` into `funnel_daily`.
- **SQL equivalent:** window functions or several self-joins on an events table. Here it's one pipeline over one collection.

**Caching layer (Redis).**
- `GET /api/analytics/funnel` first checks `cache:funnel:{hash of params}`. On a miss it reads the rollup, stores the JSON with a **60-second TTL**, and returns it. That's a *read-through cache*.
- **Evidence (14-day funnel):**

| Path | Median |
|---|---|
| raw pipeline over 94k events | 144 ms |
| reading 14 rollup docs | 2.2 ms (65× faster) |
| API cache miss | 14 ms |
| API cache hit | 2.5 ms |
| bare Redis GET | 0.2 ms |

- The rollup matches the raw computation **exactly** at every step (correctness evidence).

**Eventual consistency: the price you pay.**
- Rollups are up to 5 minutes stale, and the cache adds up to 60 s.
- **Evidence:** a new order appears in raw events within about a second, the rollup still shows 8 orders, and after the next rollup run both show 9.
- That's **BASE** (eventually consistent) and is fine for analytics. For money and stock we use transactions instead (Phase 4). **Choosing consistency per use case** is the key idea.

**The analyst reads from a secondary.** Analytics runs on the `da2_analyst` connection (`secondaryPreferred`, read-only), so dashboard load never competes with checkouts on the primary. That's another form of the consistency trade-off (replication lag), and another use of the replica set.

### Read these files
1. [apps/worker/src/rollups.ts](../apps/worker/src/rollups.ts): the three pipelines. **Understand `funnelPipeline` step by step.**
2. [apps/worker/src/index.ts](../apps/worker/src/index.ts): the scheduler (incremental interval, full rebuild on demand).
3. [apps/api/src/lib/cache.ts](../apps/api/src/lib/cache.ts): the read-through cache in ~10 lines.
4. [apps/api/src/routes/analytics.ts](../apps/api/src/routes/analytics.ts): reads the rollup through the analyst connection, behind the cache.

### Try it yourself
```js
// npm run db:shell
db.funnel_daily.find().sort({ _id: -1 }).limit(1)
db.session_summaries.find({ "reached.orderPlaced": true }).limit(1)
db.metrics_hourly.find({ "_id.type": "order_placed" }).sort({ "_id.hour": -1 }).limit(5)
db.settings.findOne({ _id: "rollups" })          // when the worker last ran them, and how long it took
```
```bash
npm run redis:cli
KEYS cache:*            # after opening the analyst funnel (Phase 8) or calling the API
TTL <one of the keys>   # counts down from 60
SET rollups:rebuild 1   # the worker does a full rebuild within 15 s (watch its log)
```

### Viva questions
- **"Why not just query the raw events for the dashboard?"** It works now (144 ms) but grows linearly with data. Rollups turn it into reading a few small documents (2.2 ms), whatever the history size. Pre-aggregation is a standard NoSQL analytics pattern.
- **"What is `$merge`?"** The aggregation stage that writes results into a collection with upsert semantics, so an aggregation can maintain a materialised view incrementally.
- **"How do you know the rollups are correct?"** The evidence compares the same funnel from raw events and from rollups: identical at all four steps.
- **"What's the downside?"** Staleness (up to one interval plus cache TTL), extra storage, and another moving part (the scheduler), plus a rebuild if the logic changes. Show the eventual-consistency evidence.
- **"Explain your funnel query."** First-time-per-step with `$min`/`$cond`; ordered via timestamp comparisons; grouped by day and device; merged.
- **"Why is the cache TTL 60 seconds?"** It bounds staleness while absorbing repeated dashboard loads. Rollups only change every 5 minutes anyway, so a longer TTL would add staleness without much benefit.

### Evidence
`evidence/07-rollups/`: raw vs rollup vs cache (with the correctness check), rollup run cost, sample rollup documents (hourly curve with the evening peak), eventual consistency observed.

### One-minute summary
> Dashboards don't scan raw events. The worker maintains three materialised views (session summaries, hourly metrics and an ordered daily funnel) using aggregation pipelines that end in `$merge`, recomputing only the recent window every 5 minutes. The API reads them through the read-only analyst connection from a secondary node, behind a 60-second Redis read-through cache. The 14-day funnel drops from 144 ms (raw) to 2.2 ms (rollup) or 2.5 ms (cache hit through the API), with identical numbers. The trade-off is eventual consistency, and the evidence shows a new order appearing in the rollup only after its next run.

---

## Phase 8: Staff dashboards (Analyst, Support, Admin)

### Concepts

**Where does each dashboard read from, and why?** This is the most likely viva question for this phase. Every choice is a trade-off between freshness, cost, and load on the primary:

| Dashboard | Reads from | Connection | Why |
|---|---|---|---|
| Live activity (UC1) | Redis counters (`active:{m}` HyperLogLog, `evt:{type}:{m}`) + latest events | analyst (secondary) | Counting in Redis is O(1) and already done by the worker; no scan at all |
| Funnel (UC2) | `funnel_daily` rollup | analyst (secondary) | Pre-computed: a few dozen small documents |
| Trends (UC1) | `metrics_hourly` rollup | analyst (secondary) | Pre-computed per local hour |
| Top products / searches | raw `events`, `{type, ts}` index | analyst (secondary) | Flexible query; slow-ish (≈110 ms), so behind the 60 s cache |
| Support: session timeline | raw `events`, `{meta.sessionId, ts}` | **primary** | Must be up to the second while the customer is on the phone |
| Support: notes | `session_notes` | **primary** | Read-your-writes: the agent must see the note they just saved |
| Admin: health | `replSetGetStatus`, `serverStatus`, Redis `INFO`, `XINFO` | primary | Live system state |

- **Analyst → secondary, read-only.** The evidence shows the query was served by `:27018` (a secondary) while the primary is `:27017`, and that an insert through the analyst connection fails with *not authorized*. There are two protections: dashboard load never slows checkouts, and even buggy code can't write.
- **Support → primary.** Replication lag (usually well under a second) is fine for charts but not for "I just added a note and it's not there".

**HyperLogLog: "how many people are on the site right now?"**
- Each minute the worker does `PFADD active:{minute} sessionId`. An HLL estimates *distinct* members in a fixed ~12 KB (here only 160 bytes, because small HLLs use a sparse encoding), with ~0.8% error.
- `PFCOUNT key1 … key5` counts the **union**. A session active in 3 of the last 5 minutes counts once.
- **Evidence:** summing the minutes gives 66 (wrong, double counts), the union gives 57, and the exact distinct count from MongoDB is 57.
- A SQL equivalent would be `COUNT(DISTINCT session_id) … WHERE ts > now() - 5 min` over the events table, every 5 seconds.

**Caching (read-through) on every analyst endpoint.**
- 5 s TTL for live, 60 s for the rest. With 10 analysts polling live every 5 s, MongoDB does the work once per 5 s, not 10 times.
- Measured (`dashboard-timings`): raw-events aggregation 112 ms on a miss vs about 3 ms on a hit; rollup reads are 6–70 ms on a miss.

**A performance bug found and fixed (a good story for the viva).**
- The trends endpoint took ~550 ms. Profiling showed MongoDB took 1 ms; the time went on `toLocaleDateString(…, {timeZone})` called 2,400 times (Intl formatting is slow). Replacing it with offset arithmetic brought it to ~80 ms.
- The same investigation found a COLLSCAN: `metrics_hourly`'s `_id` is a compound `{hour, type}`, and **the `_id` index can't serve a range on `_id.hour` alone**. Fix: a separate index `{"_id.hour": 1}`.
- The lessons: measure before guessing, and a compound `_id` is not the same as a compound index on its fields.

**PII masking (data minimisation).**
- Support sees `c***r@cellora.test`, `••• ••• 4567`, and the street hidden but the city kept (useful for delivery questions). Admin sees everything.
- It's done in the **API response** (`lib/pii.ts`), so unmasked data never reaches a support browser. Hiding it with CSS would still send it.

**RBAC: UI vs API.**
- The sidebar only shows links your role may use, but that's cosmetic. `requireRole()` on every route is the real control (`rbac-dashboards` matrix: 401 anonymous, 403 wrong role).
- **Role change revokes sessions.** The role is copied into the Redis session hash at login, so after an admin changes a role, the old session would keep the old role until it expired. So the API revokes the user's sessions, and the evidence shows the old cookie returning `{user: null}` immediately. This is the same reason Phase 3 chose server-side sessions over JWTs.

**Retention (UC5) with `collMod`.** Saving "keep events for 60 days" runs `db.runCommand({collMod: "events", expireAfterSeconds: 5184000})`. MongoDB's TTL monitor then deletes whole **buckets** once every event in them has expired. There's no cron job or batch delete code, a NoSQL feature built for telemetry.

**Rollup rebuild (UC6): API asks, worker does.** `POST /admin/rollups/rebuild` only `SET`s `rollups:rebuild` in Redis and returns **202 Accepted**. The worker's 15 s scheduler `GETDEL`s it and runs the full rebuild (≈0.9 s here). Long jobs don't belong in an HTTP request.

**`$indexStats` (UC6).** It shows how many times each index was used since the server started, on that node. Zero-use indexes are candidates for removal, since each index costs RAM and slows writes. Two caveats: counts reset on restart and are per node.

**Which law? Sri Lanka's PDPA, not GDPR.** Cellora only sells in Sri Lanka, so the relevant law is the **Personal Data Protection Act, No. 9 of 2022**. GDPR only reaches non-EU shops that target or monitor people in the EU. The PDPA copies GDPR's ideas, so the right to erasure is **s.16**. Know the status (details and sources in [use-cases-and-roles.md §2.4](use-cases-and-roles.md#24-legal-context-sri-lankas-pdpa-not-gdpr)):
- Processing obligations (Parts I and III) start on **1 January 2027** (Gazette No. 2498/16, July 2026).
- Data subject rights, including erasure (Part II), and penalties (Part VII) have **no start date yet**.
- So Cellora implements erasure **ahead of commencement**: readiness and privacy by design.

**Right-to-erasure request (UC15), the most "NoSQL-specific" admin feature:**
1. Delete events by the time-series **metaField**: `meta.customerId` **and** every `meta.anonymousId` linked at login. That also catches browsing from *before* they signed up.
2. Delete their `session_summaries` and `session_notes`.
3. **Pseudonymise** orders (keep items and totals for accounting, which is a lawful basis; strip name, email, phone, street, postcode).
4. Revoke Redis sessions and delete the cart.
5. Tombstone the user **last**. It holds the anonymous IDs, so if anything fails you can just run it again.
6. Write `audit_log` with **counts only**, no PII.
- **No transaction?** Correct. Writes to time-series collections can't run inside a multi-document transaction, and Redis isn't part of MongoDB transactions anyway. Instead every step is **idempotent**. The evidence runs it twice: the second run touches nothing.
- **Denormalisation makes erasure harder:** personal data was copied into orders (snapshots), events (meta), summaries and notes. That's a real limitation to discuss in the report.
- **Known gaps:** copies in the Redis stream until trimmed, the oplog, and backups. Also, an erased session stays counted in the live HyperLogLogs: you **can't remove a member from an HLL**. That is acceptable because an HLL stores only hashed register values (no ID can be read back) and the keys expire after 2 hours.

**Small but good details:**
- Staff pages don't emit storefront `page_view` events, so staff browsing doesn't skew customer analytics.
- The worker prunes stale stream consumers (idle > 10 min **and** 0 pending), because `XGROUP DELCONSUMER` would discard a consumer's pending entries.
- `checkout_failed` is a server event with no browser user agent, so the failed-checkouts queue takes the device from the session summary.

### Read these files
1. [apps/api/src/routes/analytics.ts](../apps/api/src/routes/analytics.ts): live (Redis pipeline + `PFCOUNT` union), trends, top, export (`toCsv`).
2. [apps/api/src/routes/support.ts](../apps/api/src/routes/support.ts): search (three kinds of lookup), customer 360 (`$or` over customerId + anonymousIds), timeline, queues, notes.
3. [apps/api/src/routes/admin.ts](../apps/api/src/routes/admin.ts): **read the erasure handler carefully**; also `collMod`, `$indexStats`/`$collStats`, the health commands.
4. [apps/api/src/lib/pii.ts](../apps/api/src/lib/pii.ts) and [lib/audit.ts](../apps/api/src/lib/audit.ts): short.
5. [apps/web/src/pages/staff/](../apps/web/src/pages/staff/): `StaffLayout.tsx` (role-based nav), then skim the Analyst/Support/Admin pages. They are ordinary React Query + fetch.

### Try it yourself
1. Log in as **support** → *Find a customer* → search `sim-01` → open a customer → open a session with "checkout failed" → add a note with **Flag for escalation** → see it under *Escalations* → *Mark resolved*.
2. Log in as **analyst** → the Staff pages → note the "Source: … Redis cache hit" line. Reload within 60 s and it says *cache hit*.
3. Log in as **admin** → *Data & indexes* → change retention to 60 days → Save, then in `npm run db:shell`:
   ```js
   db.getCollectionInfos({ name: "events" })[0].options.expireAfterSeconds   // 5184000
   ```
   Set it back to 90.
4. Admin → *System health*, while you run `docker stop mongo1` (Phase 9 does this properly): watch the members table.
5. In `npm run redis:cli`:
   ```
   KEYS active:*                    # one HyperLogLog per minute
   PFCOUNT active:<m1> active:<m2>  # union of two minutes
   ```

### Viva questions
- **"Why do analyst queries go to a secondary but support queries to the primary?"** Load isolation and read-only safety vs read-your-writes freshness. Consistency is chosen per use case.
- **"How do you count active users?"** HyperLogLog per minute; `PFCOUNT` over 5 keys = union; ~0.8% error in tiny memory; exact count matched (57 = 57).
- **"How is PII protected?"** Masked in the API response for support; analysts only ever see aggregates; the audit log for erasure holds no PII; erasure covers anonymous pre-signup data too.
- **"Why PDPA and not GDPR?"** The shop only serves Sri Lanka; GDPR applies to non-EU businesses only if they target or monitor people in the EU. The PDPA is Sri Lanka's GDPR-style law: erasure is s.16. Its processing duties start 1 Jan 2027; the rights in Part II await a Gazette date, so we built erasure in advance. If Cellora sold to the EU, GDPR would apply too and the same mechanism covers it.
- **"Walk me through the erasure. Why no transaction?"** The steps above; time-series and Redis can't join a transaction; idempotent steps with the user tombstone last; evidence shows re-running is a no-op.
- **"What does denormalisation cost you here?"** Erasure has to find copies in four collections and Redis; with SQL + foreign keys you might cascade-delete from one place.
- **"If I change a user's role, when does it take effect?"** Immediately. Their Redis sessions are revoked because the role is cached there.
- **"How does the admin change data retention?"** `collMod expireAfterSeconds` on the time-series collection; MongoDB expires buckets itself.
- **"How do you know which indexes are useful?"** `$indexStats` usage counters (per node, since restart) plus `explain()` on the dashboard queries. Tell the `metrics_hourly` COLLSCAN story.
- **"What if the dashboard is slow?"** It's layered: rollups (pre-aggregate), Redis cache (TTL), secondary reads. Measure with timings before optimising (the Intl story).

### Evidence
`evidence/08-dashboards/`:
- **Text:** RBAC matrix, analyst on a secondary + write rejected, HyperLogLog vs exact, endpoint timings, export, PII masking, escalation flow, role change → sessions revoked, retention `collMod`, rollup rebuild, right-to-erasure end to end.
- **Screenshots:** 14, one per dashboard page plus the erase dialog.

### One-minute summary
> Three role-based dashboards sit on top of the pipeline. Analysts get live activity from Redis HyperLogLogs and counters, plus funnels and trends from the rollups, all on a read-only connection to a secondary, behind a Redis cache, with CSV/JSON export. Support finds a customer by email, order number or browser ID, and sees their orders, live Redis cart and every session. That includes anonymous ones from before they signed up, linked by identity stitching, with a to-the-second event timeline. Support can annotate and escalate, and contact details are masked. Admins manage roles (a change revokes sessions immediately), set retention (`collMod` on the time-series TTL), inspect index usage, trigger rollup rebuilds, monitor the replica set, Redis and the stream, and erase a customer. Erasure is an idempotent, audited clean-up across four collections and Redis (the PDPA right to erasure, built ahead of its commencement), because time-series writes can't be in a transaction and the data is deliberately denormalised.

---

## Phase 9: Testing, failover and resilience

### Concepts

**Three kinds of testing, each proving something different:**

| Test | What it proves | Where |
|---|---|---|
| Unit tests (`npm test`, 11 tests) | Pure logic is right: event validation, PII masking, password hashing | `tests/unit/` |
| Funnel correctness (known answers) | The most complex query gives the right numbers, including edge cases | `evidence/09-testing/funnel-correctness.md` |
| Scripted scenarios (evidence sets) | Whole features work end to end: stock race, erasure, failover | `04-checkout`, `08-dashboards`, `09-testing` |

**Funnel correctness: how do you test an aggregation?**
- Make a tiny dataset where you **know the answer by hand**. Here that's 10 sessions, each a story: steps out of order, duplicates, a skipped step, an order with no view, a session crossing local midnight, non-funnel events.
- Run the *same* `funnelPipeline()` the worker uses over it, and compare every day × device cell: 6/6 PASS.
- **Bonus finding for the report:** counting sessions per event type while ignoring order gives [6,4,3,3] → "50% conversion". The ordered funnel gives [6,4,2,1] → **17%**. Getting the query right matters.

**Failover test 1: the primary crashes (`docker kill`, not a clean stop).**

What happens inside MongoDB:
1. The secondaries stop receiving heartbeats from the primary (every 2 s).
2. After `electionTimeoutMillis` (10 s) without contact, a secondary calls an election.
3. The two survivors are still a **majority of 3**, so one wins and becomes primary.
4. The driver in our API notices (server discovery) and sends writes to the new primary. **No code or config change.**

Measured: **new primary after 10.3–11.4 s**. Reads and checkouts that arrived during the election **waited** (up to ~10 s) and then succeeded: **0 failed requests**. Telemetry was never even slowed (max 36 ms), because `POST /api/events` only touches Redis. All accepted events reached MongoDB. The old node, restarted, rejoined as a SECONDARY in about 1 s and caught up from the oplog.

**A config change backed by evidence.** The driver's `serverSelectionTimeoutMS` was 10 s, and elections took *longer* than that (11.4 s once). Requests would have failed with 500s. Raised to **20 s**: long enough to ride out an election, short enough not to hide a real outage.

**Failover test 2: the majority is lost (2 of 3 killed).** This is the **CAP theorem** made visible:
- The survivor can't see a majority, so it **refuses to become primary** (`hello` → `secondary: true, primary: null`). If it accepted writes, and the other two were alive but cut off (a network partition), you'd get two primaries and conflicting data: *split brain*.
- MongoDB (with majority writes) chooses **Consistency over Availability** during a partition: **CP**.
- What the app did: catalogue reads and checkouts **failed with 500 after 20 s** (honest unavailability). **Telemetry kept being accepted** (Redis), the worker's inserts failed and it **retried its pending batch** until a primary came back, and **0 of 1,210 events were lost**.
- **The design point:** because ingestion is decoupled by the Redis Stream, the *write-heavy* part of the system stays available even when the database isn't. That's the reason the stream exists, now proven.

**Bugs the tests found (good to mention: testing that finds nothing proves little):**
1. **The worker crashed** if MongoDB was unavailable: one failed `insertMany` escaped the loop and killed the process. Now it logs, waits 2 s and **re-reads its own pending entries** (`XREADGROUP … 0` instead of `>`), because un-ACKed messages stay in the consumer's pending list. That's the at-least-once guarantee doing its job.
2. **`async` callbacks in `setInterval`** (rollup scheduler, simulator catalogue refresh): a rejected promise there is *unhandled* and Node kills the process. Wrapped in try/catch.
3. The server-selection timeout above.

### Read these files
1. [scripts/evidence/captures/testing.ts](../scripts/evidence/captures/testing.ts): the funnel dataset (read the stories and the expected table), and the `Load` class.
2. [apps/worker/src/ingest.ts](../apps/worker/src/ingest.ts): `run()`, the try/catch and `retryOwnPending`.
3. [tests/unit/](../tests/unit/): two short files.
4. [packages/shared/src/server/connections.ts](../packages/shared/src/server/connections.ts): the timeout and why.

### Try it yourself
```bash
npm test
npm run evidence -- testing        # ~3 min; kills and restarts MongoDB containers
```
Or by hand, with the admin **System health** page open:
```bash
docker kill mongo1                 # if mongo1 is primary; watch the page for ~15 s
docker start mongo1                # it comes back as SECONDARY
```

### Viva questions
- **"What happens if the primary dies?"** Survivors hold an election (~10 s after heartbeats stop), a new primary is chosen by majority, and the driver follows it automatically. Measured: 0 failed requests, 10.3–11.4 s pause.
- **"And if two nodes die?"** No majority → no primary → no writes (CP). Reads with the default read preference fail too. Telemetry is still accepted thanks to the Redis stream and lands later. 0 lost.
- **"Why three nodes, not two?"** With two, losing one leaves 1 of 2, which is not a majority, so there's no primary. Three tolerate one failure. (Five tolerate two.)
- **"Where is your system CP and where AP?"** MongoDB writes (orders, stock) are CP. Telemetry ingestion behaves AP (always accepts, eventually consistent). Dashboards are eventually consistent (rollups, cache, secondary reads).
- **"How do you know your funnel query is right?"** The hand-made dataset with known answers, plus the Phase 7 check that rollups equal the raw computation.
- **"What did testing find?"** The worker crash on DB errors, unhandled rejections in timers, and a timeout shorter than an election.
- **"What's still a single point of failure?"** Redis (one instance; AOF limits data loss to ~1 s). In production: Redis Sentinel or a managed Redis with replicas.

### Evidence
`evidence/09-testing/`: funnel-correctness, unit-tests, failover-under-load (with per-second timeline), majority-loss, failover-health-during/after screenshots.

### One-minute summary
> I tested at three levels: unit tests for pure logic, a hand-made dataset with known answers for the funnel aggregation, and end-to-end scenarios. The key scenario kills MongoDB nodes under continuous load. When the primary crashes, the other two elect a new one in about 11 seconds and the application follows it with no failed requests. When two of three die, MongoDB refuses to elect a primary rather than risk inconsistent data (CP in CAP terms). Database requests fail, but telemetry is still accepted into the Redis stream, and not one event was lost once the nodes returned. Testing found real bugs: the worker crashing on database errors, unhandled promise rejections in timers, and a driver timeout shorter than an election. All three are fixed.

---

## Phase 10: The report, and how to defend it

The report is `docs/report/report.md` (PDF: `npm run report:pdf`). Your university allows AI-drafted text **as long as you can defend it**, so treat the report as a map of what you must be able to explain. Every section points back to a study-guide phase:

| Report section | What you must be able to explain | Study guide |
|---|---|---|
| 2 NoSQL background | Families with examples, ACID vs BASE, CAP (and PACELC), schema-on-read vs write, replication vs sharding | Phase 0–1 concepts, Phase 9 (CAP in practice) |
| 3 Requirements | Why the Customer and Support actors were added; why PDPA and not GDPR | Phase 0, Phase 8 |
| 4 Design | Why MongoDB, why Redis (the five jobs), why not Cassandra / Neo4j / Elasticsearch | Phase 0–1 |
| 5 Data model | Embed vs reference with examples; time-series + `metaField` trade-off; identity stitching; ESR; the `_id.hour` COLLSCAN | Phases 2, 5, 6, 7, 8 |
| 6 Implementation | Conditional update + transaction; the ingest loop and XACK-after-insert; the ordered funnel | Phases 4, 5, 7 |
| 7 Characteristics | Tunable consistency table; eventual consistency evidence; HyperLogLog union | Phases 7, 8 |
| 9 Strengths | The numbers: 30k/s, 144→2.2 ms, 1 of 20, 0 failed in failover | Phases 4, 5, 7, 9 |
| 10 Limitations | Why erasure is hard; at-least-once duplicates; CP without majority; `$text` OR matching | Phases 5, 8, 9 |
| 11 Evaluation | The relational comparison (be fair: Postgres would also work at this size); how to scale 100× | This section |

### Numbers to know by heart
- **1 × 201, 19 × 409**: twenty buyers, one unit. A naive read-then-write sells **18**.
- **30,303 events/s** accepted by the API, **6,307/s** end to end.
- Funnel **144 ms raw → 2.2 ms rollup** (65×); cache hit 2.5 ms; identical numbers.
- **7.4 events per bucket**; time-series **9.4 MB vs 12.1 MB** on disk.
- HyperLogLog **57 = 57 exact**; summing minutes gave **67**.
- Failover: new primary in **~11 s**, **0 failed** requests, **0 lost** events. Majority loss: DB requests fail, telemetry **1,210 / 1,210** kept.
- Funnel test: naive counting **50%**, true ordered funnel **17%**.

### Likely challenges to the report, and answers
- **"You say NoSQL is better, but couldn't PostgreSQL do this?"** Yes, at this size (§11.3 says so). NoSQL's advantages here are write decoupling, schema evolution, built-in replication/TTL and specialised structures. They grow with scale. Its weaknesses (integrity, ad-hoc queries, erasure) don't shrink.
- **"Isn't your failover result just luck?"** It was run three times (10.3, 10.7, 11.4 s elections, 0 failures each time). And the test found a real bug (the timeout was shorter than an election).
- **"Your numbers come from one laptop."** Yes, and the report says so. The *comparisons* (raw vs rollup, naive vs atomic, API vs end-to-end) are the point, not absolute throughput.
- **"Why is the report so long?"** Check the word limit. Sections 8 and 11.3 are the easiest to trim.

### Before submitting
Fill the placeholders, check the word limit, verify references, re-check the PDPA status on dpa.gov.lk, rebuild the PDF and look through every page.

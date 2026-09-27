# Data Model

**Project:** Phone & electronic accessories e-commerce store with a NoSQL-backed customer telemetry platform.

This document defines the MongoDB collections, the Redis structures, the telemetry event catalogue and the index design. The system context is in [architecture.md](architecture.md). Use cases (UC1–UC15) are in [use-cases-and-roles.md](use-cases-and-roles.md).

---

## 1. Decisions carried in

| Decision | Choice |
|---|---|
| Product categories | 7 kinds: `phone`, `case`, `charging`, `audio`, `screen_protector`, `power_bank`, `smartwatch` |
| Catalog | ~60–100 hand-curated real products (e.g. iPhone 16, Galaxy S25, Pixel 9), created by a seed script |
| Guest checkout | **Allowed.** Every event carries an `anonymousId`; identity is stitched to the account on login/signup (§6) |

---

## 2. Modelling principles

1. **Query-driven design.** Collections and indexes are shaped by the queries the use cases run, not by normalising entities. Every index in §8 names the query it serves.
2. **Embed when the data is read together, owned by one parent and bounded in size**; otherwise reference.
3. **Denormalise deliberately.** Copy data when the copy is a *historical fact* (the price at the time of an order) or when it avoids a join on a hot path. Each copy is listed in §9 with how it stays correct.
4. **Validate at the edge.** MongoDB does not enforce a schema by default, so validation is the application's job: Zod at the API for all writes, plus a MongoDB `$jsonSchema` validator on `products` for the base fields.
5. **Money** is stored as **integers in minor units** (cents), e.g. `39990000` = LKR 399,900.00. This avoids floating-point rounding without converting to and from `Decimal128` in JavaScript. The currency is **Sri Lankan Rupees (LKR)**, a single store-wide setting (minor unit = cents). Even large order totals stay far below JavaScript's safe-integer limit (2^53).

---

## 3. Collections at a glance

| Collection | Type | Written by | Read by (use cases) |
|---|---|---|---|
| `products` | Regular, polymorphic | Seed script, Admin | UC8, UC9, UC10, UC11 |
| `users` | Regular | API (signup, admin) | UC4, UC13, UC15 |
| `orders` | Regular | API (checkout transaction) | UC11, UC13, UC15 |
| `events` | **Time-series** | Ingest worker | UC1, UC2, UC12, UC15 |
| `session_summaries` | Regular (rollup) | Rollup job (`$merge`) | UC12, UC2 |
| `metrics_hourly` | Regular (rollup) | Rollup job (`$merge`) | UC1, UC3, UC6 |
| `funnel_daily` | Regular (rollup) | Rollup job (`$merge`) | UC2, UC3, UC6 |
| `session_notes` | Regular | Support | UC14, UC12 |
| `settings` | Regular (single doc) | Admin | UC5 |
| `audit_log` | Regular | API (staff actions) | UC4, UC15 |

Carts and login sessions live in **Redis**; see §7.

---

## 4. Collection schemas

### 4.1 `products`: polymorphic catalog

One collection for every kind of product, with a **discriminator field `kind`** (implemented with Mongoose discriminators). This shows off schema flexibility: a phone and a screen protector sit in the same collection and are browsed, searched and sold through the same code paths, yet share only the base fields.

**Base fields (all kinds)**

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `kind` | string | Discriminator |
| `slug` | string | URL key, unique |
| `name`, `brand`, `description` | string | Text-indexed |
| `images` | string[] | URLs/paths |
| `tags` | string[] | Free-form merchandising tags |
| `basePrice` | int (minor units) | **Denormalised** = lowest active variant price; used for sort/filter |
| `variants` | array (embedded) | See below |
| `isActive` | bool | Soft-hide from storefront |
| `createdAt`, `updatedAt` | Date | |

**Embedded `variants`**: `{ sku, label, attributes: {color?, storageGb?, ...}, price, stock }`

Why variants are embedded:
- they are always displayed with their product,
- the number is bounded (a phone has at most ~12 colour × storage combinations),
- and stock can be decremented atomically inside the product document with the positional operator (§4.3).

**Kind-specific attributes**

| `kind` | Attributes |
|---|---|
| `phone` | `modelKey` (e.g. `apple-iphone-16-pro`), `releaseYear`, `os`, `chipset`, `ramGb`, `display {sizeIn, panel, refreshHz}`, `cameras {mainMp, ultraWideMp?, telephotoMp?}`, `batteryMah`, `maxChargingW`, `port`, `wirelessCharging` |
| `case` | `compatibleModels` (`modelKey[]`), `material`, `style` (`slim`/`rugged`/`wallet`), `magsafe` |
| `screen_protector` | `compatibleModels` (`modelKey[]`), `material` (`tempered_glass`/`privacy`/`film`), `packCount` |
| `charging` | `subType` (`charger`/`cable`/`wireless_pad`), `wattage?`, `ports?` (`["usb-c","usb-a"]`), `protocols?` (`["PD","PPS","Qi2"]`), `connectors? {from,to}`, `lengthM?` |
| `audio` | `formFactor` (`in_ear`/`over_ear`), `wireless`, `anc`, `batteryHours`, `codecs[]` |
| `power_bank` | `capacityMah`, `maxOutputW`, `ports[]`, `wireless` |
| `smartwatch` | `compatiblePlatforms` (`["ios","android"]`), `caseSizesMm[]`, `gps`, `lte`, `batteryDays`, `sensors[]` |

Compatibility is modelled three ways, each suited to its product type:
- **by exact model** (`compatibleModels` on cases and screen protectors → matches `phone.modelKey`),
- **by connector/protocol** (charging products ↔ `phone.port` / `maxChargingW`),
- **by platform** (smartwatches ↔ `phone.os`).

**Example: phone**
```json
{
  "kind": "phone",
  "slug": "iphone-16-pro",
  "name": "iPhone 16 Pro",
  "brand": "Apple",
  "modelKey": "apple-iphone-16-pro",
  "releaseYear": 2024,
  "os": "ios",
  "chipset": "A18 Pro",
  "ramGb": 8,
  "display": { "sizeIn": 6.3, "panel": "OLED", "refreshHz": 120 },
  "cameras": { "mainMp": 48, "ultraWideMp": 48, "telephotoMp": 12 },
  "batteryMah": 3582,
  "maxChargingW": 30,
  "port": "usb-c",
  "wirelessCharging": true,
  "basePrice": 39990000,
  "variants": [
    { "sku": "IP16P-128-BLK", "label": "128GB Black Titanium", "attributes": { "storageGb": 128, "color": "Black Titanium" }, "price": 39990000, "stock": 25 },
    { "sku": "IP16P-256-BLK", "label": "256GB Black Titanium", "attributes": { "storageGb": 256, "color": "Black Titanium" }, "price": 44990000, "stock": 18 }
  ],
  "isActive": true
}
```

**Example: case**
```json
{
  "kind": "case",
  "slug": "spigen-ultra-hybrid-iphone-16-pro",
  "name": "Ultra Hybrid MagFit",
  "brand": "Spigen",
  "compatibleModels": ["apple-iphone-16-pro"],
  "material": "polycarbonate/TPU",
  "style": "slim",
  "magsafe": true,
  "basePrice": 850000,
  "variants": [
    { "sku": "SPG-UH-16P-CLR", "label": "Clear", "attributes": { "color": "Clear" }, "price": 850000, "stock": 120 }
  ],
  "isActive": true
}
```

**Seed plan (~60–100 products):** phones ~15 (Apple, Samsung, Google, OnePlus, Xiaomi) · cases ~15 · screen protectors ~10 · charging ~15 · audio ~10 · power banks ~6 · smartwatches ~6. Accessories are seeded against the seeded phones' `modelKey`s so compatibility queries return real results.

---

### 4.2 `users`

Customers and staff share one collection, told apart by `role`.

| Field | Type | Notes |
|---|---|---|
| `email` | string | Unique |
| `passwordHash` | string | scrypt (Node built-in), per-user random salt: `scrypt$<salt>$<hash>` |
| `name` | string | |
| `role` | `customer` / `analyst` / `support` / `admin` | |
| `addresses` | array (embedded, ≤ 5) | `{label, line1, line2?, city, postcode, country}` |
| `anonymousIds` | string[] (capped at 20 with `$push` + `$slice`) | Anonymous browser IDs linked to this account (§6) |
| `status` | `active` / `disabled` / `erased` | `erased` after GDPR request (UC15) |
| `createdAt`, `lastLoginAt` | Date | |

---

### 4.3 `orders`

| Field | Type | Notes |
|---|---|---|
| `orderNumber` | string | Human-readable, unique (e.g. `ORD-20260927-0042`) |
| `customerId` | ObjectId \| null | `null` for guest orders |
| `guestEmail` | string? | Guest orders only |
| `sessionId`, `anonymousId` | string | Links the order to its telemetry (Support, UC12/UC13) |
| `items` | array (embedded) | **Snapshot**: `{productId, sku, kind, name, variantLabel, unitPrice, qty, lineTotal}` |
| `totals` | object | `{subtotal, shipping, total}` (minor units) |
| `shippingAddress` | object | **Snapshot** copied at checkout |
| `status` | `placed` / `paid` / `shipped` / `delivered` / `cancelled` | |
| `statusHistory` | array (embedded) | `{status, at}`; bounded by the order lifecycle |
| `createdAt` | Date | |

Line items are **embedded snapshots**, not references. An order records what the customer paid at the time it was placed, so later price or name changes to the product must not rewrite it.

**Checkout stock decrement** (inside the transaction, once per line item):
```js
db.products.updateOne(
  { _id: productId, variants: { $elemMatch: { sku, stock: { $gte: qty } } } },
  { $inc: { "variants.$.stock": -qty } },
  { session }
)
// matchedCount === 0 → abort transaction → emit checkout_failed { reason: "out_of_stock", sku }
```

---

### 4.4 `events`: time-series telemetry

```js
db.createCollection("events", {
  timeseries: { timeField: "ts", metaField: "meta", granularity: "seconds" },
  expireAfterSeconds: 60 * 60 * 24 * 90   // default 90 days, changed by Admin (UC5)
})
```

**Document shape (envelope)**

| Field | Type | Notes |
|---|---|---|
| `ts` | Date | When the event happened (client clock for client events, server clock for server events) |
| `meta.anonymousId` | string (UUID) | Always present |
| `meta.sessionId` | string (UUID) | Always present |
| `meta.customerId` | ObjectId \| null | Set when known; backfilled on identify (§6) |
| `eventId` | string (UUID) | Generated by the client; used for best-effort deduplication (§10) |
| `type` | string | See §5 |
| `source` | `client` / `server` | Server events are trusted; client events can be spoofed |
| `page` | `{path, referrer?}` | Client events |
| `device` | `{type: "desktop"/"mobile"/"tablet", os, browser}` | Parsed from the user agent at the API |
| `props` | object | Type-specific payload (§5) |
| `receivedAt` | Date | Stamped by the API; `receivedAt - ts` shows client clock skew or offline buffering |

**Example**
```json
{
  "ts": { "$date": "2026-09-27T14:03:11.412Z" },
  "meta": { "anonymousId": "a1f0…", "sessionId": "s9c2…", "customerId": null },
  "eventId": "e77b…",
  "type": "add_to_cart",
  "source": "client",
  "page": { "path": "/p/iphone-16-pro" },
  "device": { "type": "mobile", "os": "Android", "browser": "Chrome" },
  "props": { "productId": "66f…", "sku": "IP16P-256-BLK", "kind": "phone", "qty": 1, "unitPrice": 44990000 },
  "receivedAt": { "$date": "2026-09-27T14:03:13.020Z" }
}
```

**Why `meta` contains the identity fields** (a deliberate trade-off, also covered in architecture §7):

| Benefit | Cost |
|---|---|
| A session's events share buckets, so session timelines (UC12) are cheap to read | Many distinct meta values mean many small buckets and less compression |
| Deletes and updates by `meta` are supported on time-series collections, which enables GDPR erasure (UC15) and identity backfill (§6) The `metaField` choice is fixed at creation; changing it means recreating the collection and re-inserting the data |

---

### 4.5 `session_summaries`: rollup

One document per session, rebuilt from `events` by the rollup job with `$merge` (`whenMatched: "replace"`). It lets Support list a customer's sessions (UC12) without scanning raw events, and it feeds device/landing-page breakdowns.

```json
{
  "_id": "s9c2…",
  "anonymousId": "a1f0…",
  "customerId": null,
  "startedAt": { "$date": "…" },
  "endedAt": { "$date": "…" },
  "durationSec": 412,
  "eventCount": 37,
  "landingPath": "/c/phones",
  "device": { "type": "mobile", "os": "Android", "browser": "Chrome" },
  "reached": { "productView": true, "addToCart": true, "checkoutStarted": true, "orderPlaced": false },
  "hadCheckoutFailure": true,
  "orderIds": []
}
```

### 4.6 `metrics_hourly`: rollup

Hours are **Sri Lanka local hours** (UTC+5:30), so each bucket starts at `hh:30` UTC. `$dateTrunc`'s timezone option doesn't honour half-hour offsets for hourly units, so the pipeline shifts timestamps by +330 minutes, truncates, and shifts back.

```json
{ "_id": { "hour": { "$date": "2026-09-27T14:00:00Z" }, "type": "product_view" },
  "count": 1832, "uniqueSessions": 611 }
```

### 4.7 `funnel_daily`: rollup

```json
{ "_id": { "day": "2026-09-27", "funnel": "purchase" },
  "steps": [
    { "step": "product_view",     "sessions": 2410 },
    { "step": "add_to_cart",      "sessions": 702 },
    { "step": "checkout_started", "sessions": 311 },
    { "step": "order_placed",     "sessions": 198 }
  ],
  "byDevice": { "mobile": [ … ], "desktop": [ … ] },
  "computedAt": { "$date": "…" } }
```

### 4.8 `session_notes` (UC14)

`{ sessionId, customerId?, authorId, authorName, body, flagged: bool, status: "open"/"resolved", createdAt, resolvedAt?, resolvedByName? }`

`authorName` is copied in (denormalised) so the notes list never needs a join to `users`. `customerId` is filled from the session, so a note appears on the customer's profile and is deleted with them on erasure (UC15).

Kept separate from `events` (append-only telemetry) and `session_summaries` (overwritten on every rollup), so annotations are never lost when either is rewritten.

### 4.9 `settings`

Single document `{ _id: "global", eventRetentionDays: 90, rollupIntervalMin: 5, currency: "LKR", updatedBy, updatedAt }`. Changing `eventRetentionDays` makes the API run `collMod` on `events` (UC5).

### 4.10 `audit_log`

`{ at, actorId, actorRole, actorName, action, target: {type, id}, details }`. Actions: `role_changed`, `status_changed`, `sessions_revoked`, `retention_changed`, `rollup_interval_changed`, `rollups_rebuild_requested`, `customer_erased`. The `customer_erased` entry records the scope of the erasure (counts per store) but no personal data.

A **capped collection** was considered, since it offers auto-rotation. It was rejected because an audit trail must not silently drop records.

---

## 5. Telemetry event catalogue

Validated at the API with a Zod **discriminated union on `type`**; the shared schema lives in `packages/shared`.

| `type` | Source | `props` | Used by |
|---|---|---|---|
| `page_view` | client | `{title}` | UC1, session summaries |
| `category_view` | client | `{kind, filters}` | UC1 |
| `product_view` | client | `{productId, kind, basePrice}` | UC1, UC2 (step 1) |
| `search` | client | `{query, filters, resultCount}` | UC1 (zero-result searches show catalog gaps) |
| `add_to_cart` | client | `{productId, sku, kind, qty, unitPrice}` | UC2 (step 2) |
| `remove_from_cart` | client | `{sku, qty}` | UC1, UC12 |
| `update_quantity` | client | `{sku, from, to}` | UC12 |
| `checkout_started` | client | `{cartValue, itemCount}` | UC2 (step 3) |
| `payment_submitted` | client | `{method}` (simulated payment) | UC12 |
| `identify` | client | `{customerId, via: "login"/"signup"}` | Identity stitching (§6) |
| `order_placed` | **server** | `{orderId, orderNumber, total, itemCount}` | UC2 (step 4), UC12 |
| `checkout_failed` | **server** | `{reason: "out_of_stock"/"payment_declined"/"validation", sku?}` | UC12, UC1 |

Server events get `sessionId`/`anonymousId` from the `X-Session-Id` / `X-Anonymous-Id` headers that the frontend sends on every API request.

Events **denormalise** `kind`, `unitPrice` and `basePrice` into `props`, so analytics can group by category and revenue without a `$lookup` join against `products`. Joins from a time-series collection are expensive.

---

## 6. Identity stitching (guest → customer)

| Identifier | Scope | Where it lives |
|---|---|---|
| `anonymousId` | One browser, long-lived | `localStorage` |
| `sessionId` | One visit; new after 30 min inactivity | `sessionStorage` + last-activity timestamp |
| `customerId` | One account | Set after login/signup |

**Flow on login/signup:**
1. API authenticates the user and `$push`es the current `anonymousId` onto `users.anonymousIds` (`$each` + `$slice: -20`).
2. Tracker emits `identify` and includes `customerId` in `meta` on all later events.
3. When the ingest worker processes an `identify` event, it **backfills** earlier anonymous events:
   ```js
   db.events.updateMany(
     { "meta.anonymousId": anonymousId, "meta.customerId": null },
     { $set: { "meta.customerId": customerId } }
   )
   ```
   This is allowed on a time-series collection because the update touches only the `metaField`. Updates to other fields are restricted.
4. The guest cart `cart:{cartId}` is merged into `cart:u:{userId}` (§7).

**Known limitation:** with multiple ingest workers, an `identify` event can be processed before earlier anonymous events from the same browser have been inserted, and those events miss the backfill. A single consumer keeps stream order, and the worker handles `identify` only *after* the `insertMany` of its batch. The rollup job also rebuilds `session_summaries` from `users.anonymousIds`, which repairs summaries later.

---

## 7. Redis structures

(Key layout and TTLs: [architecture.md §8](architecture.md#8-redis-key-layout).)

| Structure | Detail |
|---|---|
| **Cart** `cart:{cartId}` (guest) / `cart:u:{userId}` (logged in) | Hash `sku → qty`. **Prices are not stored**: they are read from `products` when the cart is displayed and again at checkout, so a cart can never lock in a stale price. On login, the guest cart is merged with `HINCRBY` per SKU and then deleted. |
| **Session** `sess:{id}` | Hash `{userId, role, createdAt}`; also added to `user_sessions:{userId}` so Admin can revoke all of a user's sessions (UC4) |
| **Stream** `events:ingest` | Field `e` holds the validated event JSON |
| **Live counters** | `active:{minute}` (HyperLogLog of `sessionId`), `evt:{type}:{minute}` (counter) |
| **Query cache** | `cache:{query}:{sha1(params)}` → JSON result |

---

## 8. Index catalogue

Compound indexes follow the **ESR rule**: **E**quality fields first, then **S**ort, then **R**ange.

### `products`
| Index | Serves |
|---|---|
| `{slug: 1}` unique | Product page lookup (UC8) |
| `{"variants.sku": 1}` unique | Cart/checkout SKU lookup (UC10, UC11). *Caveat: uniqueness is across documents only, not within one document's array; enforced by Zod.* |
| `{kind: 1, basePrice: 1}` | Category page sorted/filtered by price (UC8) |
| `{brand: 1, kind: 1}` | Brand filter (UC8) |
| `{compatibleModels: 1}` (multikey) | "Accessories for this phone" (UC8) |
| Text `{name: 10, brand: 5, description: 1}` | Search (UC9), weighted so name matches rank first |

### `users`
| Index | Serves |
|---|---|
| `{email: 1}` unique | Login |
| `{role: 1}` | Admin staff listing (UC4) |
| `{anonymousIds: 1}` (multikey) | Resolve an anonymous ID to a customer (Support, rollups) |

### `orders`
| Index | Serves |
|---|---|
| `{orderNumber: 1}` unique | Support lookup by order number (UC13) |
| `{customerId: 1, createdAt: -1}` | Customer order history (UC13) |
| `{sessionId: 1}` | Session → order link (UC12) |
| `{guestEmail: 1}` partial (`guestEmail` exists) | Guest order lookup (UC13) |

### `events` (time-series secondary indexes)
| Index | Serves |
|---|---|
| `{"meta.sessionId": 1, ts: 1}` | Session timeline (UC12) |
| `{"meta.customerId": 1, ts: -1}` | Customer activity, GDPR erasure (UC12, UC15) |
| `{"meta.anonymousId": 1}` | Identity backfill (§6) |
| `{type: 1, ts: 1}` | Rollups and live queries filtered by event type in a time window (UC1, UC2) |

### Rollups and others
| Collection | Index | Serves |
|---|---|---|
| `session_summaries` | `{customerId: 1, startedAt: -1}` | Customer's sessions list (UC12) |
| `session_summaries` | `{anonymousId: 1, startedAt: -1}` | Guest sessions list (UC12) |
| `session_summaries` | `{hadCheckoutFailure: 1, startedAt: -1}` | Support "failed checkouts" queue (UC12) |
| `funnel_daily` | compound `_id` `{day, funnel}` | Range reads by day (UC2) |
| `metrics_hourly` | `{"_id.hour": 1}` | Range reads by hour (UC1, UC3). The `_id` index on the compound `{hour, type}` can't serve a range on `_id.hour` alone; this was found as a COLLSCAN while building the trends dashboard (Phase 8) |
| `session_notes` | `{sessionId: 1, createdAt: 1}` | Notes on a session (UC14) |
| `session_notes` | `{flagged: 1, status: 1, createdAt: -1}` | Escalation queue (UC14) |
| `audit_log` | `{at: -1}`, `{actorId: 1, at: -1}` | Audit views (UC4) |

**Deliberately not indexed:** `events.props.*`. Payload fields vary by type. Analytical filters on them run over rollups or over small time windows already narrowed by `{type, ts}`, and an index per payload field would slow down the write-heavy ingest path.

---

## 9. Embed vs reference and denormalisation register

| Relationship / copy | Decision | Reason | How it stays correct |
|---|---|---|---|
| Product → variants | Embed | Read together, bounded, atomic stock updates | n/a |
| User → addresses | Embed | Owned, bounded (≤ 5) | n/a |
| Order → line items | Embed **snapshot** | Historical fact | Never updated after placement |
| Order → shipping address | Embed **snapshot** | Historical fact | Never updated |
| Order → customer | Reference (`customerId`) | Many orders per customer, unbounded | n/a |
| Product `basePrice` | Denormalised | Sort/filter without `$unwind` | Recomputed in the same write that changes any variant price |
| Event `props.kind` / `unitPrice` | Denormalised | Avoids `$lookup` from time-series | Historical fact at event time |
| `session_summaries`, `metrics_hourly`, `funnel_daily` | Materialised views | Fast dashboards (UC6) | Rebuilt every 5 min; at most one interval stale (eventual consistency) |
| Session notes → session | Reference (`sessionId`) | Different lifecycle from events/summaries | n/a |

---

## 10. Consistency notes

| Area | Behaviour | Why |
|---|---|---|
| Checkout | ACID multi-document transaction, `w: "majority"` | Money and stock must be correct |
| Event writes | `w: 1`, `ordered: false` batches | Throughput over durability; losing a few events on failover is acceptable |
| Duplicate events | Possible (at-least-once stream delivery; time-series has no unique indexes) | Best-effort mitigation (implemented): the worker skips `eventId`s it inserted within the last hour (`seen:{eventId}` keys with a 1 h TTL, written only after a successful insert). Duplicates are not fully prevented (e.g. two workers racing, or a redelivery after the TTL); this is a documented limitation |
| Analyst reads | `secondaryPreferred` | Offloads the primary; may lag by replication delay |
| Dashboards | Rollups up to one interval stale; cache ≤ 60 s | Eventual consistency accepted for analytics |

---

## 11. Key aggregation: ordered purchase funnel (UC2)

Counts sessions that reached each step **in order** on a given day, then writes the result to `funnel_daily`.

```js
db.events.aggregate([
  { $match: {
      ts: { $gte: dayStart, $lt: dayEnd },
      type: { $in: ["product_view", "add_to_cart", "checkout_started", "order_placed"] }
  }},
  // First time each session hit each step ($min ignores nulls)
  { $group: {
      _id: "$meta.sessionId",
      device:   { $first: "$device.type" },
      view:     { $min: { $cond: [{ $eq: ["$type", "product_view"] },     "$ts", null] } },
      cart:     { $min: { $cond: [{ $eq: ["$type", "add_to_cart"] },      "$ts", null] } },
      checkout: { $min: { $cond: [{ $eq: ["$type", "checkout_started"] }, "$ts", null] } },
      order:    { $min: { $cond: [{ $eq: ["$type", "order_placed"] },     "$ts", null] } }
  }},
  // A step counts only if the previous step was reached first
  { $set: { s1: { $ne: ["$view", null] } } },
  { $set: { s2: { $and: ["$s1", { $ne: ["$cart", null] },     { $gte: ["$cart", "$view"] }] } } },
  { $set: { s3: { $and: ["$s2", { $ne: ["$checkout", null] }, { $gte: ["$checkout", "$cart"] }] } } },
  { $set: { s4: { $and: ["$s3", { $ne: ["$order", null] },    { $gte: ["$order", "$checkout"] }] } } },
  { $group: {
      _id: null,
      s1: { $sum: { $cond: ["$s1", 1, 0] } },
      s2: { $sum: { $cond: ["$s2", 1, 0] } },
      s3: { $sum: { $cond: ["$s3", 1, 0] } },
      s4: { $sum: { $cond: ["$s4", 1, 0] } }
  }},
  { $project: {
      _id: { day: dayKey, funnel: "purchase" },
      steps: [
        { step: "product_view",     sessions: "$s1" },
        { step: "add_to_cart",      sessions: "$s2" },
        { step: "checkout_started", sessions: "$s3" },
        { step: "order_placed",     sessions: "$s4" }
      ],
      computedAt: "$$NOW"
  }},
  { $merge: { into: "funnel_daily", on: "_id", whenMatched: "replace", whenNotMatched: "insert" } }
])
```

The per-device breakdown (`byDevice`) uses the same pipeline with `device` added to the second `$group` key. Funnels spanning midnight are counted on the day of their first event; this is a documented simplification.

**Report angle:** in SQL this would be a set of self-joins or window functions over an events table. Here it's a single pipeline over one collection, which shows how the aggregation framework stands in for joins. The limitation is that ad-hoc multi-collection analysis is harder than in SQL.

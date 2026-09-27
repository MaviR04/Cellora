// Creates collections, validators and indexes described in docs/data-model.md.
// Safe to re-run: existing collections are updated with collMod, indexes are idempotent.
import { connectMongo, mongoose } from "@da2/shared/server";
import { PRODUCT_KINDS } from "@da2/shared";
import type { Db, IndexDescription } from "mongodb";

const DEFAULT_RETENTION_DAYS = 90;

const conn = await connectMongo();
const db = conn.db as unknown as Db;

async function exists(name: string) {
  return (await db.listCollections({ name }).toArray()).length > 0;
}

// --- events: time-series (data-model §4.4) ---------------------------------------------
if (!(await exists("events"))) {
  await db.createCollection("events", {
    timeseries: { timeField: "ts", metaField: "meta", granularity: "seconds" },
    expireAfterSeconds: DEFAULT_RETENTION_DAYS * 24 * 60 * 60,
  });
  console.log("created time-series collection: events");
}

// --- products: base-field validator (data-model §2 principle 4, §4.1) --------------------
// Kind-specific fields are validated by the application (Zod/Mongoose), not here, so new
// product kinds never need a database migration.
const intType = ["int", "long"];
const productValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["kind", "slug", "name", "brand", "basePrice", "variants", "isActive"],
    properties: {
      kind: { enum: [...PRODUCT_KINDS] },
      slug: { bsonType: "string", pattern: "^[a-z0-9-]+$" },
      name: { bsonType: "string", minLength: 1 },
      brand: { bsonType: "string", minLength: 1 },
      basePrice: { bsonType: intType, minimum: 0 },
      isActive: { bsonType: "bool" },
      variants: {
        bsonType: "array",
        minItems: 1,
        items: {
          bsonType: "object",
          required: ["sku", "price", "stock"],
          properties: {
            sku: { bsonType: "string" },
            price: { bsonType: intType, minimum: 0 },
            // Database-level safety net: stock can never go negative, even if app logic is wrong.
            stock: { bsonType: intType, minimum: 0 },
          },
        },
      },
    },
  },
};
if (await exists("products")) {
  await db.command({ collMod: "products", validator: productValidator, validationLevel: "strict" });
} else {
  await db.createCollection("products", { validator: productValidator, validationLevel: "strict" });
  console.log("created collection: products (with $jsonSchema validator)");
}

// --- indexes (data-model §8) --------------------------------------------------------------
const indexes: Record<string, IndexDescription[]> = {
  products: [
    { key: { slug: 1 }, unique: true },
    { key: { "variants.sku": 1 }, unique: true },
    { key: { kind: 1, basePrice: 1 } },
    { key: { brand: 1, kind: 1 } },
    { key: { compatibleModels: 1 } },
    {
      key: { name: "text", brand: "text", description: "text" },
      weights: { name: 10, brand: 5, description: 1 },
      name: "product_text",
    },
  ],
  users: [
    { key: { email: 1 }, unique: true },
    { key: { role: 1 } },
    { key: { anonymousIds: 1 } },
  ],
  orders: [
    { key: { orderNumber: 1 }, unique: true },
    { key: { customerId: 1, createdAt: -1 } },
    { key: { sessionId: 1 } },
    { key: { guestEmail: 1 }, partialFilterExpression: { guestEmail: { $exists: true } } },
  ],
  events: [
    { key: { "meta.sessionId": 1, ts: 1 } },
    { key: { "meta.customerId": 1, ts: -1 } },
    { key: { "meta.anonymousId": 1 } },
    { key: { type: 1, ts: 1 } },
  ],
  session_summaries: [
    { key: { customerId: 1, startedAt: -1 } },
    { key: { anonymousId: 1, startedAt: -1 } },
    { key: { hadCheckoutFailure: 1, startedAt: -1 } },
  ],
  // _id is the compound {hour, type}, so the _id index can't serve a range on _id.hour alone
  metrics_hourly: [{ key: { "_id.hour": 1 } }],
  session_notes: [
    { key: { sessionId: 1, createdAt: 1 } },
    { key: { flagged: 1, status: 1, createdAt: -1 } },
  ],
  audit_log: [
    { key: { at: -1 } },
    { key: { actorId: 1, at: -1 } },
  ],
};

for (const [collection, specs] of Object.entries(indexes)) {
  const names = await db.collection(collection).createIndexes(specs);
  console.log(`${collection}: ${names.length} indexes ensured`);
}

// --- settings (data-model §4.9) -----------------------------------------------------------
await db.collection<{ _id: string }>("settings").updateOne(
  { _id: "global" },
  {
    $setOnInsert: {
      eventRetentionDays: DEFAULT_RETENTION_DAYS,
      rollupIntervalMin: 5,
      currency: "LKR",
      updatedAt: new Date(),
    },
  },
  { upsert: true },
);
console.log("settings: global document ensured");

await mongoose.disconnect();

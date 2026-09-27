import { randomUUID } from "node:crypto";
import { connectMongo, connectRedis, mongoose } from "@da2/shared/server";
import type { Collection, Db, Document } from "mongodb";
import { recordText } from "../lib";
import { screenshot } from "../screenshot";
import { API, Client, reachable } from "../http";
import type { EvidenceSet } from "./index";

const phase = "04-checkout";
const WEB = "http://localhost:5173";
const STREAM = "events:ingest";

// The contested item (seeded with stock 1) and an accessory that is always in stock.
const PHONE = "IP16PM-1T-DT";
const CHARGER = "SMS-45W";
const RACERS = 20;

const checkoutBody = (email: string, payment = "cod") => ({
  contact: { name: "Race Tester", email },
  address: { line1: "1 Test Lane", city: "Colombo" },
  payment,
});

export const checkout: EvidenceSet = {
  description: "Stock race (transaction vs naive), rollback, order snapshot, server events, checkout screenshots",
  async run() {
    if (!(await reachable(`${API}/health`))) throw new Error(`API not running at ${API}`);
    const db = (await connectMongo()).db as unknown as Db;
    const redis = connectRedis();
    const products = db.collection("products");
    const stockOf = async (sku: string) => ((await products.findOne({ "variants.sku": sku }, { projection: { "variants.$": 1 } })) as any).variants[0].stock as number;
    const setStock = (sku: string, stock: number) => products.updateOne({ "variants.sku": sku }, { $set: { "variants.$.stock": stock } });
    const original = { phone: await stockOf(PHONE), charger: await stockOf(CHARGER) };

    try {
      // 1. Naive read-then-write vs atomic conditional update, directly against MongoDB
      await setStock(PHONE, 1);
      let naiveSold = 0;
      await Promise.all(
        Array.from({ length: RACERS }, async () => {
          const stock = await stockOf(PHONE); // every buyer reads "1 left"...
          if (stock >= 1) {
            await products.updateOne({ "variants.sku": PHONE }, { $set: { "variants.$.stock": stock - 1 } }); // ...and writes 0
            naiveSold++;
          }
        }),
      );
      const naiveStockAfter = await stockOf(PHONE);

      await setStock(PHONE, 1);
      const results = await Promise.all(
        Array.from({ length: RACERS }, () =>
          products.updateOne({ variants: { $elemMatch: { sku: PHONE, stock: { $gte: 1 } } } }, { $inc: { "variants.$.stock": -1 } }),
        ),
      );
      const atomicSold = results.reduce((n, r) => n + r.modifiedCount, 0);
      const atomicStockAfter = await stockOf(PHONE);

      recordText(
        {
          phase,
          name: "oversell-naive-vs-atomic",
          title: "Overselling: read-then-write vs conditional update",
          shows: `${RACERS} concurrent buyers, 1 unit in stock. The naive approach (read stock, then write stock-1) sells ${naiveSold} units: a lost-update race. The single atomic conditional update ($elemMatch stock >= 1 + $inc) sells exactly ${atomicSold}.`,
          reportSection: "7. Characteristics: atomic single-document operations / 9. Strengths",
        },
        {
          command: "Promise.all of 20 concurrent operations directly against MongoDB",
          body: [
            "# naive: find() the stock, check it in application code, then $set stock - 1",
            `units sold: ${naiveSold}   stock after: ${naiveStockAfter}   -> oversold by ${naiveSold - 1}`,
            "",
            "# atomic: updateOne({ variants: { $elemMatch: { sku, stock: { $gte: 1 } } } }, { $inc: { 'variants.$.stock': -1 } })",
            `units sold: ${atomicSold}   stock after: ${atomicStockAfter}   -> correct`,
            "",
            "Why: MongoDB applies the filter and the update to a single document atomically, so only one",
            "operation can observe stock >= 1. The naive version checks the stock in application code,",
            "and every buyer reads the same value before anyone writes.",
          ].join("\n"),
        },
      );

      // 2. Explicit rollback: decrement the charger, then fail on the phone inside one transaction
      await setStock(PHONE, 0);
      const chargerBefore = await stockOf(CHARGER);
      const session = mongoose.connection.getClient().startSession();
      let insideTx = -1;
      let phoneMatched = -1;
      try {
        session.startTransaction({ writeConcern: { w: "majority" }, readConcern: { level: "snapshot" } });
        await products.updateOne({ variants: { $elemMatch: { sku: CHARGER, stock: { $gte: 1 } } } }, { $inc: { "variants.$.stock": -1 } }, { session });
        insideTx = ((await products.findOne({ "variants.sku": CHARGER }, { projection: { "variants.$": 1 }, session })) as any).variants[0].stock;
        phoneMatched = (await products.updateOne({ variants: { $elemMatch: { sku: PHONE, stock: { $gte: 1 } } } }, { $inc: { "variants.$.stock": -1 } }, { session })).matchedCount;
        await session.abortTransaction(); // what the checkout route does when a line is out of stock
      } finally {
        await session.endSession();
      }
      const chargerAfter = await stockOf(CHARGER);
      recordText(
        {
          phase,
          name: "transaction-rollback",
          title: "Multi-document transaction rollback",
          shows: "Inside a transaction the charger's stock is decremented, then the phone turns out to be sold out. Aborting rolls the charger back: all-or-nothing (ACID atomicity).",
          reportSection: "7. Characteristics: ACID transactions",
        },
        {
          command: "session.startTransaction(); updateOne(charger); updateOne(phone); abortTransaction()",
          body: [
            `charger stock before transaction:          ${chargerBefore}`,
            `charger stock inside transaction:          ${insideTx}   (decremented, visible only inside the transaction)`,
            `phone decrement matched documents:         ${phoneMatched}   (sold out -> abort)`,
            `charger stock after abortTransaction():    ${chargerAfter}   (rolled back)`,
          ].join("\n"),
        },
      );

      // 3. The real endpoint: RACERS shoppers each with [charger, phone] in their cart, checking out at once
      await setStock(PHONE, 1);
      const chargerStart = await stockOf(CHARGER);
      const lastId = ((await redis.xrevrange(STREAM, "+", "-", "COUNT", 1))[0]?.[0]) ?? "0-0";
      const racers = Array.from({ length: RACERS }, () => new Client({ "X-Session-Id": randomUUID(), "X-Anonymous-Id": randomUUID() }));
      for (const c of racers) {
        await c.post("/cart/items", { sku: CHARGER, qty: 1 });
        await c.post("/cart/items", { sku: PHONE, qty: 1 });
      }
      const started = Date.now();
      const statuses = await Promise.all(racers.map((c, i) => c.post("/checkout", checkoutBody(`race-test+${i}@cellora.test`)).then((r) => r.status)));
      const elapsed = Date.now() - started;
      const tally = statuses.reduce<Record<number, number>>((t, s) => ({ ...t, [s]: (t[s] ?? 0) + 1 }), {});
      const orders = await db.collection("orders").countDocuments({ guestEmail: /^race-test\+/ });
      const newEvents = (await redis.xrange(STREAM, `(${lastId}`, "+")).map(([id, f]) => ({ id, e: JSON.parse(f[1]) }));
      const raceEvents = newEvents.filter((x) => x.e.type === "order_placed" || x.e.type === "checkout_failed");
      const eventTally = raceEvents.reduce<Record<string, number>>((t, x) => {
        const k = x.e.type === "checkout_failed" ? `checkout_failed(${x.e.props.reason})` : x.e.type;
        return { ...t, [k]: (t[k] ?? 0) + 1 };
      }, {});

      recordText(
        {
          phase,
          name: "checkout-race",
          title: `Checkout race: ${RACERS} customers, 1 unit left`,
          shows: `${RACERS} concurrent POST /api/checkout requests, each for [45W charger, last 1TB iPhone 16 Pro Max]. Exactly one order is created, the phone is not oversold, and the losers' charger decrements are rolled back (charger stock drops by exactly 1).`,
          reportSection: "6. Implementation: checkout transaction / 9. Strengths / 11. Evaluation",
        },
        {
          command: `${RACERS} x Promise.all(POST /api/checkout)`,
          body: [
            `HTTP responses:       ${Object.entries(tally).map(([s, n]) => `${n} x ${s}`).join(", ")}   (201 = order placed, 409 = sold out)`,
            `orders created:       ${orders}`,
            `phone (${PHONE}) stock:  1 -> ${await stockOf(PHONE)}`,
            `charger (${CHARGER}) stock:   ${chargerStart} -> ${await stockOf(CHARGER)}   (only the winner's charger was sold)`,
            `server events queued: ${Object.entries(eventTally).map(([k, n]) => `${n} x ${k}`).join(", ")}`,
            `wall time:            ${elapsed} ms for ${RACERS} checkouts`,
          ].join("\n"),
        },
      );

      // Clean up the race: remove its orders and events so they don't pollute analytics
      await db.collection("orders").deleteMany({ guestEmail: /^race-test\+/ });
      if (raceEvents.length) await redis.xdel(STREAM, ...raceEvents.map((x) => x.id));
    } finally {
      await setStock(PHONE, original.phone);
      await setStock(CHARGER, original.charger);
    }

    // 4. A real order by the demo customer, and its document
    const customer = new Client({ "X-Session-Id": randomUUID(), "X-Anonymous-Id": randomUUID() });
    await customer.login("customer@cellora.test");
    await redis.del(`cart:u:${(await customer.get("/auth/me")).body.user.id}`);
    await customer.post("/cart/items", { sku: "PX9P-256-O", qty: 1 });
    await customer.post("/cart/items", { sku: "SPTA-PIXEL9PRO-B", qty: 1 });
    await customer.post("/cart/items", { sku: "GGL-45W", qty: 1 });
    const placed = await customer.post("/checkout", {
      contact: { name: "Kasun Perera", email: "customer@cellora.test", phone: "0771234567" },
      address: { line1: "42 Galle Road", line2: "Kollupitiya", city: "Colombo 03", postcode: "00300" },
      payment: "card_approve",
    });
    const orderNumber = placed.body.orderNumber as string;
    const orderDoc: Document | null = await db.collection("orders").findOne({ orderNumber }, { projection: { __v: 0 } });
    recordText(
      {
        phase,
        name: "order-document",
        title: "Order document (embedded snapshot)",
        shows: "Line items and the delivery address are embedded copies taken at checkout (name, variant, unit price), so the order stays correct even if the product is later renamed or repriced. customerId references the user; sessionId links the order to its telemetry.",
        reportSection: "5. Data model: embed vs reference (orders)",
      },
      { lang: "json", command: `db.orders.findOne({ orderNumber: "${orderNumber}" })`, body: JSON.stringify(orderDoc, null, 2) },
    );

    // 5. The server events waiting in the Redis Stream for the Phase 5 worker
    const recent = await redis.xrevrange(STREAM, "+", "-", "COUNT", 3);
    recordText(
      {
        phase,
        name: "server-events-stream",
        title: "Server events in the Redis Stream",
        shows: "Trusted events (order_placed, checkout_failed) are appended by the API to the events:ingest stream with XADD, capped with MAXLEN ~ 100000. The ingest worker (Phase 5) moves them into MongoDB.",
        reportSection: "6. Implementation: telemetry ingestion",
      },
      {
        command: "XLEN events:ingest; XREVRANGE events:ingest + - COUNT 3",
        body: [`XLEN ${STREAM} = ${await redis.xlen(STREAM)}`, "", ...recent.map(([id, f]) => `${id}\n${JSON.stringify(JSON.parse(f[1]), null, 2)}`)].join("\n"),
      },
    );
    redis.disconnect();

    // 6. Screenshots
    if (!(await reachable(WEB))) {
      console.log(`  – skipped screenshots (web app not running at ${WEB})`);
      return;
    }
    const password = process.env.SEED_USER_PASSWORD;
    const loginWithCart = async (context: import("playwright").BrowserContext) => {
      await context.request.post(`${WEB}/api/auth/login`, { data: { email: "customer@cellora.test", password } });
      for (const sku of ["GS25U-256-TS", "SPUH-GALAXYS25ULTRA-C"]) await context.request.post(`${WEB}/api/cart/items`, { data: { sku, qty: 1 } });
    };
    const login = async (context: import("playwright").BrowserContext) => {
      await context.request.post(`${WEB}/api/auth/login`, { data: { email: "customer@cellora.test", password } });
    };
    await screenshot(
      { phase, name: "order-confirmation", title: "Order confirmation", shows: "Confirmation page rendered from the order's embedded snapshot.", reportSection: "6. Implementation: checkout (UC11)" },
      { url: `${WEB}/orders/${orderNumber}?placed=1`, setup: login },
    );
    await screenshot(
      { phase, name: "order-history", title: "Order history", shows: "The customer's orders, newest first (index {customerId: 1, createdAt: -1}).", reportSection: "6. Implementation: order history (UC13)" },
      { url: `${WEB}/orders`, setup: login, fullPage: false },
    );
    await screenshot(
      { phase, name: "checkout-page", title: "Checkout page", shows: "Checkout for a logged-in customer: delivery address, simulated payment options (no card data collected), live order summary.", reportSection: "6. Implementation: checkout (UC11)" },
      {
        url: `${WEB}/checkout`,
        setup: loginWithCart,
        prepare: async (page) => {
          await page.getByLabel("Address line 1").fill("42 Galle Road");
          await page.getByLabel("City").fill("Colombo 03");
        },
        fullPage: false,
      },
    );
    // Leave the demo customer's cart empty after the screenshots
    const cleanup = connectRedis();
    await cleanup.del(`cart:u:${(await customer.get("/auth/me")).body.user?.id ?? ""}`);
    cleanup.disconnect();
  },
};

// Live traffic: simulated shoppers using the REAL HTTP API (cart, login, checkout, telemetry),
// so dashboards show current activity ("active users now") during a demo.
//
//   npm run sim:live -- --rate 12 --speed 0.15 --minutes 10
//     rate    new sessions per minute
//     speed   multiplier on the think-time between clicks (0.15 = ~7x faster than a human)
//     minutes stop after N minutes (0 = run until Ctrl+C)
//
// Checkouts are real: they decrement stock and create orders (guest emails sim-live-*@example.test).
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { connectMongo, mongoose } from "@da2/shared/server";
import type { Db } from "mongodb";
import { Client } from "../evidence/http";
import { buildCatalog, planSession, rng, type SessionPlan } from "./model";
import { CITIES, ensureSimUsers, loadCatalog } from "./shared";

const { values: args } = parseArgs({
  options: {
    rate: { type: "string", default: "12" },
    speed: { type: "string", default: "0.15" },
    minutes: { type: "string", default: "0" },
    seed: { type: "string", default: String(Date.now() % 100_000) },
  },
});
const rate = Number(args.rate);
const speed = Number(args.speed);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const db = (await connectMongo()).db as unknown as Db;
const users = await ensureSimUsers(db);
let catalog = buildCatalog(await loadCatalog(db));
const r = rng(Number(args.seed));
const stats = { started: 0, active: 0, events: 0, orders: 0, failed: 0, errors: 0 };

async function runSession(plan: SessionPlan) {
  const sessionId = randomUUID();
  const client = new Client({ "User-Agent": plan.device.userAgent, "X-Anonymous-Id": plan.anonymousId, "X-Session-Id": sessionId });
  let path = "";
  let cart = { subtotal: 0, itemCount: 0 };

  const send = async (events: { type: string; props: Record<string, unknown> }[], pagePath: string) => {
    const r = await client.post("/events", {
      anonymousId: plan.anonymousId,
      sessionId,
      events: events.map((e) => ({ eventId: randomUUID(), ts: new Date().toISOString(), page: { path: pagePath }, ...e })),
    });
    stats.events += r.body?.accepted ?? 0;
  };
  // Mirrors the browser: a page_view on every navigation, then the page's own event
  const view = (pagePath: string, extra?: { type: string; props: Record<string, unknown> }) => {
    const batch = pagePath !== path ? [{ type: "page_view", props: { title: "Cellora" } }] : [];
    path = pagePath;
    return send(extra ? [...batch, extra] : batch, pagePath);
  };

  if (plan.user) await client.login(plan.user.email); // remembered login: no identify event

  for (const { gapMs, step } of plan.steps) {
    await sleep(gapMs * speed);
    switch (step.t) {
      case "page":
        await view(step.path);
        break;
      case "category":
        await view(step.path, { type: "category_view", props: { kind: step.kind, filters: { sort: "price_asc", page: 1 } } });
        break;
      case "product":
        await client.get(`/products/${step.product.slug}`);
        await view(step.path, { type: "product_view", props: { productId: step.product._id, kind: step.product.kind, basePrice: step.product.basePrice } });
        break;
      case "search": {
        const res = await client.get(`/search?q=${encodeURIComponent(step.query)}`);
        await view(step.path, { type: "search", props: { query: step.query, resultCount: res.body?.total ?? 0 } });
        break;
      }
      case "add": {
        const res = await client.post("/cart/items", { sku: step.variant.sku, qty: 1 });
        if (res.status !== 200) break; // sold out since the catalog snapshot
        cart = res.body;
        await send([{ type: "add_to_cart", props: { productId: step.product._id, sku: step.variant.sku, kind: step.product.kind, qty: 1, unitPrice: step.variant.price } }], path);
        break;
      }
      case "remove": {
        const res = await client.request("DELETE", `/cart/items/${encodeURIComponent(step.sku)}`);
        cart = res.body ?? cart;
        await view(step.path, { type: "remove_from_cart", props: { sku: step.sku, qty: step.qty } });
        break;
      }
      case "login": {
        const user = await client.login(step.user.email);
        await view(step.path, { type: "identify", props: { customerId: user.id, via: "login" } });
        break;
      }
      case "checkout":
        if (!cart.itemCount) return; // everything sold out
        await view(step.path, { type: "checkout_started", props: { cartValue: cart.subtotal, itemCount: cart.itemCount } });
        break;
      case "pay":
        await send([{ type: "payment_submitted", props: { method: step.method } }], path);
        break;
      case "place": {
        const payStep = plan.steps.find((s) => s.step.t === "pay")!.step as { method: string };
        const res = await client.post("/checkout", {
          contact: { name: "Live Shopper", email: `sim-live-${sessionId.slice(0, 8)}@example.test` },
          address: { line1: `${r.int(1, 300)} Main Street`, city: r.pick(CITIES) },
          payment: payStep.method,
        });
        // The API itself emits order_placed / checkout_failed (trusted server events)
        if (res.status === 201) {
          stats.orders++;
          await view(`/orders/${res.body.orderNumber}`);
        } else stats.failed++;
        break;
      }
    }
  }
}

console.log(`live traffic: ${rate} sessions/min, think-time x${speed}. Ctrl+C to stop.`);
const endAt = Number(args.minutes) > 0 ? Date.now() + Number(args.minutes) * 60_000 : Infinity;
setInterval(async () => {
  // Pick up stock changes. If MongoDB is unavailable (e.g. during a failover test), keep the old
  // catalogue: a rejected promise in a timer callback would otherwise crash the process.
  try {
    catalog = buildCatalog(await loadCatalog(db));
  } catch (err) {
    console.warn("catalogue refresh failed, keeping the previous one:", err instanceof Error ? err.message : err);
  }
}, 60_000).unref();
const report = setInterval(() => {
  console.log(`[${new Date().toLocaleTimeString()}] sessions started ${stats.started}, active ${stats.active}, events ${stats.events}, orders ${stats.orders}, failed checkouts ${stats.failed}, errors ${stats.errors}`);
}, 15_000);

while (Date.now() < endAt) {
  const plan = planSession(r, catalog, users);
  stats.started++;
  stats.active++;
  runSession(plan)
    .catch(() => stats.errors++)
    .finally(() => stats.active--);
  await sleep((60_000 / rate) * (0.5 + r.next())); // Poisson-ish arrivals
}
clearInterval(report);
while (stats.active > 0) await sleep(500);
console.log(`finished: ${JSON.stringify(stats)}`);
await mongoose.disconnect();
process.exit(0);

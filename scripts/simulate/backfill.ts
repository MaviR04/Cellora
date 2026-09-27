// Historical traffic backfill: generates N days of shopper sessions and pushes their events
// through the SAME pipeline as real traffic (Redis Stream -> ingest worker -> time-series
// collection). Orders placed in those sessions are inserted directly with backdated dates.
//
//   npm run sim:backfill -- --days 14 --per-day 900        (worker must be running)
//   npm run sim:backfill -- --reset                        (remove all simulated data)
//
// Simulated data is flagged (events.sim, orders.simulated, users sim-NNN@cellora.test) so it
// can be told apart from real traffic and removed.
import { parseArgs } from "node:util";
import { connectMongo, connectRedis, mongoose } from "@da2/shared/server";
import { clientEventSchema, serverEventSchema } from "@da2/shared";
import type { Db } from "mongodb";
import { buildCatalog, cartOf, HOURLY_WEIGHTS, planSession, rng, SEARCHES, type SessionPlan, type Rng } from "./model";
import { CITIES, ensureSimUsers, loadCatalog, searchResultCounts } from "./shared";

const { values: args } = parseArgs({
  options: {
    days: { type: "string", default: "14" },
    "per-day": { type: "string", default: "900" },
    seed: { type: "string", default: "7" },
    reset: { type: "boolean", default: false },
  },
});

const STREAM = "events:ingest";
const GROUP = "ingest-workers";
const MAX_LAG = 30_000; // backpressure: stream MAXLEN is ~100k, never let unread entries get trimmed
const DAY = 86_400_000;
const COLOMBO_OFFSET_MS = 5.5 * 3_600_000;
const { ObjectId } = mongoose.Types;

const db = (await connectMongo()).db as unknown as Db;
const redis = connectRedis();

if (args.reset) {
  const e = await db.collection("events").deleteMany({ sim: true });
  const o = await db.collection("orders").deleteMany({ simulated: true });
  const u = await db.collection("users").deleteMany({ email: /^sim-\d+@cellora\.test$/ });
  console.log(`removed ${e.deletedCount} simulated events, ${o.deletedCount} orders, ${u.deletedCount} users`);
  await finish();
}

const days = Number(args.days);
const perDay = Number(args["per-day"]);
const r = rng(Number(args.seed));
const users = await ensureSimUsers(db);
const catalog = buildCatalog(await loadCatalog(db));
const resultCounts = await searchResultCounts(db, SEARCHES.map(([q]) => q));
const userById = new Map(users.map((u) => [u._id, u]));

/** Stream lag of the ingest worker's consumer group (entries not yet delivered). */
async function lag(): Promise<number> {
  const groups = (await redis.xinfo("GROUPS", STREAM)) as any[];
  const g = groups.map((x) => Object.fromEntries(x.reduce((a: any[], v: any, i: number, arr: any[]) => (i % 2 ? a : [...a, [v, arr[i + 1]]]), []))).find((x) => x.name === GROUP);
  if (!g) throw new Error("ingest worker consumer group not found: start the worker (npm run dev:worker)");
  return Number(g.lag ?? 0) + Number(g.pending ?? 0);
}

/** Traffic shape: gentle growth, busier weekends, a promo spike 5 days ago. */
function sessionsForDay(daysAgo: number, dayStart: Date) {
  const growth = 1 - daysAgo * 0.012;
  const weekday = new Date(dayStart.getTime() + COLOMBO_OFFSET_MS).getUTCDay();
  const weekend = weekday === 0 || weekday === 6 ? 1.25 : 1;
  const promo = daysAgo === 5 ? 1.8 : 1;
  return Math.round(perDay * growth * weekend * promo * (0.93 + r.next() * 0.14));
}

type Doc = Record<string, any>;

function sessionEvents(plan: SessionPlan, start: Date, sessionId: string, orderNumber: (n: number) => string, orders: Doc[], rr: Rng): Doc[] {
  const out: Doc[] = [];
  let t = start.getTime();
  let customerId: string | null = plan.user?._id ?? null;
  let lastPath = "";
  const device = { type: plan.device.type, os: plan.device.os, browser: plan.device.browser };
  const cartSoFar: { price: number }[] = [];

  const emit = (type: string, props: Doc, path: string, source: "client" | "server" = "client") => {
    const e = { eventId: rr.uuid(), type, ts: new Date(t), page: { path }, props };
    const parsed = (source === "client" ? clientEventSchema : serverEventSchema).parse(e); // same rules as the API
    out.push({
      ...parsed,
      source,
      meta: { anonymousId: plan.anonymousId, sessionId, customerId },
      ...(source === "client" && { device }),
      receivedAt: new Date(t + rr.int(80, 2500)),
      sim: true,
    });
  };
  const navigate = (path: string) => {
    if (path !== lastPath) emit("page_view", { title: "Cellora" }, path);
    lastPath = path;
  };

  for (const { gapMs, step } of plan.steps) {
    t += gapMs;
    switch (step.t) {
      case "page":
        navigate(step.path);
        break;
      case "category":
        navigate(step.path);
        emit("category_view", { kind: step.kind, filters: { sort: "price_asc", page: 1 } }, step.path);
        break;
      case "product":
        navigate(step.path);
        emit("product_view", { productId: step.product._id, kind: step.product.kind, basePrice: step.product.basePrice }, step.path);
        break;
      case "search":
        navigate(step.path);
        emit("search", { query: step.query, resultCount: resultCounts.get(step.query) ?? 0 }, step.path);
        break;
      case "add":
        emit("add_to_cart", { productId: step.product._id, sku: step.variant.sku, kind: step.product.kind, qty: 1, unitPrice: step.variant.price }, step.path);
        cartSoFar.push({ price: step.variant.price });
        break;
      case "remove":
        navigate(step.path);
        emit("remove_from_cart", { sku: step.sku, qty: step.qty }, step.path);
        cartSoFar.pop();
        break;
      case "login":
        navigate(step.path);
        t += 8000;
        customerId = step.user._id;
        emit("identify", { customerId, via: "login" }, step.path);
        break;
      case "checkout":
        navigate(step.path);
        emit("checkout_started", { cartValue: cartSoFar.reduce((s, l) => s + l.price, 0), itemCount: cartSoFar.length }, step.path);
        break;
      case "pay":
        emit("payment_submitted", { method: step.method }, step.path);
        break;
      case "place": {
        const lines = cartOf(plan);
        if (step.outcome !== "success") {
          emit("checkout_failed", { reason: step.outcome, ...(step.outcome === "out_of_stock" && { sku: lines[0].variant.sku }) }, step.path, "server");
          break;
        }
        const orderId = new ObjectId();
        const subtotal = lines.reduce((s, l) => s + l.variant.price * l.qty, 0);
        const shipping = subtotal >= 5_000_000 ? 0 : 50_000;
        const payStep = plan.steps.find((s) => s.step.t === "pay")!.step as { method: string };
        const number = orderNumber(orders.length);
        const user = customerId ? userById.get(customerId)! : null;
        const createdAt = new Date(t);
        const ageDays = (Date.now() - t) / DAY;
        const status = rr.chance(0.03) ? "cancelled" : ageDays > 4 ? "delivered" : ageDays > 2 ? "shipped" : payStep.method === "cod" ? "placed" : "paid";
        orders.push({
          _id: orderId,
          orderNumber: number,
          customerId: user ? new ObjectId(user._id) : null,
          ...(!user && { guestEmail: `sim-guest-${sessionId.slice(0, 8)}@example.test` }),
          contact: { name: user?.name ?? "Guest Shopper", email: user?.email ?? `sim-guest-${sessionId.slice(0, 8)}@example.test` },
          sessionId,
          anonymousId: plan.anonymousId,
          items: lines.map((l) => ({
            productId: new ObjectId(l.product._id),
            sku: l.variant.sku,
            kind: l.product.kind,
            name: l.product.name,
            brand: l.product.brand,
            variantLabel: l.variant.label,
            unitPrice: l.variant.price,
            qty: l.qty,
            lineTotal: l.variant.price * l.qty,
          })),
          totals: { subtotal, shipping, total: subtotal + shipping },
          shippingAddress: { line1: `${rr.int(1, 300)} Main Street`, city: rr.pick(CITIES), country: "Sri Lanka" },
          payment: { method: payStep.method === "cod" ? "cod" : "card", status: payStep.method === "cod" && status === "placed" ? "pending" : "paid" },
          status,
          statusHistory: [{ status: payStep.method === "cod" ? "placed" : "paid", at: createdAt }, ...(status !== "placed" && status !== "paid" ? [{ status, at: new Date(t + DAY) }] : [])],
          createdAt,
          updatedAt: createdAt,
          simulated: true,
        });
        emit("order_placed", { orderId: String(orderId), orderNumber: number, total: subtotal + shipping, itemCount: lines.length }, step.path, "server");
        t += 1500;
        navigate(`/orders/${number}`);
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
console.log(`backfilling ${days} days x ~${perDay} sessions/day (seed ${args.seed})`);
const started = Date.now();
const now = Date.now();
const cutoff = now - 30 * 60_000; // leave the last 30 minutes to live traffic
let totalSessions = 0, totalEvents = 0, totalOrders = 0;

for (let daysAgo = days; daysAgo >= 0; daysAgo--) {
  // Midnight in Sri Lanka, as a UTC instant
  const localMidnight = Math.floor((now + COLOMBO_OFFSET_MS) / DAY) * DAY - COLOMBO_OFFSET_MS - daysAgo * DAY;
  const dayStart = new Date(localMidnight);
  const count = sessionsForDay(daysAgo, dayStart);
  const hourPairs = HOURLY_WEIGHTS.map((w, h) => [h, w] as const);

  const events: Doc[] = [];
  const orders: Doc[] = [];
  let generated = 0;
  const dayKey = new Date(localMidnight + COLOMBO_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, "");
  // Order numbers are placeholders (__0, __1…) until the day's orders are counted
  for (let i = 0; i < count; i++) {
    const start = localMidnight + r.weighted(hourPairs) * 3_600_000 + r.int(0, 3599) * 1000;
    if (start > cutoff) continue;
    const plan = planSession(r, catalog, users);
    events.push(...sessionEvents(plan, new Date(start), r.uuid(), (n) => `__${n}`, orders, r));
    totalSessions++;
    generated++;
  }
  // Assign real order numbers from the same atomic counter the checkout uses
  if (orders.length) {
    const counter = await db.collection<{ _id: string; seq: number }>("counters").findOneAndUpdate(
      { _id: `order-${dayKey}` },
      { $inc: { seq: orders.length } },
      { upsert: true, returnDocument: "after" },
    );
    const first = counter!.seq - orders.length + 1;
    const rename = new Map(orders.map((o, i) => [o.orderNumber, `ORD-${dayKey}-${String(first + i).padStart(4, "0")}`]));
    for (const o of orders) o.orderNumber = rename.get(o.orderNumber);
    for (const e of events) {
      if (e.type === "order_placed") e.props.orderNumber = rename.get(e.props.orderNumber);
      if (e.page?.path?.startsWith("/orders/__")) e.page.path = `/orders/${rename.get(e.page.path.slice(8))}`;
    }
    await db.collection("orders").insertMany(orders, { ordered: false });
  }
  // Push through the pipeline in chunks, respecting the worker's pace (backpressure)
  for (let i = 0; i < events.length; i += 2000) {
    while ((await lag()) > MAX_LAG) await new Promise((res) => setTimeout(res, 250));
    const p = redis.pipeline();
    for (const e of events.slice(i, i + 2000)) p.xadd(STREAM, "MAXLEN", "~", 100_000, "*", "e", JSON.stringify(e));
    await p.exec();
  }
  totalEvents += events.length;
  totalOrders += orders.length;
  console.log(`  ${dayKey}: ${String(generated).padStart(5)} sessions, ${String(events.length).padStart(6)} events, ${String(orders.length).padStart(3)} orders`);
}

process.stdout.write("waiting for the worker to drain the stream");
while ((await lag()) > 0) {
  process.stdout.write(".");
  await new Promise((res) => setTimeout(res, 500));
}
console.log(`\ndone: ${totalSessions} sessions, ${totalEvents} events, ${totalOrders} orders in ${((Date.now() - started) / 1000).toFixed(1)} s`);
await finish();

async function finish(): Promise<never> {
  redis.disconnect();
  await mongoose.disconnect();
  process.exit(0);
}

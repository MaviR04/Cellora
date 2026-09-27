import { randomUUID } from "node:crypto";
import { connectAnalystMongo, connectMongo, connectRedis } from "@da2/shared/server";
import { FUNNEL_STEPS } from "@da2/shared";
import type { Db } from "mongodb";
import { funnelPipeline, rollupFunnel, rollupHourly, rollupSessions } from "../../../apps/worker/src/rollups";
import { recordText } from "../lib";
import { API, Client, reachable } from "../http";
import type { EvidenceSet } from "./index";

const phase = "07-rollups";
const DAY = 86_400_000;
const OFFSET = 5.5 * 3_600_000;
const localMidnight = (t: number) => Math.floor((t + OFFSET) / DAY) * DAY - OFFSET;
const localDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function time(fn: () => Promise<unknown>, runs = 5) {
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    await fn();
    t.push(performance.now() - s);
  }
  return median(t);
}
const fmt = (ms: number) => (ms < 10 ? ms.toFixed(1) : Math.round(ms).toString());

export const rollups: EvidenceSet = {
  description: "Rollup correctness vs raw, raw vs rollup vs Redis cache timings, rollup run cost, sample documents, eventual consistency",
  async run() {
    if (!(await reachable(`${API}/health`))) throw new Error(`API not running at ${API}`);
    const db = (await connectMongo()).db as unknown as Db;
    const analyst = await connectAnalystMongo();
    const redis = connectRedis();
    const events = db.collection("events");
    const funnelDaily = db.collection("funnel_daily");

    const to = localMidnight(Date.now()) + DAY;
    const from = to - 14 * DAY;
    const fromDay = localDate(new Date(from));
    const toDay = localDate(new Date(to - DAY));
    await rollupFunnel(events, new Date(from)); // make sure the rollup is current for the comparison

    // 1. Correctness: rollup totals == the same ordered-funnel pipeline run on raw events
    const rawDays = await events.aggregate(funnelPipeline(new Date(from), new Date(to)), { allowDiskUse: true }).toArray();
    const rollupDays = await funnelDaily.find({ "_id.funnel": "purchase", "_id.day": { $gte: fromDay, $lte: toDay } }).toArray();
    const sum = (docs: any[]) => FUNNEL_STEPS.map((_, i) => docs.reduce((n, d) => n + d.steps[i].sessions, 0));
    const raw = sum(rawDays);
    const rolled = sum(rollupDays);
    const eventsInRange = await events.countDocuments({ ts: { $gte: new Date(from), $lt: new Date(to) } });

    // 2. Speed: raw pipeline vs reading the rollup vs the cached API
    const rawMs = await time(() => events.aggregate(funnelPipeline(new Date(from), new Date(to)), { allowDiskUse: true }).toArray());
    const rollupMs = await time(() => analyst.db!.collection("funnel_daily").find({ "_id.funnel": "purchase", "_id.day": { $gte: fromDay, $lte: toDay } }).toArray());
    const analystClient = new Client();
    await analystClient.login("analyst@cellora.test");
    const path = `/analytics/funnel?from=${fromDay}&to=${toDay}`;
    const clearCache = async () => {
      const keys = await redis.keys("cache:funnel:*");
      if (keys.length) await redis.del(...keys);
    };
    const coldMs = await time(async () => {
      await clearCache();
      const s = performance.now();
      const r = await analystClient.get(path);
      if (r.body.cached !== false) throw new Error("expected a cache miss");
      return performance.now() - s;
    });
    await analystClient.get(path); // warm
    const warmMs = await time(async () => {
      const r = await analystClient.get(path);
      if (r.body.cached !== true) throw new Error("expected a cache hit");
    }, 9);
    const redisKey = (await redis.keys("cache:funnel:*"))[0];
    const redisGetMs = await time(() => redis.get(redisKey), 9);

    recordText(
      {
        phase,
        name: "raw-vs-rollup-vs-cache",
        title: "Funnel: raw events vs rollup vs Redis cache",
        shows: `The same 14-day ordered funnel computed three ways. The rollup gives identical numbers to the raw aggregation but reads ${rollupDays.length} small documents instead of ${eventsInRange.toLocaleString()} events; the Redis cache avoids MongoDB entirely.`,
        reportSection: "9. Strengths: pre-aggregation & caching / 11. Evaluation: performance",
      },
      {
        command: `median of repeated runs; API = GET ${path} as analyst (includes HTTP + session lookup)`,
        body: [
          "correctness (sessions reaching each step, in order)",
          `  step                 raw events   rollup   match`,
          ...FUNNEL_STEPS.map((s, i) => `  ${s.padEnd(20)} ${String(raw[i]).padStart(10)} ${String(rolled[i]).padStart(8)}   ${raw[i] === rolled[i] ? "yes" : "NO"}`),
          "",
          "speed",
          `  raw ordered-funnel pipeline over ${eventsInRange.toLocaleString()} events   ${fmt(rawMs).padStart(7)} ms`,
          `  read ${rollupDays.length} funnel_daily docs (analyst, secondary)      ${fmt(rollupMs).padStart(7)} ms   (${Math.round(rawMs / rollupMs)}x faster)`,
          `  API, cache miss (rollup + JSON + store in Redis)   ${fmt(coldMs).padStart(7)} ms`,
          `  API, cache hit (Redis only)                        ${fmt(warmMs).padStart(7)} ms`,
          `  bare Redis GET of the cached result                ${fmt(redisGetMs).padStart(7)} ms`,
          "",
          "The raw pipeline's cost grows with the number of events; the rollup's cost grows only with",
          "the number of days. The price: rollups are recomputed every 5 minutes (stale by up to one",
          "interval) and the cache adds up to 60 s more (eventual consistency, accepted for analytics).",
        ].join("\n"),
      },
    );

    // 3. Cost of producing the rollups: full rebuild vs incremental (last hour)
    const full: Record<string, number> = {};
    const incr: Record<string, number> = {};
    for (const [name, fn] of [["session_summaries", rollupSessions], ["metrics_hourly", rollupHourly], ["funnel_daily", rollupFunnel]] as const) {
      let s = performance.now();
      await fn(events, new Date(0));
      full[name] = performance.now() - s;
      s = performance.now();
      await fn(events, new Date(Date.now() - 3_600_000));
      incr[name] = performance.now() - s;
    }
    const counts = Object.fromEntries(await Promise.all(["session_summaries", "metrics_hourly", "funnel_daily"].map(async (c) => [c, await db.collection(c).estimatedDocumentCount()])));
    recordText(
      {
        phase,
        name: "rollup-run-cost",
        title: "Rollup run cost: full rebuild vs incremental",
        shows: "Each rollup is an aggregation ending in $merge (upsert into the target collection). The worker runs them incrementally every 5 minutes, recomputing only the recent window, so the cost stays small as history grows. A full rebuild is only needed after a logic change (Admin: UC6).",
        reportSection: "6. Implementation: rollups / 11. Evaluation",
      },
      {
        command: "rollupSessions / rollupHourly / rollupFunnel with since = epoch (full) and since = 1 hour ago (incremental)",
        body: [
          "rollup               documents   full rebuild   incremental (last hour)",
          ...Object.keys(full).map((k) => `${k.padEnd(20)} ${String(counts[k]).padStart(9)}   ${fmt(full[k]).padStart(9)} ms   ${fmt(incr[k]).padStart(9)} ms`),
        ].join("\n"),
      },
    );

    // 4. Sample documents: a session summary and one day of hourly activity
    const summary = await db.collection("session_summaries").findOne({ "reached.orderPlaced": true, simulated: true, customerId: { $ne: null } });
    const lastFullDay = localDate(new Date(to - 2 * DAY));
    const dayStart = new Date(localMidnight(to - 2 * DAY));
    const hourly = await db
      .collection("metrics_hourly")
      .find({ "_id.type": "page_view", "_id.hour": { $gte: dayStart, $lt: new Date(dayStart.getTime() + DAY) } })
      .sort({ "_id.hour": 1 })
      .toArray();
    const max = Math.max(...hourly.map((h) => h.count), 1);
    recordText(
      {
        phase,
        name: "rollup-documents",
        title: "Rollup documents: a session summary and a day of hourly activity",
        shows: "session_summaries gives Support one small document per session (landing page, device, funnel steps reached, orders). metrics_hourly gives the Analyst ready-made time series; here the evening peak in Sri Lanka is visible.",
        reportSection: "5. Data model: materialised views",
      },
      {
        lang: "text",
        command: `db.session_summaries.findOne({ "reached.orderPlaced": true }); db.metrics_hourly.find({ "_id.type": "page_view", day ${lastFullDay} })`,
        body: [
          JSON.stringify(summary, null, 2),
          "",
          `page views per hour on ${lastFullDay} (Sri Lanka time)`,
          ...hourly.map((h) => {
            const local = new Date((h._id as any).hour.getTime() + OFFSET).toISOString().slice(11, 13);
            return `  ${local}:00  ${String(h.count).padStart(4)}  ${"█".repeat(Math.round((h.count / max) * 40))}`;
          }),
        ].join("\n"),
      },
    );

    // 5. Eventual consistency, observed: a new order is in the raw events before the rollup sees it
    const today = localDate(new Date());
    const todayOrders = async () => ((await funnelDaily.findOne({ _id: { day: today, funnel: "purchase" } as any }))?.steps?.[3]?.sessions ?? 0) as number;
    const rawTodayOrders = async () =>
      (await events.aggregate(funnelPipeline(new Date(localMidnight(Date.now())))).toArray())[0]?.steps?.[3]?.sessions ?? 0;
    await rollupFunnel(events, new Date());
    const before = { raw: await rawTodayOrders(), rollup: await todayOrders() };

    // A fresh shopper: views, adds to cart, checks out (real API + real telemetry)
    const sessionId = randomUUID();
    const anonymousId = randomUUID();
    const shopper = new Client({ "X-Session-Id": sessionId, "X-Anonymous-Id": anonymousId });
    const product = (await shopper.get("/products/pixel-9a")).body;
    const variant = product.variants.find((v: any) => v.stock > 0);
    const cart = (await shopper.post("/cart/items", { sku: variant.sku, qty: 1 })).body;
    const ev = (type: string, props: Record<string, unknown>) => ({ eventId: randomUUID(), type, ts: new Date().toISOString(), page: { path: "/" }, props });
    await shopper.post("/events", {
      anonymousId,
      sessionId,
      events: [
        ev("product_view", { productId: product._id, kind: product.kind, basePrice: product.basePrice }),
        ev("add_to_cart", { productId: product._id, sku: variant.sku, kind: product.kind, qty: 1, unitPrice: variant.price }),
        ev("checkout_started", { cartValue: cart.subtotal, itemCount: cart.itemCount }),
      ],
    });
    await sleep(300);
    const placed = await shopper.post("/checkout", { contact: { name: "Consistency Check", email: "consistency-check@example.test" }, address: { line1: "1 Test Lane", city: "Colombo" }, payment: "cod" });
    for (let i = 0; i < 40 && !(await events.findOne({ "meta.sessionId": sessionId, type: "order_placed" })); i++) await sleep(250);
    const afterOrder = { raw: await rawTodayOrders(), rollup: await todayOrders() };
    await rollupFunnel(events, new Date());
    const afterRollup = { raw: await rawTodayOrders(), rollup: await todayOrders() };

    recordText(
      {
        phase,
        name: "eventual-consistency",
        title: "Eventual consistency: raw events vs rollup",
        shows: "A new order reaches the raw events collection within about a second (via the stream and worker) but the funnel rollup still shows the old number until its next run. After the rollup runs, both agree. This is the staleness window accepted for analytics.",
        reportSection: "7. Characteristics: eventual consistency (BASE)",
      },
      {
        command: "count today's ordered-funnel orders from raw events and from funnel_daily, before and after one new order",
        body: [
          "                                   raw events   funnel_daily rollup",
          `before the new order                ${String(before.raw).padStart(9)}   ${String(before.rollup).padStart(9)}`,
          `new order ${String(placed.body?.orderNumber).padEnd(19)}      ${String(afterOrder.raw).padStart(9)}   ${String(afterOrder.rollup).padStart(9)}   <- rollup is stale`,
          `after the next rollup run           ${String(afterRollup.raw).padStart(9)}   ${String(afterRollup.rollup).padStart(9)}   <- consistent again`,
        ].join("\n"),
      },
    );
    // Remove the check order again (it was only for this demonstration)
    await db.collection("orders").deleteOne({ orderNumber: placed.body?.orderNumber });
    await db.collection("products").updateOne({ "variants.sku": variant.sku }, { $inc: { "variants.$.stock": 1 } });

    await analyst.close();
    redis.disconnect();
  },
};

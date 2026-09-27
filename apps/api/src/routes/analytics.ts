// Analyst endpoints (UC1–UC3). Every MongoDB query here runs on the READ-ONLY analyst connection
// (da2_analyst, readPreference secondaryPreferred): it reads from a secondary to keep load off
// the primary, and MongoDB itself would reject any write.
//
//   GET /analytics/live     UC1  Redis live counters + the latest events         (cache 5 s)
//   GET /analytics/funnel   UC2  funnel_daily rollup                              (cache 60 s)
//   GET /analytics/trends   UC1  metrics_hourly rollup                            (cache 60 s)
//   GET /analytics/top      UC1  top products / searches from raw events          (cache 60 s)
//   GET /analytics/export   UC3  any of the reports above as CSV or JSON
import { Router } from "express";
import type { Redis } from "ioredis";
import type { Connection } from "mongoose";
import { z } from "zod";
import {
  EVENT_TYPES,
  EXPORT_REPORTS,
  FUNNEL_STEPS,
  minuteKey,
  type FunnelResponse,
  type LiveActivity,
  type RecentEvent,
  type TopResponse,
  type TrendsResponse,
} from "@da2/shared";
import { parse } from "../lib/http";
import { cached } from "../lib/cache";
import { requireRole } from "../middleware/session";

const CACHE_TTL = 60;
const LIVE_CACHE_TTL = 5;
const ACTIVE_WINDOW_MIN = 5;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const localDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
/** Start of a Sri Lanka local day, as a UTC instant. */
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayEnd = (d: string) => new Date(dayStart(d).getTime() + 86_400_000); // exclusive
/** Same as localDate, by arithmetic: Intl formatting costs ~0.2 ms a call, too slow per row. */
const localDateFast = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

const range = z.object({
  from: day.default(() => localDate(new Date(Date.now() - 13 * 86_400_000))),
  to: day.default(() => localDate(new Date())),
});
const funnelQuery = range.extend({ device: z.enum(["mobile", "desktop", "tablet"]).optional() });
type Range = z.infer<typeof range>;

/** Event types shown on the trends chart (the rest are still in the export). */
const TREND_TYPES = ["page_view", "product_view", "search", "add_to_cart", "checkout_started", "order_placed", "checkout_failed"];

export function analyticsRouter(redis: Redis, analyst: Connection) {
  const router = Router();
  const db = () => analyst.db!;
  router.use("/analytics", requireRole("analyst", "admin"));

  // ---- UC2: ordered purchase funnel ------------------------------------------------------------
  async function funnel(q: z.infer<typeof funnelQuery>): Promise<Omit<FunnelResponse, "cached">> {
    // Index: the compound _id {day, funnel} -> a range scan over at most a few dozen documents
    const days = await db()
      .collection("funnel_daily")
      .find({ "_id.funnel": "purchase", "_id.day": { $gte: q.from, $lte: q.to } })
      .sort({ "_id.day": 1 })
      .toArray();

    const series = (d: any) => (q.device ? d.byDevice?.[q.device] ?? [] : d.steps).map((s: any) => s.sessions as number);
    const byDay = days.map((d: any) => ({ day: d._id.day as string, steps: FUNNEL_STEPS.map((_, i) => series(d)[i] ?? 0) }));
    const totals = FUNNEL_STEPS.map((_, i) => byDay.reduce((n, d) => n + d.steps[i], 0));
    const byDevice: Record<string, number[]> = {};
    for (const d of days as any[]) {
      for (const [device, steps] of Object.entries<any[]>(d.byDevice ?? {})) {
        byDevice[device] ??= FUNNEL_STEPS.map(() => 0);
        steps.forEach((s, i) => (byDevice[device][i] += s.sessions));
      }
    }
    return {
      ...q,
      device: q.device ?? null,
      steps: FUNNEL_STEPS.map((step, i) => ({
        step,
        sessions: totals[i],
        fromPrevious: i === 0 ? 1 : totals[i - 1] ? totals[i] / totals[i - 1] : 0,
        fromStart: totals[0] ? totals[i] / totals[0] : 0,
      })),
      byDay,
      byDevice,
      source: "rollup",
      computedAt: new Date().toISOString(),
    };
  }

  router.get("/analytics/funnel", async (req, res) => {
    const q = parse(funnelQuery, req.query);
    const { value, hit } = await cached(redis, "funnel", q, CACHE_TTL, () => funnel(q));
    res.json({ ...value, cached: hit } satisfies FunnelResponse);
  });

  // ---- UC1: hourly trends from the metrics_hourly rollup ---------------------------------------
  async function trends(q: Range): Promise<Omit<TrendsResponse, "cached">> {
    // Index {"_id.hour": 1}: a range scan over ~24 × (event types) small documents per day
    const rows = await db()
      .collection("metrics_hourly")
      .find({ "_id.hour": { $gte: dayStart(q.from), $lt: dayEnd(q.to) } })
      .toArray();

    const hours = new Map<number, TrendsResponse["hours"][number]>();
    const days = new Map<string, Record<string, number>>();
    for (const r of rows as any[]) {
      const hour: Date = r._id.hour;
      const type: string = r._id.type;
      const h = hours.get(hour.getTime()) ?? { hour: hour.toISOString(), counts: {}, sessions: 0 };
      h.counts[type] = r.count;
      // Sessions active that hour ~ distinct sessions that viewed a page (every session starts with one)
      if (type === "page_view") h.sessions = r.uniqueSessions;
      hours.set(hour.getTime(), h);
      const d = localDateFast(hour);
      const dc = days.get(d) ?? {};
      dc[type] = (dc[type] ?? 0) + r.count;
      days.set(d, dc);
    }
    return {
      ...q,
      types: TREND_TYPES,
      hours: [...hours.values()].sort((a, b) => a.hour.localeCompare(b.hour)),
      days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, counts]) => ({ day, counts })),
    };
  }

  router.get("/analytics/trends", async (req, res) => {
    const q = parse(range, req.query);
    const { value, hit } = await cached(redis, "trends", q, CACHE_TTL, () => trends(q));
    res.json({ ...value, cached: hit } satisfies TrendsResponse);
  });

  // ---- UC1: top products and searches (raw events, cached) -------------------------------------
  async function top(q: Range): Promise<Omit<TopResponse, "cached">> {
    const ts = { $gte: dayStart(q.from), $lt: dayEnd(q.to) };
    const events = db().collection("events");

    // Index {type: 1, ts: 1}: only product_view / add_to_cart events in the range are read
    const products = await events
      .aggregate([
        { $match: { type: { $in: ["product_view", "add_to_cart"] }, ts } },
        {
          $group: {
            _id: "$props.productId",
            views: { $sum: { $cond: [{ $eq: ["$type", "product_view"] }, 1, 0] } },
            addToCart: { $sum: { $cond: [{ $eq: ["$type", "add_to_cart"] }, 1, 0] } },
          },
        },
        { $sort: { views: -1 } },
        { $limit: 10 },
        // Join the product name. Events reference products by id (as a string), so convert it.
        { $lookup: { from: "products", let: { id: { $toObjectId: "$_id" } }, pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$id"] } } }, { $project: { name: 1, kind: 1 } }], as: "p" } },
      ])
      .toArray();

    // Index {type: 1, ts: 1} again: search events only. Queries normalised to lower case.
    const searches = await events
      .aggregate([
        { $match: { type: "search", ts } },
        {
          $group: {
            _id: { $toLower: { $trim: { input: "$props.query" } } },
            count: { $sum: 1 },
            avgResults: { $avg: "$props.resultCount" },
            zero: { $sum: { $cond: [{ $eq: ["$props.resultCount", 0] }, 1, 0] } },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();

    return {
      ...q,
      products: products.map((p) => ({
        productId: p._id,
        name: p.p[0]?.name ?? "(deleted product)",
        kind: p.p[0]?.kind ?? "",
        views: p.views,
        addToCart: p.addToCart,
        cartRate: p.views ? p.addToCart / p.views : 0,
      })),
      searches: searches.slice(0, 10).map((s) => ({ query: s._id, count: s.count, avgResults: Math.round(s.avgResults * 10) / 10 })),
      zeroResultSearches: searches
        .filter((s) => s.zero > 0)
        .sort((a, b) => b.zero - a.zero)
        .slice(0, 10)
        .map((s) => ({ query: s._id, count: s.zero })),
    };
  }

  router.get("/analytics/top", async (req, res) => {
    const q = parse(range, req.query);
    const { value, hit } = await cached(redis, "top", q, CACHE_TTL, () => top(q));
    res.json({ ...value, cached: hit } satisfies TopResponse);
  });

  // ---- UC1: live activity (Redis counters, written by the ingest worker) -----------------------
  async function live(): Promise<Omit<LiveActivity, "cached">> {
    const now = Date.now();
    const minutes = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 60_000));
    const keys = minutes.map(minuteKey);
    const windowKeys = keys.slice(-ACTIVE_WINDOW_MIN);

    // One round trip for ~100 commands
    const p = redis.pipeline();
    for (const k of keys) p.get(`evt:all:${k}`).pfcount(`active:${k}`);
    // PFCOUNT over several HyperLogLogs = size of their UNION: a session active in 3 of the last
    // 5 minutes counts once. Summing per-minute counts would count it 3 times.
    p.pfcount(...windowKeys.map((k) => `active:${k}`));
    for (const type of EVENT_TYPES) for (const k of windowKeys) p.get(`evt:${type}:${k}`);
    const out = ((await p.exec()) ?? []).map(([, v]) => Number(v ?? 0));

    const perMinute = minutes.map((m, i) => ({ minute: m.toISOString().slice(0, 16), events: out[i * 2], active: out[i * 2 + 1] }));
    const activeSessions = out[keys.length * 2];
    const byType: Record<string, number> = {};
    EVENT_TYPES.forEach((type, t) => {
      const n = windowKeys.reduce((sum, _, j) => sum + out[keys.length * 2 + 1 + t * windowKeys.length + j], 0);
      if (n) byType[type] = n;
    });

    const events = db().collection("events");
    const hourAgo = new Date(now - 3_600_000);
    const [recent, topPages, topProducts] = await Promise.all([
      // Time-series collections are clustered by time: "latest N" is a cheap bounded scan
      events
        .find({ ts: { $gte: hourAgo } }, { projection: { ts: 1, type: 1, page: 1, device: 1, meta: 1, props: 1 } })
        .sort({ ts: -1 })
        .limit(25)
        .toArray(),
      events
        .aggregate([{ $match: { type: "page_view", ts: { $gte: hourAgo } } }, { $group: { _id: "$page.path", views: { $sum: 1 } } }, { $sort: { views: -1 } }, { $limit: 5 }])
        .toArray(),
      events
        .aggregate([
          { $match: { type: "product_view", ts: { $gte: hourAgo } } },
          { $group: { _id: "$props.productId", views: { $sum: 1 } } },
          { $sort: { views: -1 } },
          { $limit: 5 },
          { $lookup: { from: "products", let: { id: { $toObjectId: "$_id" } }, pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$id"] } } }, { $project: { name: 1 } }], as: "p" } },
        ])
        .toArray(),
    ]);

    return {
      activeSessions,
      activeWindowMin: ACTIVE_WINDOW_MIN,
      perMinute,
      byType,
      recent: recent.map(toRecent),
      topPages: topPages.map((p) => ({ path: p._id ?? "(none)", views: p.views })),
      topProducts: topProducts.map((p) => ({ productId: p._id, name: p.p[0]?.name ?? "(unknown)", views: p.views })),
      generatedAt: new Date(now).toISOString(),
    };
  }

  router.get("/analytics/live", async (_req, res) => {
    const { value, hit } = await cached(redis, "live", {}, LIVE_CACHE_TTL, live);
    res.json({ ...value, cached: hit } satisfies LiveActivity);
  });

  // ---- UC3: export -----------------------------------------------------------------------------
  router.get("/analytics/export", async (req, res) => {
    const q = parse(range.extend({ report: z.enum(EXPORT_REPORTS), format: z.enum(["csv", "json"]).default("csv") }), req.query);
    const params = { from: q.from, to: q.to };
    let rows: Record<string, unknown>[];
    let json: unknown;
    if (q.report === "funnel") {
      const f = (await cached(redis, "funnel", params, CACHE_TTL, () => funnel(params))).value;
      json = f;
      rows = f.byDay.map((d) => ({ day: d.day, ...Object.fromEntries(FUNNEL_STEPS.map((s, i) => [s, d.steps[i]])) }));
    } else if (q.report === "trends") {
      const t = (await cached(redis, "trends", params, CACHE_TTL, () => trends(params))).value;
      json = t;
      rows = t.hours.map((h) => ({ hour: h.hour, sessions: h.sessions, ...Object.fromEntries(EVENT_TYPES.map((type) => [type, h.counts[type] ?? 0])) }));
    } else {
      const t = (await cached(redis, "top", params, CACHE_TTL, () => top(params))).value;
      json = t;
      rows = [
        ...t.products.map((p) => ({ section: "product", name: p.name, kind: p.kind, views: p.views, add_to_cart: p.addToCart, cart_rate: p.cartRate.toFixed(3) })),
        ...t.searches.map((s) => ({ section: "search", name: s.query, count: s.count, avg_results: s.avgResults })),
        ...t.zeroResultSearches.map((s) => ({ section: "zero_result_search", name: s.query, count: s.count })),
      ];
    }

    const filename = `cellora-${q.report}-${q.from}-to-${q.to}.${q.format}`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    if (q.format === "json") return res.json(json);
    res.type("text/csv").send(toCsv(rows));
  });

  return router;
}

function toRecent(e: any): RecentEvent {
  const p = e.props ?? {};
  const detail =
    e.type === "search" ? `"${p.query}" → ${p.resultCount} results`
    : e.type === "order_placed" ? p.orderNumber
    : e.type === "checkout_failed" ? p.reason
    : e.type === "add_to_cart" ? `${p.sku} × ${p.qty}`
    : e.type === "category_view" ? p.kind
    : undefined;
  return {
    ts: e.ts.toISOString(),
    type: e.type,
    path: e.page?.path,
    device: e.device?.type,
    sessionId: e.meta.sessionId,
    loggedIn: !!e.meta.customerId,
    detail,
  };
}

/** RFC 4180 CSV: header from the union of keys, values quoted when they need it. */
function toCsv(rows: Record<string, unknown>[]) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

// Rollups: pre-aggregated "materialised views" of the raw events (data-model §4.5–4.7, UC6).
//
//   session_summaries  one document per session         (Support: session lists, UC12)
//   metrics_hourly     event counts per hour and type   (Analyst: activity trends, UC1/UC3)
//   funnel_daily       ordered purchase funnel per day  (Analyst: funnels, UC2)
//
// Each is an aggregation over `events` ending in $merge, which upserts the results into the
// target collection. Runs are INCREMENTAL: only the recent window is recomputed, so the cost
// doesn't grow with total history. Dashboards read these small collections instead of scanning
// raw events; the price is that they are up to one interval stale (eventual consistency).
import type { Collection, Db, Document } from "mongodb";
import { FUNNEL_STEPS } from "@da2/shared";

export const TZ = "Asia/Colombo";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Sessions can straddle the window start; look this far back so they're summarised whole. */
const SESSION_LOOKBACK = 6 * HOUR;

const is = (type: string) => ({ $eq: ["$type", type] });
const firstTsOf = (type: string) => ({ $min: { $cond: [is(type), "$ts", null] } }); // $min ignores nulls

/** session_summaries for every session with activity since `since`. */
export async function rollupSessions(events: Collection, since: Date) {
  await events
    .aggregate(
      [
        { $match: { ts: { $gte: new Date(since.getTime() - SESSION_LOOKBACK) } } },
        {
          $group: {
            _id: "$meta.sessionId",
            anonymousId: { $first: "$meta.anonymousId" },
            customerId: { $max: "$meta.customerId" }, // null sorts before any ObjectId
            startedAt: { $min: "$ts" },
            endedAt: { $max: "$ts" },
            eventCount: { $sum: 1 },
            // $min over {ts, path} documents compares ts first: the earliest page view wins
            landing: { $min: { $cond: [is("page_view"), { ts: "$ts", path: "$page.path" }, null] } },
            device: { $max: "$device" },
            productView: { $max: is("product_view") },
            addToCart: { $max: is("add_to_cart") },
            checkoutStarted: { $max: is("checkout_started") },
            orderPlaced: { $max: is("order_placed") },
            hadCheckoutFailure: { $max: is("checkout_failed") },
            orderIds: { $push: { $cond: [is("order_placed"), "$props.orderId", null] } },
            simulated: { $max: "$sim" },
          },
        },
        { $match: { endedAt: { $gte: since } } }, // only sessions touched in this window
        {
          $project: {
            anonymousId: 1,
            customerId: 1,
            startedAt: 1,
            endedAt: 1,
            durationSec: { $round: [{ $divide: [{ $subtract: ["$endedAt", "$startedAt"] }, 1000] }, 0] },
            eventCount: 1,
            landingPath: "$landing.path",
            device: 1,
            reached: { productView: "$productView", addToCart: "$addToCart", checkoutStarted: "$checkoutStarted", orderPlaced: "$orderPlaced" },
            hadCheckoutFailure: 1,
            orderIds: { $filter: { input: "$orderIds", cond: { $ne: ["$$this", null] } } },
            simulated: { $ifNull: ["$simulated", false] },
          },
        },
        { $merge: { into: "session_summaries", on: "_id", whenMatched: "replace", whenNotMatched: "insert" } },
      ],
      { allowDiskUse: true },
    )
    .toArray();
}

/** metrics_hourly: events and distinct sessions per LOCAL hour and event type. */
export async function rollupHourly(events: Collection, since: Date) {
  // Sri Lanka is UTC+5:30, so local hours start at :30 UTC. Recompute whole local hours only;
  // starting mid-bucket would replace a bucket with a partial count.
  const offset = 5.5 * HOUR;
  const from = new Date(Math.floor((since.getTime() + offset) / HOUR) * HOUR - offset);
  // $dateTrunc's timezone option ignores half-hour offsets for "hour", so shift into local
  // time, truncate, and shift back: buckets start at hh:30 UTC = hh:00 in Sri Lanka.
  const localHour = {
    $dateSubtract: {
      startDate: { $dateTrunc: { date: { $dateAdd: { startDate: "$ts", unit: "minute", amount: 330 } }, unit: "hour" } },
      unit: "minute",
      amount: 330,
    },
  };
  await events
    .aggregate(
      [
        { $match: { ts: { $gte: from } } },
        { $group: { _id: { hour: localHour, type: "$type" }, count: { $sum: 1 }, sessions: { $addToSet: "$meta.sessionId" } } },
        { $project: { count: 1, uniqueSessions: { $size: "$sessions" } } },
        { $merge: { into: "metrics_hourly", on: "_id", whenMatched: "replace", whenNotMatched: "insert" } },
      ],
      { allowDiskUse: true },
    )
    .toArray();
}

/**
 * funnel_daily: sessions reaching each step IN ORDER, per local day, overall and by device
 * (data-model §11). A session counts on the day of its first funnel event.
 */
export async function rollupFunnel(events: Collection, since: Date) {
  // Recompute whole local days from the day containing `since`
  const offset = 5.5 * HOUR;
  const from = new Date(Math.floor((since.getTime() + offset) / DAY) * DAY - offset);
  await events
    .aggregate([...funnelPipeline(from), { $merge: { into: "funnel_daily", on: "_id", whenMatched: "replace", whenNotMatched: "insert" } }], { allowDiskUse: true })
    .toArray();
}

/** The ordered-funnel aggregation from `from` onwards (without the $merge), one result per day. */
export function funnelPipeline(from: Date, to?: Date): Document[] {
  const stepsFor = (prefix: string) => FUNNEL_STEPS.map((step, i) => ({ step, sessions: `$${prefix}s${i + 1}` }));
  return [
    { $match: { ts: { $gte: from, ...(to && { $lt: to }) }, type: { $in: [...FUNNEL_STEPS] } } },
    // First time each session hit each step
    {
      $group: {
        _id: "$meta.sessionId",
        first: { $min: "$ts" },
        device: { $max: "$device.type" },
        view: firstTsOf("product_view"),
        cart: firstTsOf("add_to_cart"),
        checkout: firstTsOf("checkout_started"),
        order: firstTsOf("order_placed"),
      },
    },
    // A step counts only if the previous step happened first
    { $set: { s1: { $ne: ["$view", null] } } },
    { $set: { s2: { $and: ["$s1", { $ne: ["$cart", null] }, { $gte: ["$cart", "$view"] }] } } },
    { $set: { s3: { $and: ["$s2", { $ne: ["$checkout", null] }, { $gte: ["$checkout", "$cart"] }] } } },
    { $set: { s4: { $and: ["$s3", { $ne: ["$order", null] }, { $gte: ["$order", "$checkout"] }] } } },
    {
      $group: {
        _id: { day: { $dateToString: { date: "$first", format: "%Y-%m-%d", timezone: TZ } }, device: { $ifNull: ["$device", "unknown"] } },
        s1: { $sum: { $cond: ["$s1", 1, 0] } },
        s2: { $sum: { $cond: ["$s2", 1, 0] } },
        s3: { $sum: { $cond: ["$s3", 1, 0] } },
        s4: { $sum: { $cond: ["$s4", 1, 0] } },
      },
    },
    { $match: { s1: { $gt: 0 } } }, // drop sessions that never viewed a product (e.g. server-only test traffic)
    {
      $group: {
        _id: "$_id.day",
        s1: { $sum: "$s1" },
        s2: { $sum: "$s2" },
        s3: { $sum: "$s3" },
        s4: { $sum: "$s4" },
        byDevice: { $push: { k: "$_id.device", v: stepsFor("") } },
      },
    },
    {
      $project: {
        _id: { day: "$_id", funnel: "purchase" },
        steps: stepsFor(""),
        byDevice: { $arrayToObject: "$byDevice" },
        computedAt: "$$NOW",
      },
    },
  ];
}

export interface RollupRun {
  mode: "full" | "incremental";
  since: Date;
  durationMs: Record<string, number>;
}

export async function runRollups(db: Db, mode: "full" | "incremental", since: Date): Promise<RollupRun> {
  const events = db.collection("events");
  const durationMs: Record<string, number> = {};
  for (const [name, fn] of [["session_summaries", rollupSessions], ["metrics_hourly", rollupHourly], ["funnel_daily", rollupFunnel]] as const) {
    const t = performance.now();
    await fn(events, since);
    durationMs[name] = Math.round(performance.now() - t);
  }
  const run: RollupRun = { mode, since, durationMs };
  // Recorded for the Admin health page (UC6/UC7)
  await db.collection<Document>("settings").updateOne({ _id: "rollups" as any }, { $set: { lastRunAt: new Date(), ...run } }, { upsert: true });
  return run;
}

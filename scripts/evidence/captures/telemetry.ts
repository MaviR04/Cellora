import { randomUUID } from "node:crypto";
import { connectMongo, connectRedis } from "@da2/shared/server";
import type { Db } from "mongodb";
import { recordText, imagePath, recordImage } from "../lib";
import { getBrowser } from "../screenshot";
import { API, reachable } from "../http";
import type { EvidenceSet } from "./index";

const phase = "05-telemetry";
const WEB = "http://localhost:5173";
const STREAM = "events:ingest";
const GROUP = "ingest-workers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await sleep(300);
  }
  throw new Error("timed out waiting (is the worker running? npm run dev:worker)");
}

export const telemetry: EvidenceSet = {
  description: "Real browser journey -> session timeline, identity stitching, stream/consumer state, live counters, ingest throughput",
  async run() {
    if (!(await reachable(`${API}/health`)) || !(await reachable(WEB))) throw new Error("API and web app must be running");
    const db = (await connectMongo()).db as unknown as Db;
    const redis = connectRedis();
    const events = db.collection("events");

    // 1. A real shopper journey in the browser (guest -> login -> checkout)
    const context = await (await getBrowser()).newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(WEB, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Phones", exact: true }).first().click();
    await page.waitForURL("**/c/phone");
    await page.getByRole("link", { name: /Galaxy S25 Ultra/ }).first().click();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.getByText("Added").waitFor();
    await page.getByPlaceholder(/Search phones/).fill("s25 ultra case");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/search?q=*");
    await page.getByRole("link", { name: /Ultra Hybrid MagFit for Galaxy S25 Ultra/ }).first().click();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.getByText("Added").waitFor();
    const { anonymousId, sessionId } = await page.evaluate(() => ({
      anonymousId: localStorage.getItem("cellora.anonymousId")!,
      sessionId: JSON.parse(sessionStorage.getItem("cellora.session")!).id as string,
    }));
    // Log in part-way through: everything before this point was anonymous
    await page.goto(`${WEB}/login?next=/checkout`, { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill("customer@cellora.test");
    await page.getByLabel("Password").fill(process.env.SEED_USER_PASSWORD!);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/checkout");
    await page.getByLabel("Address line 1").fill("42 Galle Road");
    await page.getByLabel("City").fill("Colombo 03");
    await page.getByRole("button", { name: "Place order" }).click();
    await page.waitForURL("**/orders/*");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: imagePath({ phase, name: "journey-end" }) });
    recordImage({ phase, name: "journey-end", title: "End of the recorded shopper journey", shows: "The order confirmation reached by the automated browser journey whose telemetry is shown in session-timeline.", reportSection: "6. Implementation: telemetry" });
    await context.close(); // pagehide -> tracker flushes the rest with sendBeacon

    // 2. The session as the analyst/support will see it: the timeline from the time-series collection
    const orderPlaced = await waitFor(() => events.findOne({ "meta.sessionId": sessionId, type: "order_placed" }));
    await sleep(1500);
    const timeline = await events.find({ "meta.sessionId": sessionId }, { projection: { _id: 0 } }).sort({ ts: 1 }).toArray();
    const t0 = timeline[0].ts.getTime();
    const describe = (e: any) => {
      const p = e.props ?? {};
      switch (e.type) {
        case "page_view": return e.page?.path;
        case "category_view": return `kind=${p.kind}`;
        case "product_view": return `${e.page?.path}  (${p.kind}, from ${p.basePrice / 100} LKR)`;
        case "search": return `"${p.query}" -> ${p.resultCount} results`;
        case "add_to_cart": return `${p.sku} x${p.qty} @ ${p.unitPrice / 100} LKR`;
        case "identify": return `customerId=${p.customerId} via ${p.via}`;
        case "checkout_started": return `${p.itemCount} items, ${p.cartValue / 100} LKR`;
        case "payment_submitted": return `method=${p.method}`;
        case "order_placed": return `${p.orderNumber}, total ${p.total / 100} LKR`;
        default: return JSON.stringify(p);
      }
    };
    recordText(
      {
        phase,
        name: "session-timeline",
        title: "One shopper session, reconstructed from the events collection",
        shows: "Every step of a real browser session (page views, product views, search, add to cart, login, checkout, order) captured by the tracker, sent through the Redis Stream and stored in the time-series collection, queried by meta.sessionId.",
        reportSection: "6. Implementation: telemetry pipeline / UC12 session timeline",
      },
      {
        command: `db.events.find({ "meta.sessionId": "${sessionId}" }).sort({ ts: 1 })`,
        body: [
          `session ${sessionId}   anonymousId ${anonymousId}`,
          "",
          "   +time  source  customer  type                event",
          ...timeline.map((e: any) =>
            `${`+${((e.ts.getTime() - t0) / 1000).toFixed(1)}s`.padStart(8)}  ${e.source.padEnd(6)}  ${(e.meta.customerId ? "yes" : "-").padEnd(8)}  ${e.type.padEnd(18)}  ${describe(e)}`,
          ),
          "",
          `${timeline.length} events; device: ${JSON.stringify(timeline[0].device)}`,
        ].join("\n"),
      },
    );

    // 3. Identity stitching: the anonymous events before login now carry the customerId
    const beforeLogin = timeline.filter((e: any) => e.ts < timeline.find((x: any) => x.type === "identify")!.ts);
    recordText(
      {
        phase,
        name: "identity-stitching",
        title: "Identity stitching after login",
        shows: "Events recorded while the shopper was anonymous were updated with their customerId when the identify event was ingested (updateMany on the time-series metaField), so the customer's full history includes pre-login browsing.",
        reportSection: "5. Data model: identity stitching",
      },
      {
        command: `db.events.countDocuments({ "meta.anonymousId": "${anonymousId}", "meta.customerId": null })`,
        body: [
          `events before login in this session:                 ${beforeLogin.length}`,
          `  of which now linked to the customer (customerId):  ${beforeLogin.filter((e: any) => e.meta.customerId).length}`,
          `events for this browser still anonymous:             ${await events.countDocuments({ "meta.anonymousId": anonymousId, "meta.customerId": null })}`,
          `customerId on order_placed:                          ${orderPlaced.meta.customerId}`,
        ].join("\n"),
      },
    );

    // 4. A raw stored event document
    const sample = timeline.find((e: any) => e.type === "add_to_cart");
    recordText(
      { phase, name: "event-document", title: "A stored telemetry event", shows: "Envelope (eventId, ts, type, source, page, device, receivedAt), identity in the metaField, and type-specific props with denormalised kind and price.", reportSection: "5. Data model: events" },
      { lang: "json", command: `db.events.findOne({ "meta.sessionId": "${sessionId}", type: "add_to_cart" })`, body: JSON.stringify(sample, null, 2) },
    );

    // 5. Throughput: API ingestion and worker drain
    const benchAnon = randomUUID();
    // Timestamped 3 hours ago so the worker keeps them out of the live "active now" counters.
    const benchTs = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const makeBatch = (n: number) =>
      Array.from({ length: n }, () => ({ eventId: randomUUID(), type: "page_view", ts: benchTs, page: { path: "/bench" }, props: { title: "bench" } }));
    const BATCHES = 400, PER_BATCH = 50, CONCURRENCY = 16;
    const total = BATCHES * PER_BATCH;
    const [{ n: beforeCount }] = [{ n: await events.countDocuments({ "meta.anonymousId": benchAnon }) }];
    const apiStart = Date.now();
    let next = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < BATCHES) {
          next++;
          const r = await fetch(`${API}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anonymousId: benchAnon, sessionId: randomUUID(), events: makeBatch(PER_BATCH) }) });
          if (r.status !== 202) throw new Error(`ingest returned ${r.status}`);
        }
      }),
    );
    const apiMs = Date.now() - apiStart;
    await waitFor(async () => (await events.countDocuments({ "meta.anonymousId": benchAnon })) >= beforeCount + total, 120_000);
    const drainMs = Date.now() - apiStart;
    const group = await redis.xinfo("GROUPS", STREAM);
    const flat = Object.fromEntries((group as any[])[0].reduce((acc: any[], v: any, i: number, arr: any[]) => (i % 2 ? acc : [...acc, [v, arr[i + 1]]]), []));
    recordText(
      {
        phase,
        name: "ingest-throughput",
        title: "Ingestion throughput",
        shows: `${total.toLocaleString()} events sent as ${BATCHES} HTTP batches of ${PER_BATCH} (${CONCURRENCY} concurrent clients). The API only validates and appends to the Redis Stream, so it accepts events faster than they are written to MongoDB; the worker drains the backlog with batched insertMany.`,
        reportSection: "9. Strengths: write throughput / 11. Evaluation",
      },
      {
        command: `${BATCHES} x POST /api/events (${PER_BATCH} events each) -> wait until all ${total} are in db.events`,
        body: [
          `API accepted all ${total} events in      ${apiMs} ms   (${Math.round(total / (apiMs / 1000)).toLocaleString()} events/s)`,
          `all ${total} events stored in MongoDB after ${drainMs} ms   (${Math.round(total / (drainMs / 1000)).toLocaleString()} events/s end to end)`,
          "",
          `consumer group after drain: pending=${flat.pending}  lag=${flat.lag}  consumers=${flat.consumers}`,
          "",
          "Single laptop, Docker Desktop, 3-node replica set; numbers are indicative, not a benchmark.",
        ].join("\n"),
      },
    );
    await events.deleteMany({ "meta.anonymousId": benchAnon }); // delete by metaField (allowed on time-series)

    // 6. Stream + consumer group + live counters
    const now = new Date();
    const minutes = Array.from({ length: 5 }, (_, i) => new Date(now.getTime() - i * 60_000).toISOString().slice(0, 16).replace(/[-T:]/g, ""));
    const activeNow = await redis.pfcount(...minutes.map((m) => `active:${m}`));
    const perMinute = await Promise.all(minutes.map(async (m) => `${m}  events=${(await redis.get(`evt:all:${m}`)) ?? 0}  active sessions=${await redis.pfcount(`active:${m}`)}`));
    recordText(
      {
        phase,
        name: "stream-and-counters",
        title: "Redis Stream, consumer group and live counters",
        shows: "The events:ingest stream with its consumer group (nothing pending = everything acknowledged), and the per-minute counters the worker maintains: INCR counts and a HyperLogLog of distinct sessions, merged across 5 minutes with one PFCOUNT for 'active users now' (UC1).",
        reportSection: "7. Characteristics: Redis data structures / UC1",
      },
      {
        command: "XINFO STREAM / XINFO GROUPS events:ingest; GET evt:all:<minute>; PFCOUNT active:<m1> … active:<m5>",
        body: [
          `XLEN ${STREAM} = ${await redis.xlen(STREAM)}   (capped with MAXLEN ~ 100000)`,
          `group ${GROUP}: ${JSON.stringify(flat)}`,
          `dead-letter stream events:dead length = ${await redis.xlen("events:dead")}`,
          "",
          "last 5 minutes (UTC minute buckets):",
          ...perMinute.map((l) => "  " + l),
          "",
          `active sessions in the last 5 minutes (PFCOUNT over 5 HyperLogLogs, ~0.81% error): ${activeNow}`,
          `HyperLogLog memory per minute key: ${await redis.call("MEMORY", "USAGE", `active:${minutes[0]}`)} bytes`,
        ].join("\n"),
      },
    );
    redis.disconnect();
  },
};

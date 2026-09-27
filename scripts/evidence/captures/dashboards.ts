import { randomBytes, randomUUID } from "node:crypto";
import { connectAnalystMongo, connectMongo, connectRedis } from "@da2/shared/server";
import { minuteKey } from "@da2/shared";
import type { Db } from "mongodb";
import type { BrowserContext } from "playwright";
import { rollupSessions } from "../../../apps/worker/src/rollups";
import { recordText } from "../lib";
import { screenshot } from "../screenshot";
import { API, Client, reachable } from "../http";
import type { EvidenceSet } from "./index";

const phase = "08-dashboards";
const WEB = "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  throw new Error("timed out waiting");
}
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const loginAs = (email: string) => async (context: BrowserContext) => {
  const r = await context.request.post(`${WEB}/api/auth/login`, { data: { email, password: process.env.SEED_USER_PASSWORD } });
  if (!r.ok()) throw new Error(`login failed for ${email}`);
};
/** Charts and polled widgets need a moment after networkidle. */
const settle = async (page: import("playwright").Page) => void (await page.waitForTimeout(1200));

export const dashboards: EvidenceSet = {
  description: "Staff dashboards: RBAC, analyst on a secondary, HyperLogLog, exports, PII masking, escalations, role change, retention, rollup rebuild, right-to-erasure request, screenshots",
  async run() {
    if (!(await reachable(`${API}/health`)) || !(await reachable(WEB))) throw new Error("API and web app must be running (and the worker)");
    const db = (await connectMongo()).db as unknown as Db;
    const analystConn = await connectAnalystMongo();
    const redis = connectRedis();
    const events = db.collection("events");

    const clients: Record<string, Client> = {};
    for (const role of ["customer", "analyst", "support", "admin"]) {
      clients[role] = new Client();
      await clients[role].login(`${role}@cellora.test`);
    }
    const { analyst, support, admin } = clients;

    // 1. RBAC for the dashboard APIs ------------------------------------------------------------
    {
      const who = [["anonymous", new Client()], ...Object.entries(clients)] as [string, Client][];
      const endpoints = [
        "/analytics/live",
        "/analytics/funnel",
        "/analytics/export?report=top&format=json",
        "/support/search?q=customer",
        "/support/failed-checkouts",
        "/support/escalations",
        "/admin/users",
        "/admin/indexes",
        "/admin/health",
        "/admin/audit",
      ];
      const rows = [`${pad("GET endpoint", 42)}${who.map(([w]) => pad(w, 11)).join("")}`];
      for (const path of endpoints) {
        const codes = await Promise.all(who.map(([, c]) => c.get(path).then((r) => r.status)));
        rows.push(`${pad(path, 42)}${codes.map((c) => pad(c, 11)).join("")}`);
      }
      recordText(
        {
          phase,
          name: "rbac-dashboards",
          title: "Dashboard API access by role",
          shows: "Analyst endpoints admit analyst+admin, support endpoints support+admin, admin endpoints admin only. 401 = not logged in, 403 = wrong role. Enforced by requireRole() on the API, not just by hiding links.",
          reportSection: "6. Implementation: role-based access (UC4)",
        },
        { body: rows.join("\n"), command: "GET each endpoint as each demo account" },
      );
    }

    // 2. Analyst queries run on a SECONDARY with a read-only user ---------------------------------
    {
      const adb = analystConn.db!;
      const explain: any = await adb.collection("funnel_daily").find({ "_id.funnel": "purchase" }).explain("queryPlanner");
      const primary = (await db.admin().command({ hello: 1 })).primary;
      let writeError = "";
      try {
        await adb.collection("funnel_daily").insertOne({ _id: "should-fail" as any });
      } catch (e: any) {
        writeError = e.message.split(" on da2")[0];
      }
      recordText(
        {
          phase,
          name: "analyst-connection",
          title: "Analyst dashboards read from a secondary, as a read-only user",
          shows: "The analyst connection (da2_analyst, readPreference secondaryPreferred) is served by a secondary member, so dashboard load stays off the primary that handles checkouts. A write through it is rejected by MongoDB itself.",
          reportSection: "7. Characteristics: replication & read scaling; security",
        },
        {
          command: "analyst.funnel_daily.find(...).explain(); analyst.funnel_daily.insertOne(...)",
          body: [
            `replica set primary:               ${primary}`,
            `analyst query was served by:       ${explain.serverInfo.host}:${explain.serverInfo.port}`,
            `analyst connection readPreference: ${analystConn.getClient().readPreference.mode}`,
            "",
            `insert through the analyst connection -> ${writeError || "(no error?!)"}`,
          ].join("\n"),
        },
      );
    }

    // 3. Live activity: HyperLogLog union vs sum vs exact ------------------------------------------
    {
      const now = Date.now();
      const minutes = Array.from({ length: 5 }, (_, i) => new Date(now - (4 - i) * 60_000));
      const keys = minutes.map((m) => `active:${minuteKey(m)}`);
      const perMinute = await Promise.all(keys.map((k) => redis.pfcount(k)));
      const union = await redis.pfcount(...keys);
      const start = new Date(Math.floor(minutes[0].getTime() / 60_000) * 60_000);
      const exact = (await events.distinct("meta.sessionId", { ts: { $gte: start } })).length;
      const mem = await Promise.all(keys.map((k) => redis.memory("USAGE", k).catch(() => null)));
      recordText(
        {
          phase,
          name: "live-hyperloglog",
          title: "Live 'active sessions': HyperLogLog union vs summing minutes vs exact",
          shows: "PFCOUNT over several per-minute HyperLogLogs returns the size of their UNION, so a session active in several minutes counts once. Summing per-minute counts over-counts. Each HLL is at most ~12 KB however many sessions it holds; the estimate matches the exact distinct count from MongoDB. (Members can't be removed from an HLL: sessions erased in the window, e.g. by the erasure test of a run less than 5 minutes earlier, stay counted until the key expires.)",
          reportSection: "7. Characteristics: Redis data structures (UC1)",
        },
        {
          command: "PFCOUNT active:{m} (each) · PFCOUNT active:{m-4} … active:{m} · db.events.distinct('meta.sessionId', {ts ≥ window start})",
          body: [
            ...keys.map((k, i) => `${pad(k, 22)} PFCOUNT ${pad(perMinute[i], 5)} MEMORY USAGE ${mem[i] ?? "-"} bytes`),
            "",
            `sum of per-minute counts (wrong):    ${perMinute.reduce((a, b) => a + b, 0)}`,
            `PFCOUNT of all 5 keys (union):       ${union}`,
            `exact distinct sessions (MongoDB):   ${exact}`,
            ...(union === 0 ? ["", "(no live traffic in the window: run `npm run sim:live` and capture again)"] : []),
          ].join("\n"),
        },
      );
    }

    // 4. Dashboard endpoint timings: cache miss vs hit ---------------------------------------------
    {
      const rows = [`${pad("endpoint", 34)}${pad("source", 34)}${pad("miss", 10)}hit`];
      const sources: Record<string, string> = {
        "/analytics/live": "Redis counters + latest events",
        "/analytics/funnel": "funnel_daily rollup",
        "/analytics/trends": "metrics_hourly rollup",
        "/analytics/top": "raw events aggregation",
      };
      for (const path of Object.keys(sources)) {
        const name = path.split("/").pop();
        const stale = await redis.keys(`cache:${name}:*`);
        if (stale.length) await redis.del(...stale);
        let t = performance.now();
        const miss = await analyst.get(path);
        const missMs = performance.now() - t;
        t = performance.now();
        const hit = await analyst.get(path);
        const hitMs = performance.now() - t;
        rows.push(`${pad(path, 34)}${pad(sources[path], 34)}${pad(`${missMs.toFixed(0)} ms${miss.body.cached ? "*" : ""}`, 10)}${hitMs.toFixed(1)} ms ${hit.body.cached ? "(cached)" : ""}`);
      }
      recordText(
        {
          phase,
          name: "dashboard-timings",
          title: "Dashboard API response times: Redis cache miss vs hit",
          shows: "Every analyst endpoint sits behind the Redis read-through cache (5 s TTL for live, 60 s for the rest). The raw-events aggregation is the slowest on a miss, which is why the pre-aggregated rollups exist; a cache hit costs a few milliseconds whatever the source.",
          reportSection: "8. Strengths: performance; caching",
        },
        { body: rows.join("\n"), command: "HTTP GET as the analyst, after deleting cache:{name}:* (miss), then again (hit)" },
      );
    }

    // 5. Export (UC3) ------------------------------------------------------------------------------
    {
      const get = (q: string) => fetch(`${API}/analytics/export?${q}`, { headers: { Cookie: `sid=${analyst.cookie("sid")}` } });
      const csv = await get("report=funnel&format=csv");
      const top = await get("report=top&format=csv");
      const json = await get("report=trends&format=json");
      const jsonBody = (await json.json()) as any;
      recordText(
        {
          phase,
          name: "export",
          title: "Report export as CSV and JSON (UC3)",
          shows: "GET /api/analytics/export returns any report as a downloadable file (Content-Disposition: attachment). It uses the same cached computations as the dashboards.",
          reportSection: "6. Implementation: export (UC3)",
        },
        {
          command: "GET /api/analytics/export?report=funnel|top&format=csv · report=trends&format=json",
          body: [
            `# funnel CSV   ${csv.headers.get("content-type")}   ${csv.headers.get("content-disposition")}`,
            ...(await csv.text()).trim().split("\n").slice(0, 6),
            "…",
            "",
            `# top CSV   ${top.headers.get("content-disposition")}`,
            ...(await top.text()).trim().split("\n").slice(0, 5),
            "…",
            "",
            `# trends JSON   ${json.headers.get("content-disposition")}`,
            `keys: ${Object.keys(jsonBody).join(", ")}; ${jsonBody.hours.length} hourly rows; first: ${JSON.stringify(jsonBody.hours[0])}`,
          ].join("\n"),
        },
      );
    }

    // 6. PII masking: the same order as Support and as Admin ---------------------------------------
    {
      const order = await db.collection("orders").findOne({ "contact.phone": { $exists: true, $ne: null }, "shippingAddress.line1": { $ne: "[erased]" } }, { sort: { createdAt: -1 } });
      const pick = (o: any) => JSON.stringify({ contact: o.contact, shippingAddress: o.shippingAddress }, null, 2);
      const asSupport = (await support.get(`/support/orders/${order!.orderNumber}`)).body;
      const asAdmin = (await admin.get(`/support/orders/${order!.orderNumber}`)).body;
      const search = (await support.get("/support/search?q=customer@")).body.hits[0];
      recordText(
        {
          phase,
          name: "pii-masking",
          title: "PII masking for the Support role",
          shows: "Support agents get masked email, phone and street address (city kept for delivery questions); Admin sees the full record. Masking is applied in the API response, so unmasked data never reaches a support agent's browser.",
          reportSection: "9. Limitations & ethics: privacy / data minimisation",
        },
        {
          command: `GET /api/support/orders/${order!.orderNumber} as support, then as admin; GET /api/support/search?q=customer@ as support`,
          body: [`# as support`, pick(asSupport), "", `# as admin`, pick(asAdmin), "", `# customer search as support`, JSON.stringify(search)].join("\n"),
        },
      );
    }

    // 7. Notes & escalations (UC14) -----------------------------------------------------------------
    {
      const failure = (await support.get("/support/failed-checkouts?days=14")).body.failures.find((f: any) => f.customer);
      const note = (await support.post(`/support/sessions/${failure.sessionId}/notes`, { body: "Evidence run: out-of-stock complaint, promised restock email.", flagged: true })).body;
      const queue = (await support.get("/support/escalations")).body.notes;
      const plan: any = await db.collection("session_notes").find({ flagged: true, status: "open" }).sort({ createdAt: -1 }).explain("executionStats");
      const ixscan = JSON.stringify(plan.queryPlanner.winningPlan).match(/"indexName":"([^"]+)"/)?.[1];
      const resolved = (await support.patch(`/support/notes/${note._id}`, { status: "resolved" })).body;
      const after = (await support.get("/support/escalations")).body.notes;
      recordText(
        {
          phase,
          name: "escalations",
          title: "Flag a session, see it in the escalation queue, resolve it (UC14)",
          shows: "Notes live in their own session_notes collection (not in events or the rollups, which are append-only / overwritten). The escalation queue query is an equality-equality-sort that the compound index {flagged, status, createdAt} answers without an in-memory sort.",
          reportSection: "6. Implementation: support notes (UC14); indexing (ESR)",
        },
        {
          command: "POST /support/sessions/:id/notes {flagged:true} → GET /support/escalations → PATCH /support/notes/:id {status:'resolved'}",
          body: [
            `note created:        ${JSON.stringify({ _id: note._id, sessionId: note.sessionId, customerId: note.customerId, flagged: note.flagged, status: note.status })}`,
            `open queue:          ${queue.length} note(s); newest: "${queue[0]?.body}"`,
            `query plan:          IXSCAN ${ixscan}; docsExamined ${plan.executionStats.totalDocsExamined}, nReturned ${plan.executionStats.nReturned}`,
            `after resolving:     status=${resolved.status}, resolvedByName=${resolved.resolvedByName}; open queue now ${after.length}`,
          ].join("\n"),
        },
      );
    }

    // 8. Role change revokes the user's sessions (UC4) ----------------------------------------------
    {
      const email = "sim-002@cellora.test";
      const victim = new Client();
      const u = await victim.login(email);
      const before = (await victim.get("/auth/me")).body.user;
      const change = await admin.patch(`/admin/users/${u.id}`, { role: "support" });
      const oldSession = await victim.get("/auth/me");
      const again = new Client();
      await again.login(email);
      const staffNow = await again.get("/staff/me");
      await admin.patch(`/admin/users/${u.id}`, { role: "customer" }); // put it back
      const audit = await db.collection("audit_log").find({ "target.id": u.id, action: "role_changed" }).sort({ at: -1 }).limit(2).toArray();
      recordText(
        {
          phase,
          name: "role-change-revokes",
          title: "Changing a role revokes the user's sessions immediately (UC4)",
          shows: "The role is copied into the Redis session hash at login, so an admin role change deletes the user's sessions: the old cookie stops working on the very next request, and the new login carries the new role. Both changes are in audit_log.",
          reportSection: "6. Implementation: user management (UC4); Redis sessions",
        },
        {
          command: `PATCH /api/admin/users/${u.id} {role} as admin`,
          body: [
            `before:                         /auth/me role = ${before.role}`,
            `admin PATCH role -> support:    ${change.status} ${JSON.stringify(change.body)}`,
            `old cookie, GET /auth/me:       ${JSON.stringify(oldSession.body)}   (logged out)`,
            `new login, GET /staff/me:       ${staffNow.status} role = ${staffNow.body.user?.role}`,
            `admin PATCH role -> customer:   restored`,
            "",
            "audit_log:",
            ...audit.map((a) => `  ${a.at.toISOString()} ${a.actorName} ${a.action} ${JSON.stringify(a.details)}`),
          ].join("\n"),
        },
      );
    }

    // 9. Retention via collMod (UC5) ----------------------------------------------------------------
    {
      const ttl = async () => ((await db.listCollections({ name: "events" }).toArray())[0] as any).options.expireAfterSeconds;
      const before = await ttl();
      const set60 = await admin.patch("/admin/settings", { eventRetentionDays: 60 });
      const during = await ttl();
      await admin.patch("/admin/settings", { eventRetentionDays: 90 });
      const after = await ttl();
      recordText(
        {
          phase,
          name: "retention-collmod",
          title: "Data retention setting changes the time-series TTL (UC5)",
          shows: "Saving the retention setting runs collMod on the events time-series collection. MongoDB then drops whole buckets once all their events are older than the limit: no cron job, no batch deletes in application code.",
          reportSection: "6. Implementation: retention (UC5); 7. time-series collections",
        },
        {
          command: "PATCH /api/admin/settings {eventRetentionDays} → db.runCommand({collMod:'events', expireAfterSeconds}) · db.getCollectionInfos({name:'events'})",
          body: [
            `before:              expireAfterSeconds = ${before} (${before / 86_400} days)`,
            `PATCH 60 days:       ${set60.status}; settings.eventRetentionDays = ${set60.body.eventRetentionDays}`,
            `MongoDB now:         expireAfterSeconds = ${during} (${during / 86_400} days)`,
            `PATCH 90 days:       restored, expireAfterSeconds = ${after}`,
          ].join("\n"),
        },
      );
    }

    // 10. Rollup rebuild on demand (UC6) ------------------------------------------------------------
    {
      const before: any = await db.collection("settings").findOne({ _id: "rollups" as any });
      const requested = Date.now();
      const r = await admin.post("/admin/rollups/rebuild");
      const flag = await redis.get("rollups:rebuild");
      const run: any = await waitFor(async () => {
        const s: any = await db.collection("settings").findOne({ _id: "rollups" as any });
        return s?.mode === "full" && new Date(s.lastRunAt).getTime() > (before?.lastRunAt?.getTime() ?? 0) ? s : null;
      }, 60_000);
      recordText(
        {
          phase,
          name: "rollup-rebuild",
          title: "Admin-triggered full rollup rebuild (UC6)",
          shows: "The API only sets a flag in Redis (it returns 202 at once); the worker's scheduler picks it up with GETDEL within 15 s and recomputes every materialised view from all raw events.",
          reportSection: "6. Implementation: pre-aggregated views (UC6)",
        },
        {
          command: "POST /api/admin/rollups/rebuild · GET rollups:rebuild · db.settings.findOne({_id:'rollups'})",
          body: [
            `POST /admin/rollups/rebuild -> ${r.status} ${JSON.stringify(r.body)}`,
            `Redis rollups:rebuild       -> ${flag}`,
            `worker finished full rebuild ${((new Date(run.lastRunAt).getTime() - requested) / 1000).toFixed(1)} s after the request (run started then)`,
            `durations (ms):              ${JSON.stringify(run.durationMs)}`,
          ].join("\n"),
        },
      );
    }

    // 11. Right to erasure (UC15, Sri Lanka PDPA s.16), end to end on a throwaway customer ------------------------------------
    {
      const email = `erasure-test-${Date.now()}@example.com`;
      const anonymousId = randomUUID();
      const s1 = randomUUID();
      const s2 = randomUUID();
      const product: any = await db.collection("products").findOne({ slug: "pixel-9" });
      const variant = product.variants.find((v: any) => v.stock > 5) ?? product.variants[0];
      const ev = (type: string, props: object, path = "/") => ({ eventId: randomUUID(), ts: new Date().toISOString(), type, page: { path }, props });

      // Anonymous browsing first, then sign up in a second session, buy, and leave something in the cart
      const browser1 = new Client();
      await browser1.post("/events", { anonymousId, sessionId: s1, events: [ev("page_view", {}), ev("product_view", { productId: String(product._id), kind: "phone", basePrice: product.basePrice }, "/p/pixel-9")] });
      const shopper = new Client({ "X-Anonymous-Id": anonymousId, "X-Session-Id": s2 });
      const signup = await shopper.post("/auth/signup", { name: "Erasure Test Customer", email, password: randomBytes(12).toString("base64url") });
      const userId = signup.body.user.id;
      await shopper.post("/events", { anonymousId, sessionId: s2, events: [ev("identify", { customerId: userId, via: "signup" }), ev("page_view", {}, "/checkout")] });
      await shopper.post("/cart/items", { sku: variant.sku, qty: 1 });
      const order = await shopper.post("/checkout", { contact: { name: "Erasure Test Customer", email, phone: "+94 77 123 4567" }, address: { line1: "7 Temple Road", line2: "Apt 3", city: "Kandy", postcode: "20000" }, payment: "cod" });
      await shopper.post("/cart/items", { sku: variant.sku, qty: 1 }); // a live cart in Redis
      await support.post(`/support/sessions/${s2}/notes`, { body: "Customer asked about delivery times.", flagged: false });
      await waitFor(() => events.findOne({ "meta.sessionId": s2, type: "order_placed" }));
      await sleep(1500);
      await rollupSessions(events as any, new Date(Date.now() - 3_600_000)); // make sure the summaries exist too

      const oid = new (await import("mongodb")).ObjectId(userId);
      const snapshot = async () => ({
        eventsByAnonymousId: await events.countDocuments({ "meta.anonymousId": anonymousId }),
        eventsByCustomerId: await events.countDocuments({ "meta.customerId": oid }),
        sessionSummaries: await db.collection("session_summaries").countDocuments({ _id: { $in: [s1, s2] as any[] } }),
        sessionNotes: await db.collection("session_notes").countDocuments({ sessionId: s2 }),
        redisCart: await redis.exists(`cart:u:${userId}`),
        redisSessions: await redis.scard(`user_sessions:${userId}`),
      });
      const orderDoc = async () => {
        const o: any = await db.collection("orders").findOne({ orderNumber: order.body.orderNumber });
        return JSON.stringify({ orderNumber: o.orderNumber, contact: o.contact, shippingAddress: o.shippingAddress, sessionId: o.sessionId ?? null, items: o.items.map((i: any) => `${i.qty}× ${i.sku}`), total: o.totals.total });
      };
      const userDoc = async () => {
        const u: any = await db.collection("users").findOne({ _id: oid });
        return JSON.stringify({ name: u.name, email: u.email, status: u.status, anonymousIds: u.anonymousIds, addresses: u.addresses, passwordHash: u.passwordHash.startsWith("scrypt$") ? "scrypt$…" : u.passwordHash });
      };

      const before = await snapshot();
      const [orderBefore, userBefore] = [await orderDoc(), await userDoc()];
      const erase = await admin.post(`/admin/customers/${userId}/erase`, { confirmEmail: email });
      const after = await snapshot();
      const [orderAfter, userAfter] = [await orderDoc(), await userDoc()];
      const sessionAfter = await shopper.get("/auth/me");
      const again = await admin.post(`/admin/customers/${userId}/erase`, { confirmEmail: "" });
      const auditEntry: any = await db.collection("audit_log").findOne({ action: "customer_erased", "target.id": userId });

      const table = Object.keys(before).map((k) => `${pad(k, 22)}${pad((before as any)[k], 8)}→ ${(after as any)[k]}`);
      recordText(
        {
          phase,
          name: "right-to-erasure",
          title: "Right-to-erasure request, end to end (UC15, Sri Lanka PDPA s.16)",
          shows: "A throwaway customer browses anonymously, signs up, orders, and gets a support note. Erasure deletes their events (by the time-series metaField: customerId and linked anonymous ids, including the pre-signup session), session summaries and notes, revokes sessions and deletes the Redis cart, pseudonymises the order (kept for accounting) and the user record. It is idempotent: running it again changes nothing. The audit entry records the scope but no personal data.",
          reportSection: "9. Limitations & ethics: data protection (PDPA); 7. time-series deletes by metaField",
        },
        {
          command: `POST /api/admin/customers/${userId}/erase {confirmEmail} as admin`,
          body: [
            `${pad("what", 22)}${pad("before", 8)}  after`,
            ...table,
            "",
            `erase response:   ${erase.status} ${JSON.stringify(erase.body)}`,
            `run again:        ${again.status} ${JSON.stringify(again.body)}`,
            `customer's old session, GET /auth/me: ${JSON.stringify(sessionAfter.body)}`,
            "",
            "# order before",
            orderBefore,
            "# order after (kept, pseudonymised)",
            orderAfter,
            "",
            "# user before",
            userBefore,
            "# user after",
            userAfter,
            "",
            "# audit_log entry",
            JSON.stringify({ action: auditEntry.action, actor: auditEntry.actorName, target: auditEntry.target, details: auditEntry.details }),
            "",
            "Not covered (limitations): copies in the Redis stream until MAXLEN trims them, the replica set oplog,",
            "and backups. Aggregate rollups (metrics_hourly, funnel_daily) hold counts only, no personal data.",
          ].join("\n"),
        },
      );
      // The tombstone has served as evidence; remove the throwaway account so repeated runs don't
      // fill the admin users list (its pseudonymised order stays, like any erased customer's).
      await db.collection("users").deleteOne({ _id: oid, status: "erased" });
    }

    // 12. Screenshots ---------------------------------------------------------------------------
    const note: any = await db.collection("session_notes").findOne({ flagged: true, status: "open", customerId: { $ne: null } }, { sort: { createdAt: -1 } });
    const failure: any = note ?? (await events.findOne({ type: "checkout_failed", "meta.customerId": { $ne: null } }, { sort: { ts: -1 } }));
    const customerId = String(note?.customerId ?? failure.meta.customerId);
    const sessionId = note?.sessionId ?? failure.meta.sessionId;
    const order: any = await db.collection("orders").findOne({ customerId: { $ne: null }, "contact.phone": { $exists: true, $ne: null }, "shippingAddress.line1": { $ne: "[erased]" } }, { sort: { createdAt: -1 } });

    const A = loginAs("analyst@cellora.test");
    const S = loginAs("support@cellora.test");
    const AD = loginAs("admin@cellora.test");
    const shots: [name: string, title: string, shows: string, section: string, url: string, setup: typeof A, prepare?: (p: import("playwright").Page) => Promise<void>][] = [
      ["analyst-live", "Analyst: live activity (UC1)", "Active sessions (HyperLogLog), events per minute and by type from Redis counters, top pages/products and the latest events. Polls every 5 s.", "6. Implementation: live dashboard (UC1)", "/staff/live", A, settle],
      ["analyst-funnel", "Analyst: purchase funnel (UC2)", "Ordered funnel from the funnel_daily rollup with step conversion, device comparison, orders per day and a per-day table; CSV/JSON export.", "6. Implementation: funnel (UC2)", "/staff/funnel", A, settle],
      ["analyst-trends", "Analyst: trends and top lists (UC1, UC3)", "Hourly activity from metrics_hourly (local hours), the average-by-hour-of-day profile (evening peak), daily totals, top products, top and zero-result searches.", "6. Implementation: trends (UC1)", "/staff/trends", A, settle],
      ["support-search", "Support: find a customer (UC12)", "Search by email prefix (index range scan), order number or anonymous/session id; contact details masked for the support role.", "6. Implementation: support search (UC12)", "/staff/support?q=sim-01", S],
      ["support-customer", "Support: customer 360 (UC12, UC13)", "Profile, orders, the live Redis cart priced from MongoDB, all sessions (logged-in and anonymous on linked browsers) with funnel progress, and notes.", "6. Implementation: customer view (UC12/UC13)", `/staff/support/customers/${customerId}`, S],
      ["support-session", "Support: session timeline and notes (UC12, UC14)", "Every event of one session in order (raw events, index {meta.sessionId, ts}), ending in a server-side checkout_failed; the flagged note and the form to add one.", "6. Implementation: session timeline (UC12)", `/staff/support/sessions/${sessionId}`, S],
      ["support-failed-checkouts", "Support: failed-checkouts queue (UC12)", "Recent checkout_failed events with reason, customer, device and whether the session recovered.", "6. Implementation: support queues (UC12)", "/staff/support/failed-checkouts", S],
      ["support-escalations", "Support: escalation queue (UC14)", "Flagged notes still open (index {flagged, status, createdAt}).", "6. Implementation: escalations (UC14)", "/staff/support/escalations", S],
      ["support-order-masked", "Support: any order, PII masked (UC13)", "Staff order view: item snapshot, totals, payment and status history; email, phone and street masked for the support role.", "9. Ethics: data minimisation", `/staff/support/orders/${order.orderNumber}`, S],
      ["admin-users", "Admin: users & access (UC4, UC15)", "Roles, status and live Redis session counts; change role, disable, revoke sessions, erase customer data.", "6. Implementation: user management (UC4)", "/staff/admin/users", AD],
      [
        "admin-erase-dialog",
        "Admin: erasure confirmation (UC15)",
        "A right-to-erasure request under Sri Lanka's PDPA (s.16). The admin must type the customer's email to confirm; the dialog lists exactly what is deleted and what is kept.",
        "6. Implementation: right to erasure (UC15)",
        "/staff/admin/users",
        AD,
        async (p) => {
          await p.getByRole("button", { name: "Erase data" }).first().click();
          await p.waitForTimeout(300);
        },
      ],
      ["admin-data", "Admin: retention, rollups and indexes (UC5, UC6)", "Retention (collMod on the time-series TTL), rollup interval, last rollup run and rebuild button; every index with size and $indexStats usage.", "6. Implementation: data management (UC5/UC6)", "/staff/admin/data", AD],
      ["admin-health", "Admin: system health (UC7)", "Replica set members and lag, MongoDB server counters (incl. aborted transactions from the race test), storage vs data size (compression), Redis INFO and the stream backlog.", "6. Implementation: monitoring (UC7)", "/staff/admin/health", AD],
      ["admin-audit", "Admin: audit log", "Privileged actions from this evidence run: role changes, retention changes, rebuild requests, erasure.", "6. Implementation: audit trail", "/staff/admin/audit", AD],
    ];
    for (const [name, title, shows, reportSection, path, setup, prepare] of shots) {
      await screenshot({ phase, name, title, shows, reportSection }, { url: `${WEB}${path}`, setup, prepare });
    }

    redis.disconnect();
    await analystConn.close();
  },
};

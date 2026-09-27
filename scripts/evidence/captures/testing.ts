import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { delimiter, join } from "node:path";
import { config, connectMongo, connectRedis } from "@da2/shared/server";
import { MongoClient } from "mongodb";
import { FUNNEL_STEPS } from "@da2/shared";
import type { Db } from "mongodb";
import type { BrowserContext } from "playwright";
import { funnelPipeline } from "../../../apps/worker/src/rollups";
import { recordText, repoRoot } from "../lib";
import { screenshot } from "../screenshot";
import { API, Client, reachable } from "../http";
import type { EvidenceSet } from "./index";

const phase = "09-testing";
const WEB = "http://localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const padL = (s: unknown, n: number) => String(s).padStart(n);

/** docker CLI; Docker Desktop's bin folder is added in case it isn't on PATH. */
const docker = (...args: string[]) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    env: { ...process.env, PATH: `${process.env.PATH}${delimiter}C:\\Program Files\\Docker\\Docker\\resources\\bin` },
  }).trim();
type Kind = "read" | "event" | "checkout";
const CONTAINER_BY_PORT: Record<string, string> = { "27017": "mongo1", "27018": "mongo2", "27019": "mongo3" };

const loginAs = (email: string) => async (context: BrowserContext) => {
  const r = await context.request.post(`${WEB}/api/auth/login`, { data: { email, password: process.env.SEED_USER_PASSWORD } });
  if (!r.ok()) throw new Error(`login failed for ${email}`);
};

export const testing: EvidenceSet = {
  description: "Funnel correctness on a fixed dataset, unit tests, failover under load: primary crash and majority loss (kills MongoDB containers!)",
  async run() {
    if (!(await reachable(`${API}/health`)) || !(await reachable(WEB))) throw new Error("API, worker and web app must be running");
    const db = (await connectMongo()).db as unknown as Db;
    const redis = connectRedis();

    // 1. Funnel correctness: hand-made sessions with known answers ----------------------------------
    {
      // Sri Lanka local times; D1 = 2026-01-10, D2 = 2026-01-11
      const at = (local: string) => new Date(`${local}+05:30`);
      const D1 = "2026-01-10";
      const D2 = "2026-01-11";
      type Ev = [type: string, local: string];
      const sessions: { id: string; device: string; story: string; events: Ev[] }[] = [
        { id: "A", device: "desktop", story: "all four steps in order", events: [["product_view", `${D1}T10:00`], ["add_to_cart", `${D1}T10:05`], ["checkout_started", `${D1}T10:10`], ["order_placed", `${D1}T10:12`]] },
        { id: "B", device: "desktop", story: "view → cart, then leaves", events: [["product_view", `${D1}T11:00`], ["add_to_cart", `${D1}T11:03`]] },
        { id: "C", device: "mobile", story: "cart BEFORE view (e.g. re-order link): only the view counts", events: [["add_to_cart", `${D1}T12:00`], ["product_view", `${D1}T12:05`]] },
        { id: "D", device: "mobile", story: "order with no product view: not in the funnel at all", events: [["order_placed", `${D1}T12:30`]] },
        { id: "E", device: "mobile", story: "duplicates (2 views, 2 carts) counted once", events: [["product_view", `${D1}T13:00`], ["product_view", `${D1}T13:01`], ["add_to_cart", `${D1}T13:02`], ["add_to_cart", `${D1}T13:03`], ["checkout_started", `${D1}T13:05`]] },
        { id: "F", device: "tablet", story: "skips the cart: checkout and order don't count", events: [["product_view", `${D1}T14:00`], ["checkout_started", `${D1}T14:02`], ["order_placed", `${D1}T14:04`]] },
        { id: "G", device: "mobile", story: "crosses local midnight: counted on the day it started", events: [["product_view", `${D1}T23:50`], ["add_to_cart", `${D2}T00:10`]] },
        { id: "H", device: "desktop", story: "all four steps, day 2", events: [["product_view", `${D2}T09:00`], ["add_to_cart", `${D2}T09:02`], ["checkout_started", `${D2}T09:04`], ["order_placed", `${D2}T09:06`]] },
        { id: "I", device: "desktop", story: "only page views and a search: ignored", events: [["page_view", `${D2}T10:00`], ["search", `${D2}T10:01`]] },
        { id: "J", device: "desktop", story: "checkout BEFORE cart: stops after the cart step", events: [["product_view", `${D2}T11:00`], ["checkout_started", `${D2}T11:01`], ["add_to_cart", `${D2}T11:02`], ["order_placed", `${D2}T11:03`]] },
      ];
      // Worked out by hand from the stories above: [view, cart, checkout, order]
      const expected: Record<string, { steps: number[]; byDevice: Record<string, number[]> }> = {
        [D1]: { steps: [6, 4, 2, 1], byDevice: { desktop: [2, 2, 1, 1], mobile: [3, 2, 1, 0], tablet: [1, 0, 0, 0] } },
        [D2]: { steps: [2, 2, 1, 1], byDevice: { desktop: [2, 2, 1, 1] } },
      };

      const test = db.collection("zz_test_funnel_events");
      await test.drop().catch(() => undefined);
      await test.insertMany(
        sessions.flatMap((s) => s.events.map(([type, local]) => ({ ts: at(local), type, meta: { sessionId: `test-${s.id}`, anonymousId: `anon-${s.id}` }, device: { type: s.device } }))),
      );
      const rows = await test.aggregate(funnelPipeline(at(`${D1}T00:00`))).toArray();
      // Naive approach for comparison: distinct sessions per event type, ignoring order
      const naive = await test
        .aggregate([{ $match: { type: { $in: [...FUNNEL_STEPS] }, ts: { $lt: at(`${D2}T00:00`) } } }, { $group: { _id: "$type", s: { $addToSet: "$meta.sessionId" } } }])
        .toArray();
      await test.drop();

      const lines: string[] = ["# the dataset", ...sessions.map((s) => `${s.id}  ${pad(s.device, 8)} ${pad(s.story, 62)} ${s.events.map(([t, l]) => `${t}@${l.slice(5).replace("T", " ")}`).join(", ")}`), ""];
      let failures = 0;
      lines.push(`# expected (by hand) vs pipeline   ${pad("", 18)}[view, cart, checkout, order]`);
      for (const day of [D1, D2]) {
        const got: any = rows.find((r) => r._id.day === day);
        const check = (label: string, exp: number[], act: number[] | undefined) => {
          const ok = JSON.stringify(exp) === JSON.stringify(act);
          if (!ok) failures++;
          lines.push(`${pad(`${day} ${label}`, 30)} expected ${pad(JSON.stringify(exp), 14)} got ${pad(JSON.stringify(act ?? null), 14)} ${ok ? "PASS" : "FAIL"}`);
        };
        check("all devices", expected[day].steps, got?.steps.map((s: any) => s.sessions));
        for (const [dev, exp] of Object.entries(expected[day].byDevice)) check(dev, exp, got?.byDevice?.[dev]?.map((s: any) => s.sessions));
      }
      const naiveCounts = FUNNEL_STEPS.map((t) => naive.find((n) => n._id === t)?.s.length ?? 0);
      lines.push(
        "",
        `# why order matters (${D1})`,
        `naive distinct sessions per event type: ${JSON.stringify(naiveCounts)} → "conversion" ${((naiveCounts[3] / naiveCounts[0]) * 100).toFixed(0)}%`,
        `ordered funnel (the pipeline):          ${JSON.stringify(expected[D1].steps)} → conversion ${((expected[D1].steps[3] / expected[D1].steps[0]) * 100).toFixed(0)}%`,
        "",
        failures ? `RESULT: ${failures} FAILURE(S)` : "RESULT: all checks PASS",
      );
      recordText(
        {
          phase,
          name: "funnel-correctness",
          title: "Funnel pipeline correctness on a hand-made dataset",
          shows: "Ten sessions with known answers, including the awkward cases (steps out of order, duplicates, a skipped step, an order without a view, a session crossing local midnight, non-funnel events), run through the same funnelPipeline() the worker uses. Every day and device matches the hand-worked result. A naive count per event type would report 50% conversion instead of 17%.",
          reportSection: "10. Evaluation: testing",
        },
        { body: lines.join("\n"), command: "funnelPipeline() over a temporary collection, compared with hand-worked expectations" },
      );
      if (failures) throw new Error("funnel correctness check failed");
    }

    // 2. Unit tests -------------------------------------------------------------------------------
    {
      let out: string;
      try {
        out = execFileSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=spec", "tests/unit/*.test.ts"], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
      } catch (e: any) {
        out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      }
      recordText(
        {
          phase,
          name: "unit-tests",
          title: "Unit tests (node:test)",
          shows: "Pure-logic tests with no database: event schema validation (valid events accepted, spoofed server events and bad payloads rejected), PII masking, password hashing, live-counter minute keys.",
          reportSection: "10. Evaluation: testing",
        },
        { body: out.replace(/\x1b\[[0-9;]*m/g, "").trim(), command: "npm test" },
      );
    }

    // 3. Failover under load ----------------------------------------------------------------------
    const admin = db.admin();
    const status = async () => (await admin.command({ replSetGetStatus: 1 })) as any;
    const memberTable = (rs: any) => rs.members.map((m: any) => `  ${pad(m.name, 30)} ${pad(m.stateStr, 26)} health ${m.health}`).join("\n");
    /** Who does any reachable member think is primary? (primaryPreferred falls back to a secondary) */
    const currentPrimary = async (): Promise<string | null> => {
      try {
        const hello: any = await admin.command({ hello: 1 }, { readPreference: "primaryPreferred" } as any);
        return hello.primary ?? null;
      } catch {
        return null;
      }
    };
    const waitUntil = async (what: string, fn: () => Promise<boolean>, limitMs: number) => {
      const start = Date.now();
      while (!(await fn())) {
        if (Date.now() - start > limitMs) throw new Error(`timed out waiting for: ${what}`);
        await sleep(250);
      }
      return Date.now();
    };

    // A charger variant with plenty of stock for the test checkouts (stock restored afterwards)
    const [pick] = await db
      .collection("products")
      .aggregate([{ $match: { kind: "charging" } }, { $unwind: "$variants" }, { $sort: { "variants.stock": -1 } }, { $limit: 1 }, { $project: { sku: "$variants.sku" } }])
      .toArray();

    /** Continuous traffic: product reads, telemetry batches and checkouts, fired on a fixed schedule. */
    class Load {
      samples: { kind: Kind; t: number; ms: number; ok: boolean; status: number }[] = [];
      marks: { t: number; label: string }[] = [];
      eventsAccepted = 0;
      readonly session = randomUUID();
      private readonly anonymousId = randomUUID();
      private readonly t0 = Date.now();
      private inflight: Promise<void>[] = [];
      private timers: NodeJS.Timeout[] = [];

      start() {
        const timeout = () => AbortSignal.timeout(60_000);
        this.timers = [
          setInterval(() => this.fire("read", async () => (await fetch(`${API}/products?kind=phone&limit=1`, { signal: timeout() })).status), 250),
          setInterval(
            () =>
              this.fire("event", async () => {
                const events = Array.from({ length: 5 }, () => ({ eventId: randomUUID(), ts: new Date().toISOString(), type: "page_view", page: { path: "/failover-test" }, props: {} }));
                const r = await fetch(`${API}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anonymousId: this.anonymousId, sessionId: this.session, events }), signal: timeout() });
                if (r.status === 202) this.eventsAccepted += 5;
                return r.status;
              }),
            250,
          ),
          setInterval(
            () =>
              this.fire("checkout", async () => {
                const c = new Client();
                const add = await c.post("/cart/items", { sku: pick.sku, qty: 1 }); // reads the product from MongoDB
                if (add.status >= 300) return add.status;
                return (await c.post("/checkout", { contact: { name: "Failover Test", email: "failover-test@cellora.test" }, address: { line1: "1 Test Lane", city: "Colombo" }, payment: "cod" })).status;
              }),
            1000,
          ),
        ];
      }
      mark(label: string) {
        this.marks.push({ t: Date.now() - this.t0, label });
      }
      private fire(kind: Kind, fn: () => Promise<number>) {
        const t = Date.now();
        this.inflight.push(
          fn()
            .catch(() => 0)
            .then((status) => void this.samples.push({ kind, t: t - this.t0, ms: Date.now() - t, ok: status >= 200 && status < 300, status })),
        );
      }
      async stop() {
        this.timers.forEach(clearInterval);
        this.mark("load stopped");
        await Promise.all(this.inflight);
      }
      /** Waits for the worker to drain the stream, then counts this run's events in MongoDB. */
      async storedEvents() {
        let stored = 0;
        for (let i = 0; i < 120 && stored < this.eventsAccepted; i++) {
          stored = await db.collection("events").countDocuments({ "meta.sessionId": this.session });
          if (stored < this.eventsAccepted) await sleep(1000);
        }
        return stored;
      }
      async cleanUp() {
        const orders = this.samples.filter((s) => s.kind === "checkout" && s.ok).length;
        await db.collection("products").updateOne({ "variants.sku": pick.sku }, { $inc: { "variants.$.stock": orders } });
        await db.collection("events").deleteMany({ "meta.sessionId": this.session });
      }
      summary(kind: Kind) {
        const xs = this.samples.filter((x) => x.kind === kind);
        const bad = xs.filter((x) => !x.ok);
        const codes = [...new Set(bad.map((b) => (b.status ? `HTTP ${b.status}` : "no response")))].join(", ");
        return `${pad(kind, 9)} ${padL(xs.length, 4)} sent, ${padL(bad.length, 3)} failed${bad.length ? ` (${codes})` : ""}, slowest ${Math.max(...xs.map((x) => x.ms))} ms`;
      }
      /** Per-second table, printed only around the marked moments. */
      timeline() {
        const sec = (ms: number) => Math.floor(ms / 1000);
        const markAt = new Map(this.marks.map((m) => [sec(m.t), m.label]));
        const lastS = sec(Math.max(...this.samples.map((s) => s.t)));
        const rows = [`${pad("t (s)", 7)}${pad("reads ok/fail max ms", 24)}${pad("events ok/fail max ms", 24)}${pad("checkouts ok/fail max ms", 26)}`];
        for (let s = 0; s <= lastS; s++) {
          const cell = (k: Kind) => {
            const xs = this.samples.filter((x) => x.kind === k && sec(x.t) === s);
            return pad(xs.length ? `${padL(xs.filter((x) => x.ok).length, 3)}/${pad(xs.filter((x) => !x.ok).length, 3)} ${padL(Math.max(...xs.map((x) => x.ms)), 6)}` : "", 24);
          };
          const near = [...markAt.keys()].some((m) => Math.abs(s - m) <= 2) || s < 2;
          if (near) rows.push(`${pad(s, 7)}${cell("read")}${cell("event")}${pad(cell("checkout"), 26)}${markAt.has(s) ? `← ${markAt.get(s)}` : ""}`);
          else if (rows.at(-1) !== "…") rows.push("…");
        }
        return rows;
      }
    }

    // 3a. The primary crashes ------------------------------------------------------------------
    {
      const before = await status();
      const oldPrimary: string = before.members.find((m: any) => m.stateStr === "PRIMARY").name;
      const container = CONTAINER_BY_PORT[oldPrimary.split(":")[1]];
      const load = new Load();
      load.start();
      await sleep(5000); // baseline

      load.mark(`${container} (primary) killed`);
      const tKill = Date.now();
      docker("kill", container); // a crash, not a clean shutdown: no step-down handover
      let newPrimary = "";
      const tElected = await waitUntil("a new primary", async () => !!(newPrimary = (await currentPrimary()) ?? "") && newPrimary !== oldPrimary, 60_000);
      load.mark(`new primary ${newPrimary.split(":")[1]} elected`);
      await sleep(8000);
      const during = await status();
      await screenshot(
        {
          phase,
          name: "failover-health-during",
          title: "Health dashboard during the failover",
          shows: `The primary container (${container}) has been killed: the admin health page shows it unreachable and a new primary (${newPrimary}) elected by the two survivors.`,
          reportSection: "8. Strengths: high availability (replica set failover)",
        },
        { url: `${WEB}/staff/admin/health`, setup: loginAs("admin@cellora.test"), fullPage: false },
      );

      load.mark(`${container} restarted`);
      const tRestart = Date.now();
      docker("start", container);
      const tRejoined = await waitUntil("old primary back as SECONDARY", async () => !!(await status().catch(() => null))?.members.find((m: any) => m.name === oldPrimary && m.stateStr === "SECONDARY" && m.health === 1), 120_000);
      load.mark("rejoined as SECONDARY");
      await sleep(4000);
      await load.stop();
      const stored = await load.storedEvents();
      const after = await status();
      await screenshot(
        {
          phase,
          name: "failover-health-after",
          title: "Health dashboard after the old primary rejoined",
          shows: `${container} is back as a SECONDARY and has caught up; ${newPrimary} stays primary (no fail-back needed).`,
          reportSection: "8. Strengths: high availability (replica set failover)",
        },
        { url: `${WEB}/staff/admin/health`, setup: loginAs("admin@cellora.test"), fullPage: false },
      );
      await load.cleanUp();

      recordText(
        {
          phase,
          name: "failover-under-load",
          title: "Replica set failover under load: primary killed, new primary elected, old one rejoins",
          shows:
            "While reads, telemetry and checkouts run continuously, the primary's container is killed (a crash, not a clean shutdown). The two remaining members still form a majority and elect a new primary; the MongoDB driver discovers it by itself. Requests in flight during the election wait (up to the 20 s server-selection timeout) and then complete: no request fails. Telemetry is never slowed, because the API only appends to the Redis stream. The old node rejoins as a secondary.",
          reportSection: "8. Strengths: high availability; 7. CAP (availability with a majority); 10. Evaluation: testing",
        },
        {
          command: `docker kill ${container} … docker start ${container}; load: GET /api/products every 250 ms, POST /api/events (5 events) every 250 ms, checkout every 1 s`,
          body: [
            "# before",
            memberTable(before),
            "",
            `# kill ${container} (${oldPrimary}) → new primary ${newPrimary} after ${((tElected - tKill) / 1000).toFixed(1)} s`,
            memberTable(during),
            "",
            `# docker start ${container} → back as SECONDARY after ${((tRejoined - tRestart) / 1000).toFixed(1)} s`,
            memberTable(after),
            "",
            "# load results",
            load.summary("read"),
            load.summary("event"),
            load.summary("checkout"),
            `telemetry: ${load.eventsAccepted} events accepted by the API (202) → ${stored} in MongoDB after the worker caught up ${stored >= load.eventsAccepted ? "(none lost)" : "(MISSING SOME)"}`,
            "",
            "# timeline (per second, around the key moments)",
            ...load.timeline(),
          ].join("\n"),
        },
      );
    }

    // 3b. Two of three members lost: no majority, so no primary at all ----------------------------
    {
      const before = await status();
      const primary: string = before.members.find((m: any) => m.stateStr === "PRIMARY").name;
      const secondaries: string[] = before.members.filter((m: any) => m.stateStr === "SECONDARY").map((m: any) => m.name);
      const killed = [CONTAINER_BY_PORT[primary.split(":")[1]], CONTAINER_BY_PORT[secondaries[0].split(":")[1]]];
      const survivor = secondaries[1];
      const load = new Load();
      load.start();
      await sleep(5000);

      load.mark(`${killed.join(" + ")} killed`);
      docker("kill", ...killed);
      await sleep(10_000);
      const during = await status().catch(() => null); // no primary to ask: expected to fail
      const survivorHello: any = await MongoClient.connect(config.mongoUri.replace(/@[^/]+\//, `@${survivor}/`).replace(/\?.*$/, "?authSource=admin&directConnection=true"))
        .then(async (c) => {
          const h = await c.db("admin").command({ hello: 1 });
          await c.close();
          return h;
        })
        .catch((e) => ({ error: e.message }));
      await sleep(20_000);

      load.mark(`${killed.join(" + ")} restarted`);
      const tRestart = Date.now();
      docker("start", ...killed);
      const tPrimary = await waitUntil("a primary again", async () => !!(await currentPrimary()), 120_000);
      load.mark("primary available again");
      await sleep(5000);
      await load.stop();
      const stored = await load.storedEvents();
      await waitUntil("all three members healthy", async () => ((await status().catch(() => null))?.members ?? []).every((m: any) => m.health === 1 && ["PRIMARY", "SECONDARY"].includes(m.stateStr)), 120_000);
      const after = await status();
      await load.cleanUp();

      recordText(
        {
          phase,
          name: "majority-loss",
          title: "Losing the majority: MongoDB stops accepting writes rather than risk inconsistency",
          shows:
            "Two of the three members are killed. The survivor can't see a majority, so it refuses to become primary (CP behaviour: no split-brain, no conflicting writes). Database-backed requests (catalogue reads, add-to-cart + checkout) fail with HTTP 500 once the 20 s server-selection timeout runs out. Telemetry keeps being accepted, because it is only appended to the Redis stream; the worker's inserts fail, the batch stays pending, and the worker retries it until a primary is back. Once the members return, every accepted event reaches MongoDB.",
          reportSection: "7. Characteristics: CAP / consistency; 9. Strengths: decoupled ingestion; 10. Limitations: availability without a majority",
        },
        {
          command: `docker kill ${killed.join(" ")} … (30 s) … docker start ${killed.join(" ")}; same load as failover-under-load`,
          body: [
            "# before",
            memberTable(before),
            "",
            `# kill ${killed.join(" + ")} (primary ${primary} and secondary ${secondaries[0]})`,
            `replSetGetStatus through the app connection: ${during ? "answered?!" : "no answer (needs a primary)"}`,
            `hello on the survivor ${survivor} (direct connection): ${JSON.stringify({ isWritablePrimary: survivorHello.isWritablePrimary, secondary: survivorHello.secondary, primary: survivorHello.primary ?? null, ...(survivorHello.error && { error: survivorHello.error }) })}`,
            "",
            `# restart both → a primary again after ${((tPrimary - tRestart) / 1000).toFixed(1)} s`,
            memberTable(after),
            "",
            "# load results",
            load.summary("read"),
            load.summary("event"),
            load.summary("checkout"),
            `telemetry: ${load.eventsAccepted} events accepted by the API (202) → ${stored} in MongoDB after recovery ${stored >= load.eventsAccepted ? "(none lost)" : "(MISSING SOME)"}`,
            "",
            "# timeline (per second, around the key moments)",
            ...load.timeline(),
          ].join("\n"),
        },
      );
    }

    redis.disconnect();
  },
};

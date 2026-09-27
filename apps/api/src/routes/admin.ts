// Administrator endpoints (UC4–UC7, UC15). Admin only; every change is written to audit_log.
//
//   GET   /admin/users                       users & roles + live Redis session counts   (UC4)
//   PATCH /admin/users/:id                   change role / disable                       (UC4)
//   POST  /admin/users/:id/revoke-sessions   log out everywhere                          (UC4)
//   GET   /admin/settings, PATCH             event retention (collMod), rollup interval  (UC5)
//   GET   /admin/indexes                     indexes, sizes and $indexStats usage        (UC6)
//   POST  /admin/rollups/rebuild             ask the worker for a full rollup rebuild    (UC6)
//   GET   /admin/health                      replica set, server, Redis, stream backlog  (UC7)
//   POST  /admin/customers/:id/erase         GDPR right to erasure                       (UC15)
//   GET   /admin/audit                       the audit trail
import { Router } from "express";
import type { Redis } from "ioredis";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { ROLES, type AdminSettings, type AdminUser, type AuditEntry, type CollectionIndexes, type ErasureResult, type HealthReport } from "@da2/shared";
import { Order, User, mongoose } from "@da2/shared/server";
import { HttpError, parse } from "../lib/http";
import { audit } from "../lib/audit";
import { userCartKey } from "../lib/cart";
import { revokeAllSessions } from "../lib/sessions";
import { EVENT_STREAM } from "../lib/telemetry";
import { requireRole } from "../middleware/session";

const { ObjectId } = mongoose.Types;
/** Read by the worker's scheduler every 15 s (apps/worker/src/index.ts). */
const REBUILD_KEY = "rollups:rebuild";
const DEAD_LETTER = "events:dead";
const DAY_SECONDS = 86_400;
const INDEXED_COLLECTIONS = ["products", "users", "orders", "events", "session_summaries", "metrics_hourly", "funnel_daily", "session_notes", "audit_log"];

const db = () => mongoose.connection.db!;
const col = (name: string) => db().collection(name);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Counts the user's sessions that still exist (the SET can hold ids whose hash already expired). */
async function liveSessionCounts(redis: Redis, userIds: string[]) {
  const sets = ((await userIds.reduce((p, id) => p.smembers(`user_sessions:${id}`), redis.pipeline()).exec()) ?? []).map(([, v]) => v as string[]);
  const flat = sets.flatMap((ids, i) => ids.map((sid) => [i, sid] as const));
  const exists = ((await flat.reduce((p, [, sid]) => p.exists(`sess:${sid}`), redis.pipeline()).exec()) ?? []).map(([, v]) => Number(v));
  const counts = userIds.map(() => 0);
  flat.forEach(([i], j) => (counts[i] += exists[j]));
  return counts;
}

/** XINFO replies are flat [key, value, key, value…] arrays. */
const pairs = (arr: unknown[]) => Object.fromEntries(Array.from({ length: arr.length / 2 }, (_, i) => [arr[i * 2], arr[i * 2 + 1]]));

export function adminRouter(redis: Redis) {
  const router = Router();
  router.use("/admin", requireRole("admin"));

  // ---- UC4: users & roles ----------------------------------------------------------------------
  router.get("/admin/users", async (req, res) => {
    const q = parse(
      z.object({
        q: z.string().trim().max(100).optional(),
        role: z.enum(ROLES).optional(),
        page: z.coerce.number().int().min(1).default(1),
        includeSimulated: z.enum(["true", "false"]).default("false"),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    // Index {role: 1}; the email prefix regex uses {email: 1}
    if (q.role) filter.role = q.role;
    const emailConds: Record<string, unknown>[] = [];
    if (q.q) emailConds.push({ email: { $regex: `^${escapeRegex(q.q.toLowerCase())}` } });
    if (q.includeSimulated === "false") emailConds.push({ email: { $not: /^sim-\d+@/ } }); // the 150 simulator accounts
    if (emailConds.length) filter.$and = emailConds;

    const PAGE = 25;
    const [users, total] = await Promise.all([
      User.find(filter, { name: 1, email: 1, role: 1, status: 1, createdAt: 1, lastLoginAt: 1 })
        .sort({ role: 1, email: 1 })
        .skip((q.page - 1) * PAGE)
        .limit(PAGE)
        .lean(),
      User.countDocuments(filter),
    ]);
    const counts = await liveSessionCounts(redis, users.map((u) => String(u._id)));
    res.json({
      total,
      page: q.page,
      pageSize: PAGE,
      users: users.map((u, i) => ({ ...(u as any), _id: String(u._id), activeSessions: counts[i] }) satisfies AdminUser),
    });
  });

  router.patch("/admin/users/:id", async (req, res) => {
    const id = String(req.params.id);
    if (!isValidObjectId(id)) throw new HttpError(400, "Invalid user id");
    if (id === req.user!.userId) throw new HttpError(400, "You can't change your own role or status");
    const body = parse(z.object({ role: z.enum(ROLES).optional(), status: z.enum(["active", "disabled"]).optional() }), req.body);

    const before = await User.findById(id, { role: 1, status: 1, email: 1 }).lean();
    if (!before) throw new HttpError(404, "User not found");
    if (before.status === "erased") throw new HttpError(409, "This account has been erased");
    await User.updateOne({ _id: id }, { $set: body });

    // The role is copied into the Redis session at login, so a changed role (or a disabled
    // account) only takes effect once the old sessions are gone: revoke them now.
    const revoked = await revokeAllSessions(redis, id);
    if (body.role && body.role !== before.role) await audit(req, "role_changed", { type: "user", id }, { from: before.role, to: body.role, sessionsRevoked: revoked });
    if (body.status && body.status !== before.status) await audit(req, "status_changed", { type: "user", id }, { from: before.status, to: body.status, sessionsRevoked: revoked });
    res.json({ ok: true, sessionsRevoked: revoked });
  });

  // Log a user out of every device, effective immediately.
  router.post("/admin/users/:id/revoke-sessions", async (req, res) => {
    const id = String(req.params.id);
    if (!isValidObjectId(id)) throw new HttpError(400, "Invalid user id");
    const user = await User.findById(id, { email: 1 }).lean();
    if (!user) throw new HttpError(404, "User not found");
    const revoked = await revokeAllSessions(redis, id);
    await audit(req, "sessions_revoked", { type: "user", id }, { revoked });
    res.json({ revoked });
  });

  // ---- UC5 + UC6: settings, retention, rollups -------------------------------------------------
  async function settings(): Promise<AdminSettings> {
    const [global, rollups, info, rebuild] = await Promise.all([
      col("settings").findOne({ _id: "global" as any }),
      col("settings").findOne({ _id: "rollups" as any }),
      db().listCollections({ name: "events" }).toArray(),
      redis.exists(REBUILD_KEY),
    ]);
    return {
      eventRetentionDays: global?.eventRetentionDays ?? 90,
      rollupIntervalMin: global?.rollupIntervalMin ?? 5,
      eventsExpireAfterSeconds: (info[0] as any)?.options?.expireAfterSeconds ?? null,
      updatedAt: global?.updatedAt,
      updatedByName: global?.updatedByName,
      rollups: rollups ? { lastRunAt: rollups.lastRunAt, mode: rollups.mode, durationMs: rollups.durationMs } : null,
      rebuildPending: rebuild === 1,
    };
  }

  router.get("/admin/settings", async (_req, res) => {
    res.json(await settings());
  });

  router.patch("/admin/settings", async (req, res) => {
    const body = parse(
      z.object({ eventRetentionDays: z.number().int().min(1).max(730).optional(), rollupIntervalMin: z.number().int().min(1).max(60).optional() }),
      req.body,
    );
    const before = await settings();
    if (body.eventRetentionDays !== undefined && body.eventRetentionDays !== before.eventRetentionDays) {
      // UC5: the time-series collection's own TTL. MongoDB drops whole buckets once every event
      // in them is older than this; no cron job or batch delete of our own.
      await db().command({ collMod: "events", expireAfterSeconds: body.eventRetentionDays * DAY_SECONDS });
      await audit(req, "retention_changed", { type: "collection", id: "events" }, { fromDays: before.eventRetentionDays, toDays: body.eventRetentionDays });
    }
    if (body.rollupIntervalMin !== undefined && body.rollupIntervalMin !== before.rollupIntervalMin) {
      await audit(req, "rollup_interval_changed", { type: "settings", id: "global" }, { fromMin: before.rollupIntervalMin, toMin: body.rollupIntervalMin });
    }
    await col("settings").updateOne(
      { _id: "global" as any },
      { $set: { ...body, updatedAt: new Date(), updatedBy: new ObjectId(req.user!.userId), updatedByName: req.user!.name } },
    );
    res.json(await settings());
  });

  router.post("/admin/rollups/rebuild", async (req, res) => {
    // The API doesn't run the rebuild itself (it can take seconds and belongs to the worker);
    // it leaves a flag in Redis that the worker picks up within 15 s.
    await redis.set(REBUILD_KEY, new Date().toISOString(), "EX", 600);
    await audit(req, "rollups_rebuild_requested", { type: "rollups", id: "all" });
    res.status(202).json({ ok: true, message: "The worker will run a full rebuild within 15 seconds." });
  });

  // ---- UC6: indexes and their usage ------------------------------------------------------------
  router.get("/admin/indexes", async (_req, res) => {
    const collections: CollectionIndexes[] = await Promise.all(
      INDEXED_COLLECTIONS.map(async (name) => {
        const c = col(name);
        const [specs, stats, [coll]] = await Promise.all([
          c.listIndexes().toArray(),
          // $indexStats: how often each index was used since the server started (on this node)
          c.aggregate([{ $indexStats: {} }]).toArray(),
          c.aggregate([{ $collStats: { storageStats: {} } }]).toArray(),
        ]);
        const s = coll.storageStats;
        const usage = new Map(stats.map((i) => [i.name, i.accesses]));
        const timeseries = !!s.timeseries;
        return {
          name,
          type: timeseries ? "timeseries" : "collection",
          // Time-series stats describe buckets, so count the events themselves
          count: timeseries ? await c.estimatedDocumentCount().catch(() => c.countDocuments()) : s.count,
          sizeBytes: s.size,
          storageBytes: s.storageSize,
          indexes: specs.map((ix) => ({
            name: ix.name,
            key: ix.key,
            sizeBytes: s.indexSizes?.[ix.name] ?? 0,
            ops: Number(usage.get(ix.name)?.ops ?? 0),
            since: usage.get(ix.name)?.since,
            ...(ix.unique && { unique: true }),
            ...(ix.partialFilterExpression && { partial: true }),
            ...(ix.expireAfterSeconds !== undefined && { ttlSeconds: ix.expireAfterSeconds }),
          })),
        };
      }),
    );
    res.json({ collections });
  });

  // ---- UC7: system health ----------------------------------------------------------------------
  router.get("/admin/health", async (_req, res) => {
    const admin = db().admin();
    // replSetGetStatus and serverStatus need the clusterMonitor role (granted to da2_app)
    const [rs, ss, dbStats, info, xlen, groups, dead] = await Promise.all([
      admin.command({ replSetGetStatus: 1 }),
      admin.command({ serverStatus: 1 }),
      db().stats(),
      redis.info(),
      redis.xlen(EVENT_STREAM),
      redis.xinfo("GROUPS", EVENT_STREAM) as Promise<unknown[][]>,
      redis.xlen(DEAD_LETTER),
    ]);

    const primary = rs.members.find((m: any) => m.stateStr === "PRIMARY");
    const r = Object.fromEntries(
      info
        .split("\r\n")
        .filter((l) => l.includes(":"))
        .map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1)]),
    );
    const hits = Number(r.keyspace_hits);
    const misses = Number(r.keyspace_misses);
    const keys = Object.keys(r)
      .filter((k) => /^db\d+$/.test(k))
      .reduce((n, k) => n + Number(/keys=(\d+)/.exec(r[k])?.[1] ?? 0), 0);

    res.json({
      mongo: {
        setName: rs.set,
        members: rs.members.map((m: any) => ({
          name: m.name,
          state: m.stateStr,
          health: m.health,
          uptimeSec: m.uptime,
          optimeDate: m.optimeDate,
          // Replication lag: how far this member's last applied write trails the primary's
          lagSec: primary ? Math.max(0, (primary.optimeDate - m.optimeDate) / 1000) : 0,
          pingMs: m.pingMs ?? null,
          self: !!m.self,
        })),
        server: {
          version: ss.version,
          uptimeSec: ss.uptime,
          connections: { current: ss.connections.current, available: ss.connections.available },
          opcounters: Object.fromEntries(Object.entries(ss.opcounters).map(([k, v]) => [k, Number(v)])),
          residentMB: ss.mem.resident,
          transactions: { committed: Number(ss.transactions?.totalCommitted ?? 0), aborted: Number(ss.transactions?.totalAborted ?? 0) },
        },
        db: { collections: dbStats.collections, objects: dbStats.objects, dataBytes: dbStats.dataSize, storageBytes: dbStats.storageSize, indexBytes: dbStats.indexSize },
      },
      redis: {
        version: r.redis_version,
        uptimeSec: Number(r.uptime_in_seconds),
        usedMemory: r.used_memory_human,
        peakMemory: r.used_memory_peak_human,
        clients: Number(r.connected_clients),
        opsPerSec: Number(r.instantaneous_ops_per_sec),
        aof: r.aof_enabled === "1",
        keys,
        hitRate: hits + misses ? hits / (hits + misses) : null,
      },
      stream: {
        name: EVENT_STREAM,
        length: xlen,
        groups: groups.map((g) => {
          const o = pairs(g);
          return { name: o.name, consumers: Number(o.consumers), pending: Number(o.pending), lag: o.lag === null ? null : Number(o.lag), lastDeliveredId: o["last-delivered-id"] };
        }),
        deadLetters: dead,
      },
      checkedAt: new Date().toISOString(),
    } satisfies HealthReport);
  });

  // ---- UC15: GDPR right to erasure -------------------------------------------------------------
  router.post("/admin/customers/:id/erase", async (req, res) => {
    const id = String(req.params.id);
    if (!isValidObjectId(id)) throw new HttpError(400, "Invalid user id");
    const { confirmEmail } = parse(z.object({ confirmEmail: z.string().trim().toLowerCase() }), req.body);
    const user = await User.findById(id).lean();
    if (!user) throw new HttpError(404, "User not found");
    if (user.role !== "customer") throw new HttpError(400, "Only customer accounts can be erased");
    if (user.status !== "erased" && confirmEmail !== user.email) throw new HttpError(400, "The confirmation email doesn't match this account");

    const started = Date.now();
    const oid = new ObjectId(id);
    const anonIds = user.anonymousIds ?? [];
    // Every browser session that belongs to this person: logged in, or anonymous on a linked browser
    const identity = { $or: [{ "meta.customerId": oid }, { "meta.anonymousId": { $in: anonIds } }] };

    // No multi-document transaction here: writes to a time-series collection can't run inside
    // one, and Redis isn't covered by MongoDB transactions anyway. Instead every step is
    // idempotent and the user document (which holds the anonymous ids) is pseudonymised LAST,
    // so a failed erasure can simply be run again.
    const sessionIds = await col("events").distinct("meta.sessionId", identity);
    const events = await col("events").deleteMany(identity); // time-series: delete by metaField
    const summaries = await col("session_summaries").deleteMany({ $or: [{ customerId: oid }, { anonymousId: { $in: anonIds } }, { _id: { $in: sessionIds } }] });
    const notes = await col("session_notes").deleteMany({ $or: [{ customerId: oid }, { sessionId: { $in: sessionIds } }] });

    // Orders are KEPT (tax/accounting records are a lawful reason to retain them) but stripped
    // of personal data: what was bought and for how much stays, who and where goes.
    const erasedEmail = `erased-${id}@erased.invalid`;
    const orders = await Order.updateMany(
      // (skip orders already pseudonymised, so a re-run changes nothing)
      { $or: [{ customerId: oid }, { "contact.email": user.email }], "contact.email": { $ne: erasedEmail } },
      {
        $set: { "contact.name": "Erased customer", "contact.email": erasedEmail, "shippingAddress.line1": "[erased]" },
        $unset: { "contact.phone": "", guestEmail: "", sessionId: "", anonymousId: "", "shippingAddress.line2": "", "shippingAddress.postcode": "" },
      },
    );

    const revoked = await revokeAllSessions(redis, id);
    const redisKeys = await redis.del(userCartKey(id));

    await User.updateOne(
      { _id: oid },
      {
        $set: { name: "Erased customer", email: erasedEmail, passwordHash: "erased", addresses: [], anonymousIds: [], status: "erased", erasedAt: new Date() },
        $unset: { lastLoginAt: "" },
      },
      { strict: false },
    );

    const result: ErasureResult = {
      userId: id,
      events: events.deletedCount,
      sessionSummaries: summaries.deletedCount,
      sessionNotes: notes.deletedCount,
      ordersPseudonymised: orders.modifiedCount,
      redisKeys,
      sessionsRevoked: revoked,
      durationMs: Date.now() - started,
    };
    // The audit entry records THAT an erasure happened and its scope, but no personal data
    const { userId: _, durationMs: __, ...counts } = result;
    await audit(req, "customer_erased", { type: "user", id }, counts);
    res.json(result);
  });

  // ---- Audit trail -----------------------------------------------------------------------------
  router.get("/admin/audit", async (req, res) => {
    const { action } = parse(z.object({ action: z.string().max(50).optional() }), req.query);
    // Index {at: -1}
    const entries = await col("audit_log")
      .find(action ? { action } : {})
      .sort({ at: -1 })
      .limit(100)
      .toArray();
    res.json({ entries: entries.map((e) => ({ ...e, _id: String(e._id), actorId: String(e.actorId) }) as AuditEntry) });
  });

  return router;
}

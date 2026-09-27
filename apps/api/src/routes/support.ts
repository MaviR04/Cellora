// Customer Support endpoints (UC12–UC14). Support and Admin only.
//
//   GET   /support/search?q=                 find a customer by email, order number or anonymous/session id
//   GET   /support/customers/:id             profile, sessions, orders, live cart, notes      (UC12, UC13)
//   GET   /support/sessions/:sessionId       session timeline from raw events + notes         (UC12)
//   GET   /support/failed-checkouts          recent checkout_failed events, newest first      (UC12)
//   GET   /support/orders/:orderNumber       any order                                        (UC13)
//   POST  /support/sessions/:sessionId/notes annotate / flag a session                        (UC14)
//   PATCH /support/notes/:id                 resolve or re-open a note                        (UC14)
//   GET   /support/escalations               flagged notes, the escalation queue              (UC14)
//
// These run on the PRIMARY (default connection), not the analyst secondary: an agent on a call
// needs the customer's latest activity and must see their own note straight after saving it
// (read-your-writes). Contact details are masked for the support role (lib/pii.ts).
import { Router } from "express";
import type { Redis } from "ioredis";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import type { CustomerDetail, FailedCheckout, SearchHit, SessionDetail, SessionNote, SupportCustomer } from "@da2/shared";
import { Order, User, mongoose } from "@da2/shared/server";
import { HttpError, parse } from "../lib/http";
import { loadCart, userCartKey } from "../lib/cart";
import { maskEmail, maskOrder, shouldMask } from "../lib/pii";
import { requireRole } from "../middleware/session";
import type { Role } from "@da2/shared";

const { ObjectId } = mongoose.Types;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_NUMBER = /^ORD-\d{8}-\d{4,}$/i;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const col = (name: string) => mongoose.connection.collection(name);

function toCustomer(u: any, role: Role): SupportCustomer {
  return {
    _id: String(u._id),
    name: u.name,
    email: shouldMask(role) ? maskEmail(u.email)! : u.email,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    anonymousIds: u.anonymousIds ?? [],
  };
}

const toNote = (n: any): SessionNote => ({ ...n, _id: String(n._id), customerId: n.customerId ? String(n.customerId) : null, authorId: String(n.authorId) });

export function supportRouter(redis: Redis) {
  const router = Router();
  router.use("/support", requireRole("support", "admin"));

  // ---- Find a customer -------------------------------------------------------------------------
  router.get("/support/search", async (req, res) => {
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    const role = req.user!.role;
    const hits: SearchHit[] = [];

    if (ORDER_NUMBER.test(q)) {
      // Unique index {orderNumber: 1}
      const o = await Order.findOne({ orderNumber: q.toUpperCase() }, { orderNumber: 1, customerId: 1, contact: 1, sessionId: 1, totals: 1 }).lean();
      if (o) {
        hits.push({
          kind: "order",
          label: o.orderNumber,
          sublabel: `${o.contact?.name ?? "?"} · ${o.customerId ? "customer" : "guest"} order`,
          orderNumber: o.orderNumber,
          customerId: o.customerId ? String(o.customerId) : undefined,
          sessionId: o.sessionId ?? undefined,
        });
      }
    } else if (UUID.test(q)) {
      // A session id or an anonymous (browser) id, e.g. read out from the customer's device.
      // Indexes: session_summaries _id and {anonymousId: 1, startedAt: -1}; users {anonymousIds: 1} (multikey)
      const [session, anonSessions, owner] = await Promise.all([
        col("session_summaries").findOne({ _id: q as any }),
        col("session_summaries").find({ anonymousId: q }).sort({ startedAt: -1 }).limit(1).toArray(),
        User.findOne({ anonymousIds: q }, { name: 1, email: 1 }).lean(),
      ]);
      if (owner) hits.push({ kind: "customer", label: owner.name, sublabel: `${shouldMask(role) ? maskEmail(owner.email) : owner.email} · linked browser`, customerId: String(owner._id) });
      if (session) hits.push({ kind: "anonymous", label: "Session", sublabel: `${q.slice(0, 8)}… · ${session.eventCount} events`, sessionId: q });
      else if (anonSessions[0]) hits.push({ kind: "anonymous", label: "Anonymous visitor", sublabel: `latest session ${String(anonSessions[0]._id).slice(0, 8)}…`, sessionId: String(anonSessions[0]._id) });
    } else {
      // Email prefix: emails are stored lower-case, so an anchored, case-sensitive regex can use
      // the {email: 1} index as a range scan. (A name search would need a text index; out of scope.)
      const users = await User.find({ email: { $regex: `^${escapeRegex(q.toLowerCase())}` } }, { name: 1, email: 1, role: 1, status: 1 })
        .sort({ email: 1 })
        .limit(10)
        .lean();
      for (const u of users) {
        hits.push({ kind: "customer", label: u.name, sublabel: `${shouldMask(role) ? maskEmail(u.email) : u.email} · ${u.role}${u.status !== "active" ? ` · ${u.status}` : ""}`, customerId: String(u._id) });
      }
    }
    res.json({ hits });
  });

  // ---- Customer 360 (UC12 + UC13) --------------------------------------------------------------
  router.get("/support/customers/:id", async (req, res) => {
    const id = String(req.params.id);
    if (!isValidObjectId(id)) throw new HttpError(400, "Invalid customer id");
    const user = await User.findById(id, { passwordHash: 0 }).lean();
    if (!user) throw new HttpError(404, "Customer not found");
    const role = req.user!.role;
    const oid = new ObjectId(id);

    const [sessions, orders, cart, notes] = await Promise.all([
      // Sessions after login carry customerId; earlier anonymous sessions are found through the
      // browser ids linked at login (identity stitching). Both branches are indexed.
      col("session_summaries")
        .find({ $or: [{ customerId: oid }, { anonymousId: { $in: user.anonymousIds ?? [] } }] })
        .sort({ startedAt: -1 })
        .limit(50)
        .toArray(),
      // Index {customerId: 1, createdAt: -1}
      Order.find({ customerId: oid }, { orderNumber: 1, createdAt: 1, status: 1, totals: 1, payment: 1, "items.name": 1, "items.qty": 1 })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      loadCart(redis, userCartKey(id)),
      col("session_notes").find({ customerId: oid }).sort({ createdAt: -1 }).limit(50).toArray(),
    ]);

    res.json({
      customer: toCustomer(user, role),
      sessions: sessions as any,
      orders: orders as any,
      cart,
      notes: notes.map(toNote),
    } satisfies CustomerDetail);
  });

  // ---- Session timeline (UC12) -----------------------------------------------------------------
  router.get("/support/sessions/:sessionId", async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!UUID.test(sessionId)) throw new HttpError(400, "Invalid session id");
    const role = req.user!.role;

    const [summary, events, orders, notes] = await Promise.all([
      col("session_summaries").findOne({ _id: sessionId as any }),
      // Raw events, not the rollup: the timeline is always up to the second.
      // Index {meta.sessionId: 1, ts: 1}; the session's events also share time-series buckets.
      col("events")
        .find({ "meta.sessionId": sessionId }, { projection: { ts: 1, type: 1, source: 1, page: 1, props: 1, meta: 1 } })
        .sort({ ts: 1 })
        .limit(500)
        .toArray(),
      Order.find({ sessionId }, { orderNumber: 1, totals: 1, status: 1 }).lean(),
      col("session_notes").find({ sessionId }).sort({ createdAt: 1 }).toArray(),
    ]);
    if (!summary && !events.length) throw new HttpError(404, "Session not found");

    const customerId = summary?.customerId ?? [...events].reverse().find((e) => e.meta.customerId)?.meta.customerId ?? null;
    const user = customerId ? await User.findById(customerId, { name: 1, email: 1 }).lean() : null;

    res.json({
      sessionId,
      summary: summary as any,
      customer: user ? { _id: String(user._id), name: user.name, email: shouldMask(role) ? maskEmail(user.email)! : user.email } : null,
      events: events.map((e) => ({ ts: e.ts, type: e.type, source: e.source, path: e.page?.path, props: e.props ?? {} })),
      orders: orders.map((o) => ({ orderNumber: o.orderNumber, total: o.totals?.total ?? 0, status: o.status })),
      notes: notes.map(toNote),
    } satisfies SessionDetail);
  });

  // ---- Failed checkouts queue (UC12) -----------------------------------------------------------
  router.get("/support/failed-checkouts", async (req, res) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }), req.query);
    const since = new Date(Date.now() - days * 86_400_000);
    // Raw events (fresh, and they carry the failure reason). Index {type: 1, ts: 1}
    const failures = await col("events")
      .find({ type: "checkout_failed", ts: { $gte: since } }, { projection: { ts: 1, props: 1, meta: 1, device: 1 } })
      .sort({ ts: -1 })
      .limit(50)
      .toArray();

    const sessionIds = [...new Set(failures.map((f) => f.meta.sessionId as string))];
    const customerIds = [...new Set(failures.map((f) => f.meta.customerId).filter(Boolean).map(String))];
    const [recovered, users, noteCounts, summaries] = await Promise.all([
      col("events").distinct("meta.sessionId", { type: "order_placed", "meta.sessionId": { $in: sessionIds } }),
      User.find({ _id: { $in: customerIds } }, { name: 1 }).lean(),
      col("session_notes")
        .aggregate([{ $match: { sessionId: { $in: sessionIds } } }, { $group: { _id: "$sessionId", n: { $sum: 1 } } }])
        .toArray(),
      // checkout_failed is a SERVER event (no browser user agent), so take the device from the session
      col("session_summaries").find({ _id: { $in: sessionIds as any[] } }, { projection: { device: 1 } }).toArray(),
    ]);
    const deviceBySession = new Map(summaries.map((s) => [String(s._id), s.device?.type as string | undefined]));
    const names = new Map(users.map((u) => [String(u._id), u.name]));
    const notesBySession = new Map(noteCounts.map((n) => [n._id, n.n]));
    const recoveredSet = new Set(recovered);

    res.json({
      days,
      failures: failures.map((f) => {
        const cid = f.meta.customerId ? String(f.meta.customerId) : null;
        return {
          sessionId: f.meta.sessionId,
          at: f.ts,
          reason: f.props.reason,
          sku: f.props.sku,
          device: f.device?.type ?? deviceBySession.get(f.meta.sessionId),
          customer: cid ? { _id: cid, name: names.get(cid) ?? "(unknown)" } : null,
          recovered: recoveredSet.has(f.meta.sessionId),
          noteCount: notesBySession.get(f.meta.sessionId) ?? 0,
        } satisfies FailedCheckout;
      }),
    });
  });

  // ---- Any order (UC13) ------------------------------------------------------------------------
  router.get("/support/orders/:orderNumber", async (req, res) => {
    const order = await Order.findOne({ orderNumber: String(req.params.orderNumber) }, { __v: 0 }).lean();
    if (!order) throw new HttpError(404, "Order not found");
    res.json(maskOrder(order, req.user!.role));
  });

  // ---- Notes and escalations (UC14) ------------------------------------------------------------
  router.post("/support/sessions/:sessionId/notes", async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!UUID.test(sessionId)) throw new HttpError(400, "Invalid session id");
    const body = parse(z.object({ body: z.string().trim().min(1).max(2000), flagged: z.boolean().default(false) }), req.body);

    // Link the note to the customer (if known), so it shows on their profile and is erased with them
    const summary = await col("session_summaries").findOne({ _id: sessionId as any }, { projection: { customerId: 1 } });
    const customerId =
      summary?.customerId ?? (await col("events").findOne({ "meta.sessionId": sessionId, "meta.customerId": { $ne: null } }, { projection: { meta: 1 } }))?.meta.customerId ?? null;

    const note = {
      sessionId,
      customerId,
      authorId: new ObjectId(req.user!.userId),
      authorName: req.user!.name,
      body: body.body,
      flagged: body.flagged,
      status: "open" as const,
      createdAt: new Date(),
    };
    const { insertedId } = await col("session_notes").insertOne(note);
    res.status(201).json(toNote({ ...note, _id: insertedId }));
  });

  router.patch("/support/notes/:id", async (req, res) => {
    const id = String(req.params.id);
    if (!isValidObjectId(id)) throw new HttpError(400, "Invalid note id");
    const body = parse(z.object({ status: z.enum(["open", "resolved"]).optional(), flagged: z.boolean().optional() }), req.body);
    const set: Record<string, unknown> = { ...body };
    if (body.status === "resolved") Object.assign(set, { resolvedAt: new Date(), resolvedByName: req.user!.name });
    const note = await col("session_notes").findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: set, ...(body.status === "open" && { $unset: { resolvedAt: "", resolvedByName: "" } }) },
      { returnDocument: "after" },
    );
    if (!note) throw new HttpError(404, "Note not found");
    res.json(toNote(note));
  });

  router.get("/support/escalations", async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(["open", "resolved"]).default("open") }), req.query);
    // Index {flagged: 1, status: 1, createdAt: -1}: equality, equality, sort (ESR)
    const notes = await col("session_notes").find({ flagged: true, status }).sort({ createdAt: -1 }).limit(100).toArray();
    const customerIds = [...new Set(notes.map((n) => n.customerId).filter(Boolean).map(String))];
    const users = await User.find({ _id: { $in: customerIds } }, { name: 1 }).lean();
    const names = new Map(users.map((u) => [String(u._id), u.name]));
    res.json({ notes: notes.map((n) => ({ ...toNote(n), customerName: n.customerId ? names.get(String(n.customerId)) : undefined })) });
  });

  return router;
}

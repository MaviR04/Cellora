// Ingest worker: Redis Stream `events:ingest` -> MongoDB time-series collection `events`.
//
//   XREADGROUP (consumer group)  ->  insertMany (batch, w:1)  ->  live counters  ->  XACK
//
// Delivery is AT LEAST ONCE: an entry is acknowledged only after it is safely in MongoDB. If the
// worker crashes in between, the entry stays "pending" and is re-claimed (XAUTOCLAIM) and
// inserted again, so an occasional duplicate is possible (time-series collections cannot have
// unique indexes). That trade-off is documented in data-model §10.
import { hostname } from "node:os";
import type { Redis } from "ioredis";
import { minuteKey } from "@da2/shared";
import { mongoose } from "@da2/shared/server";
import type { AnyBulkWriteOperation, Collection } from "mongodb";

export const STREAM = "events:ingest";
export const GROUP = "ingest-workers";
export const DEAD_LETTER = "events:dead";
const BATCH = 500;
const BLOCK_MS = 2000;
const CLAIM_IDLE_MS = 60_000; // pending for a minute = its consumer probably died
const COUNTER_TTL = 2 * 60 * 60;
const LIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

const consumer = `${hostname()}-${process.pid}`;
const { ObjectId } = mongoose.Types;
const oid = (v: unknown) => (typeof v === "string" && /^[a-f0-9]{24}$/.test(v) ? new ObjectId(v) : v ?? null);


type Entry = [id: string, fields: string[]];

export class Ingestor {
  processed = 0;
  duplicatesSkipped = 0;
  private events: Collection;
  private stopping = false;

  constructor(private redis: Redis) {
    this.events = mongoose.connection.db!.collection("events") as unknown as Collection;
  }

  /** Create the consumer group once. "0" = also process anything already in the stream. */
  async ensureGroup() {
    try {
      await this.redis.xgroup("CREATE", STREAM, GROUP, "0", "MKSTREAM");
      console.log(`created consumer group ${GROUP}`);
    } catch (e: any) {
      if (!String(e.message).includes("BUSYGROUP")) throw e; // already exists
    }
  }

  /**
   * Every worker start registers a new consumer name (host-pid), so old names pile up in
   * XINFO GROUPS. Remove those that have been idle for 10 minutes AND hold no pending entries.
   * (XGROUP DELCONSUMER discards a consumer's pending entries, so never delete one that has any;
   * recoverPending() claims those first.)
   */
  async pruneConsumers() {
    const rows = (await this.redis.xinfo("CONSUMERS", STREAM, GROUP)) as unknown[][];
    for (const row of rows) {
      const c = Object.fromEntries(Array.from({ length: row.length / 2 }, (_, i) => [row[i * 2], row[i * 2 + 1]]));
      if (c.name !== consumer && Number(c.pending) === 0 && Number(c.idle) > 10 * 60_000) {
        await this.redis.xgroup("DELCONSUMER", STREAM, GROUP, String(c.name));
      }
    }
  }

  stop() {
    this.stopping = true;
  }

  async run() {
    await this.ensureGroup();
    await this.recoverPending();
    await this.pruneConsumers();
    let lastClaim = Date.now();
    console.log(`consumer ${consumer} reading ${STREAM}`);
    let retryOwnPending = false;
    while (!this.stopping) {
      try {
        if (retryOwnPending) {
          // After a failure, re-read THIS consumer's delivered-but-unacknowledged entries
          // (id "0" instead of ">") until none are left, then go back to new entries.
          const mine = (await this.redis.xreadgroup("GROUP", GROUP, consumer, "COUNT", BATCH, "STREAMS", STREAM, "0")) as [string, Entry[]][] | null;
          const entries = mine?.[0]?.[1] ?? [];
          if (entries.length) {
            await this.process(entries);
            continue;
          }
          retryOwnPending = false;
          console.log("pending entries re-processed; back to new entries");
        }
        const res = (await this.redis.xreadgroup("GROUP", GROUP, consumer, "COUNT", BATCH, "BLOCK", BLOCK_MS, "STREAMS", STREAM, ">")) as
          | [string, Entry[]][]
          | null;
        if (res) await this.process(res[0][1]);
        if (Date.now() - lastClaim > 30_000) {
          await this.recoverPending();
          lastClaim = Date.now();
        }
      } catch (err) {
        // E.g. no MongoDB primary during a replica set election. The batch was not ACKed, so it
        // stays in this consumer's pending list: wait, then retry it. The worker must not crash.
        console.error(`ingest batch failed, retrying in 2 s: ${err instanceof Error ? err.message : err}`);
        retryOwnPending = true;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  /** Take over entries another (crashed) consumer read but never acknowledged. */
  async recoverPending() {
    let cursor = "0-0";
    do {
      const [next, entries] = (await this.redis.xautoclaim(STREAM, GROUP, consumer, CLAIM_IDLE_MS, cursor, "COUNT", BATCH)) as [string, Entry[], string[]];
      if (entries.length) {
        console.log(`reclaimed ${entries.length} pending entries`);
        await this.process(entries);
      }
      cursor = next;
    } while (cursor !== "0-0");
  }

  async process(entries: Entry[]) {
    const docs: Record<string, any>[] = [];
    const dead: Entry[] = [];

    for (const [id, fields] of entries) {
      try {
        const e = JSON.parse(fields[fields.indexOf("e") + 1]);
        docs.push({
          ...e,
          ts: new Date(e.ts),
          receivedAt: new Date(e.receivedAt),
          meta: { anonymousId: e.meta.anonymousId, sessionId: e.meta.sessionId, customerId: oid(e.meta.customerId) },
          props: { ...e.props, ...(e.props.productId && { productId: oid(e.props.productId) }), ...(e.props.orderId && { orderId: oid(e.props.orderId) }) },
        });
      } catch {
        dead.push([id, fields]); // unparseable: never retry forever
      }
    }

    // Best-effort de-duplication of redelivered entries (the stretch goal in data-model §10):
    // skip eventIds inserted within the last hour. The "seen" marks are written only AFTER a
    // successful insert, so a failed insert is retried rather than lost.
    const fresh: typeof docs = [];
    if (docs.length) {
      const seen = await this.redis.mget(...docs.map((d) => `seen:${d.eventId}`));
      docs.forEach((d, i) => (seen[i] ? this.duplicatesSkipped++ : fresh.push(d)));
    }

    if (fresh.length) {
      // Unordered: one bad document doesn't stop the rest. w:1 = fast, acknowledged by the primary.
      await this.events.insertMany(fresh, { ordered: false, writeConcern: { w: 1 } });
      const marks = this.redis.pipeline();
      for (const d of fresh) marks.set(`seen:${d.eventId}`, "1", "EX", 3600);
      await marks.exec();
      await this.updateLiveCounters(fresh);
      await this.stitchIdentities(fresh);
    }

    if (dead.length) {
      const p = this.redis.pipeline();
      for (const [id, fields] of dead) p.xadd(DEAD_LETTER, "MAXLEN", "~", 10_000, "*", "sourceId", id, ...fields);
      await p.exec();
      console.warn(`moved ${dead.length} unparseable entries to ${DEAD_LETTER}`);
    }

    // Acknowledge only after MongoDB has the data (at-least-once delivery).
    await this.redis.xack(STREAM, GROUP, ...entries.map(([id]) => id));
    this.processed += fresh.length;
  }

  /** UC1 real-time widgets: unique sessions (HyperLogLog) and event counts per minute. */
  private async updateLiveCounters(docs: Record<string, any>[]) {
    const p = this.redis.pipeline();
    const now = Date.now();
    for (const d of docs) {
      if (now - d.ts.getTime() > LIVE_WINDOW_MS) continue; // historical (simulated) data: no live counters
      const m = minuteKey(d.ts);
      p.pfadd(`active:${m}`, d.meta.sessionId).expire(`active:${m}`, COUNTER_TTL);
      p.incr(`evt:${d.type}:${m}`).expire(`evt:${d.type}:${m}`, COUNTER_TTL);
      p.incr(`evt:all:${m}`).expire(`evt:all:${m}`, COUNTER_TTL);
    }
    await p.exec();
  }

  /**
   * Identity stitching (data-model §6): when a browser identifies as a customer, attach the
   * customerId to that browser's earlier anonymous events. Allowed on a time-series collection
   * because the update only touches the metaField. Runs after the batch's insertMany, so events
   * that arrived before the identify event in the stream are already stored.
   */
  private async stitchIdentities(docs: Record<string, any>[]) {
    const ops: AnyBulkWriteOperation[] = docs
      .filter((d) => d.type === "identify" && d.props?.customerId)
      .map((d) => ({
        updateMany: {
          filter: { "meta.anonymousId": d.meta.anonymousId, "meta.customerId": null },
          update: { $set: { "meta.customerId": new ObjectId(d.props.customerId) } },
        },
      }));
    if (ops.length) {
      const r = await this.events.bulkWrite(ops, { ordered: false });
      if (r.modifiedCount) console.log(`identity stitching: linked ${r.modifiedCount} earlier events to customers`);
    }
  }
}

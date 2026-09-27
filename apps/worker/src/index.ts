// Background worker: telemetry ingestion (Phase 5) + rollups (Phase 7).
import { connectMongo, connectRedis, mongoose } from "@da2/shared/server";
import type { Db } from "mongodb";
import { Ingestor } from "./ingest";
import { runRollups } from "./rollups";

await connectMongo();
const db = mongoose.connection.db as unknown as Db;
// XREADGROUP BLOCK holds its connection, so the ingestor gets a dedicated Redis connection.
const ingestRedis = connectRedis();
const redis = connectRedis();
const ingestor = new Ingestor(ingestRedis);

const stats = setInterval(() => {
  if (ingestor.processed) console.log(`ingested ${ingestor.processed} events total (${ingestor.duplicatesSkipped} duplicates skipped)`);
}, 10_000);

// ---- Rollup scheduler -----------------------------------------------------------------------
/** Set by the Admin "rebuild rollups" action (UC6); picked up within 15 seconds. */
export const REBUILD_KEY = "rollups:rebuild";
const OVERLAP_MS = 10 * 60_000; // re-cover the end of the previous window (late-arriving events)
let running = false;
let lastRunAt: Date | null = null;

async function rollup(mode: "full" | "incremental") {
  if (running) return;
  running = true;
  const started = new Date();
  const since = mode === "full" ? new Date(0) : new Date((lastRunAt ?? new Date(Date.now() - 24 * 3_600_000)).getTime() - OVERLAP_MS);
  try {
    const run = await runRollups(db, mode, since);
    lastRunAt = started;
    console.log(`rollups (${mode}) done: ${JSON.stringify(run.durationMs)} ms`);
  } catch (e) {
    console.error("rollups failed:", e);
  } finally {
    running = false;
  }
}

const intervalMin = async () => ((await db.collection<any>("settings").findOne({ _id: "global" }))?.rollupIntervalMin as number) ?? 5;
const empty = (await db.collection("funnel_daily").estimatedDocumentCount()) === 0;
void rollup(empty ? "full" : "incremental");

let nextIncremental = Date.now() + (await intervalMin()) * 60_000;
const scheduler = setInterval(async () => {
  // An async callback's rejection would be unhandled (and crash Node), so catch everything here
  try {
    if (await redis.getdel(REBUILD_KEY)) {
      console.log("rebuild requested by admin");
      await rollup("full");
    } else if (Date.now() >= nextIncremental) {
      await rollup("incremental");
      nextIncremental = Date.now() + (await intervalMin()) * 60_000;
    }
  } catch (err) {
    console.error("rollup scheduler tick failed:", err instanceof Error ? err.message : err);
  }
}, 15_000);

// ---- Lifecycle ------------------------------------------------------------------------------
async function shutdown() {
  console.log("shutting down…");
  ingestor.stop();
  clearInterval(stats);
  clearInterval(scheduler);
  setTimeout(async () => {
    ingestRedis.disconnect();
    redis.disconnect();
    await mongoose.disconnect();
    process.exit(0);
  }, 2500); // let the current XREADGROUP BLOCK return
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await ingestor.run();

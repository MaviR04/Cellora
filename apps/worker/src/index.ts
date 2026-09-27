// Background worker: telemetry ingestion (Phase 5). Rollup jobs are added in Phase 7.
import { connectMongo, connectRedis, mongoose } from "@da2/shared/server";
import { Ingestor } from "./ingest";

await connectMongo();
// XREADGROUP BLOCK holds its connection, so the ingestor gets a dedicated Redis connection.
const redis = connectRedis();
const ingestor = new Ingestor(redis);

const stats = setInterval(() => {
  if (ingestor.processed) console.log(`ingested ${ingestor.processed} events total (${ingestor.duplicatesSkipped} duplicates skipped)`);
}, 10_000);

async function shutdown() {
  console.log("shutting down…");
  ingestor.stop();
  clearInterval(stats);
  setTimeout(async () => {
    redis.disconnect();
    await mongoose.disconnect();
    process.exit(0);
  }, 2500); // let the current XREADGROUP BLOCK return
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await ingestor.run();

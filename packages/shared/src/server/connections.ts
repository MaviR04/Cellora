import mongoose from "mongoose";
import { Redis } from "ioredis";
import { config } from "./config";

/**
 * How long an operation waits for a suitable server (e.g. a primary) before failing. A replica
 * set election after a crashed primary took ~10 s in the failover test (evidence/09-testing), so
 * 20 s lets requests ride out an election instead of failing; longer would only hide a real outage.
 */
const SERVER_SELECTION_TIMEOUT_MS = 20_000;

export async function connectMongo() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS });
  return mongoose.connection;
}

/**
 * Separate connection as the read-only analyst user (reads from secondaries). Any write
 * through this connection is rejected by MongoDB itself, not just by application code.
 */
export async function connectAnalystMongo() {
  return mongoose.createConnection(config.mongoAnalystUri, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS }).asPromise();
}

export function connectRedis() {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
}

export { mongoose };

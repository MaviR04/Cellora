import mongoose from "mongoose";
import { Redis } from "ioredis";
import { config } from "./config";

export async function connectMongo() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  return mongoose.connection;
}

/**
 * Separate connection as the read-only analyst user (reads from secondaries). Any write
 * through this connection is rejected by MongoDB itself, not just by application code.
 */
export async function connectAnalystMongo() {
  return mongoose.createConnection(config.mongoAnalystUri, { serverSelectionTimeoutMS: 10_000 }).asPromise();
}

export function connectRedis() {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
}

export { mongoose };

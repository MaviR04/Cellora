import mongoose from "mongoose";
import { Redis } from "ioredis";
import { config } from "./config";

export async function connectMongo() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  return mongoose.connection;
}

export function connectRedis() {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
}

export { mongoose };

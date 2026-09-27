import { connectMongo, connectRedis } from "@da2/shared/server";

// Stream consumer + rollup jobs are added in Phases 5 and 7.
await connectMongo();
const redis = connectRedis();
console.log("Worker connected to MongoDB and Redis:", await redis.ping());

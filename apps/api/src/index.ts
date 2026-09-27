import express from "express";
import { config, connectMongo, connectRedis } from "@da2/shared/server";

const mongo = await connectMongo();
const redis = connectRedis();

const app = express();
app.use(express.json({ limit: "100kb" }));
app.set("json spaces", 2); // readable JSON in the browser and in evidence screenshots

// Liveness + dependency check: which replica set member is primary, and is Redis reachable.
app.get("/api/health", async (_req, res) => {
  const hello = await mongo.db!.admin().command({ hello: 1 });
  const redisPing = await redis.ping();
  res.json({
    ok: true,
    mongo: { setName: hello.setName, primary: hello.primary, hosts: hello.hosts },
    redis: redisPing,
  });
});

app.listen(config.apiPort, () => {
  console.log(`API listening on http://localhost:${config.apiPort}`);
});

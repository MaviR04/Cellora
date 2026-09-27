import express from "express";
import type { Connection } from "mongoose";
import type { Redis } from "ioredis";
import { catalogRouter } from "./routes/catalog";
import { errorHandler, notFound } from "./lib/http";

export function createApp({ mongo, redis }: { mongo: Connection; redis: Redis }) {
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.set("json spaces", 2); // readable JSON in the browser and in evidence screenshots

  // Liveness + dependency check: which replica set member is primary, and is Redis reachable.
  app.get("/api/health", async (_req, res) => {
    const hello = await mongo.db!.admin().command({ hello: 1 });
    res.json({
      ok: true,
      mongo: { setName: hello.setName, primary: hello.primary, hosts: hello.hosts },
      redis: await redis.ping(),
    });
  });

  app.use("/api", catalogRouter);

  app.use("/api", notFound);
  app.use(errorHandler);
  return app;
}

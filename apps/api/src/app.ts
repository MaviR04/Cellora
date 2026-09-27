import express from "express";
import type { Connection } from "mongoose";
import type { Redis } from "ioredis";
import { catalogRouter } from "./routes/catalog";
import { authRouter } from "./routes/auth";
import { cartRouter } from "./routes/cart";
import { staffRouter } from "./routes/staff";
import { checkoutRouter } from "./routes/checkout";
import { eventsRouter } from "./routes/events";
import { attachSession } from "./middleware/session";
import { errorHandler, notFound } from "./lib/http";

export function createApp({ mongo, redis }: { mongo: Connection; redis: Redis }) {
  const app = express();
  app.use(express.json({ limit: "100kb", type: ["application/json", "text/plain"] }));
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

  app.use(attachSession(redis)); // req.user from the Redis session, req.identity from headers
  app.use("/api", catalogRouter);
  app.use("/api", authRouter(redis));
  app.use("/api", cartRouter(redis));
  app.use("/api", checkoutRouter(redis));
  app.use("/api", eventsRouter(redis));
  app.use("/api", staffRouter(redis));

  app.use("/api", notFound);
  app.use(errorHandler);
  return app;
}

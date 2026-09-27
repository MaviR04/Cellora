// Server-side telemetry: trusted events (order_placed, checkout_failed) are appended to the
// Redis Stream `events:ingest`, the same buffer the browser's events go through (Phase 5).
// The ingest worker moves them into the MongoDB `events` time-series collection.
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { Redis } from "ioredis";
import { serverEventSchema, type ServerEvent } from "@da2/shared";

export const EVENT_STREAM = "events:ingest";
export const STREAM_MAXLEN = 100_000;

type NewServerEvent = { type: ServerEvent["type"]; props: Record<string, unknown> };

export async function emitServerEvent(redis: Redis, req: Request, event: NewServerEvent) {
  const validated = serverEventSchema.parse({ ...event, eventId: randomUUID(), ts: new Date() });
  const stored = {
    ...validated,
    source: "server",
    meta: {
      anonymousId: req.identity.anonymousId ?? null,
      sessionId: req.identity.sessionId ?? null,
      customerId: req.user?.userId ?? null,
    },
    receivedAt: new Date(),
  };
  // MAXLEN ~ trims the stream approximately (cheap) so it can never grow without bound.
  await redis.xadd(EVENT_STREAM, "MAXLEN", "~", STREAM_MAXLEN, "*", "e", JSON.stringify(stored));
}

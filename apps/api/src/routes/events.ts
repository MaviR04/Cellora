// POST /api/events: telemetry ingestion from the browser tracker (UC8–UC11 -> UC1).
//
// The request path does as little as possible: validate, enrich, append to the Redis Stream,
// reply 202 Accepted. Writing to MongoDB happens later in the ingest worker, so a burst of
// traffic never slows the storefront down and MongoDB receives large, efficient batches.
import { Router } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";
import { clientEventSchema, type DeviceType } from "@da2/shared";
import { parse } from "../lib/http";
import { EVENT_STREAM, STREAM_MAXLEN } from "../lib/telemetry";

// navigator.sendBeacon (used when the tab is closing) cannot set custom headers, so identity
// travels in the body. customerId is NOT accepted from the client; it comes from the session.
const batchBody = z.object({
  anonymousId: z.uuid(),
  sessionId: z.uuid(),
  events: z.array(z.unknown()).min(1).max(50),
});

/** Very small user-agent classifier; enough for device/OS/browser breakdowns. */
function parseDevice(ua = "") {
  const type: DeviceType = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|iPhone|Android/i.test(ua) ? "mobile" : "desktop";
  const os = /Windows/i.test(ua) ? "Windows" : /iPhone|iPad|iOS/i.test(ua) ? "iOS" : /Android/i.test(ua) ? "Android" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Other";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Other";
  return { type, os, browser };
}

export function eventsRouter(redis: Redis) {
  const router = Router();

  router.post("/events", async (req, res) => {
    const body = parse(batchBody, req.body);
    const meta = { anonymousId: body.anonymousId, sessionId: body.sessionId, customerId: req.user?.userId ?? null };
    const device = parseDevice(req.headers["user-agent"]);
    const receivedAt = new Date();

    // Validate each event on its own: one malformed event shouldn't drop the whole batch.
    const pipeline = redis.pipeline();
    let accepted = 0;
    const rejected: { index: number; error: string }[] = [];
    body.events.forEach((raw, index) => {
      const result = clientEventSchema.safeParse(raw);
      if (!result.success) {
        rejected.push({ index, error: z.prettifyError(result.error) });
        return;
      }
      const stored = { ...result.data, source: "client", meta, device, receivedAt };
      pipeline.xadd(EVENT_STREAM, "MAXLEN", "~", STREAM_MAXLEN, "*", "e", JSON.stringify(stored));
      accepted++;
    });
    // One round trip to Redis for the whole batch.
    if (accepted) await pipeline.exec();
    res.status(202).json({ accepted, rejected });
  });

  return router;
}

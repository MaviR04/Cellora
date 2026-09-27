// Analyst endpoints (UC1–UC3). Every query here runs on the READ-ONLY analyst connection
// (da2_analyst, readPreference secondaryPreferred): it reads from a secondary to keep load off
// the primary, and MongoDB itself would reject any write.
import { Router } from "express";
import type { Redis } from "ioredis";
import type { Connection } from "mongoose";
import { z } from "zod";
import { FUNNEL_STEPS, type FunnelResponse } from "@da2/shared";
import { parse } from "../lib/http";
import { cached } from "../lib/cache";
import { requireRole } from "../middleware/session";

const CACHE_TTL = 60;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const localDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

export function analyticsRouter(redis: Redis, analyst: Connection) {
  const router = Router();
  router.use("/analytics", requireRole("analyst", "admin"));

  // UC2: ordered purchase funnel over a date range, from the funnel_daily rollup, cached 60 s.
  router.get("/analytics/funnel", async (req, res) => {
    const q = parse(
      z.object({
        from: day.default(() => localDate(new Date(Date.now() - 13 * 86_400_000))),
        to: day.default(() => localDate(new Date())),
        device: z.enum(["mobile", "desktop", "tablet"]).optional(),
      }),
      req.query,
    );

    const { value, hit } = await cached(redis, "funnel", q, CACHE_TTL, async () => {
      // Index: the compound _id {day, funnel} -> a range scan over at most a few dozen documents
      const days = await analyst.db!
        .collection("funnel_daily")
        .find({ "_id.funnel": "purchase", "_id.day": { $gte: q.from, $lte: q.to } })
        .sort({ "_id.day": 1 })
        .toArray();

      const series = (d: any) => (q.device ? d.byDevice?.[q.device] ?? [] : d.steps).map((s: any) => s.sessions as number);
      const byDay = days.map((d: any) => ({ day: d._id.day as string, steps: FUNNEL_STEPS.map((_, i) => series(d)[i] ?? 0) }));
      const totals = FUNNEL_STEPS.map((_, i) => byDay.reduce((n, d) => n + d.steps[i], 0));
      const byDevice: Record<string, number[]> = {};
      for (const d of days as any[]) {
        for (const [device, steps] of Object.entries<any[]>(d.byDevice ?? {})) {
          byDevice[device] ??= FUNNEL_STEPS.map(() => 0);
          steps.forEach((s, i) => (byDevice[device][i] += s.sessions));
        }
      }
      const result: Omit<FunnelResponse, "cached"> = {
        ...q,
        device: q.device ?? null,
        steps: FUNNEL_STEPS.map((step, i) => ({
          step,
          sessions: totals[i],
          fromPrevious: i === 0 ? 1 : totals[i - 1] ? totals[i] / totals[i - 1] : 0,
          fromStart: totals[0] ? totals[i] / totals[0] : 0,
        })),
        byDay,
        byDevice,
        source: "rollup",
        computedAt: new Date().toISOString(),
      };
      return result;
    });

    res.json({ ...value, cached: hit } satisfies FunnelResponse);
  });

  return router;
}

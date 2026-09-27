# Dashboard API response times: Redis cache miss vs hit

- **Captured:** 2026-09-27T19:33:15.438Z
- **Shows:** Every analyst endpoint sits behind the Redis read-through cache (5 s TTL for live, 60 s for the rest). The raw-events aggregation is the slowest on a miss, which is why the pre-aggregated rollups exist; a cache hit costs a few milliseconds whatever the source.
- **Report section:** 8. Strengths: performance; caching
- **Command:** `HTTP GET as the analyst, after deleting cache:{name}:* (miss), then again (hit)`

```text
endpoint                          source                            miss      hit
/analytics/live                   Redis counters + latest events    32 ms     7.0 ms (cached)
/analytics/funnel                 funnel_daily rollup               6 ms      2.7 ms (cached)
/analytics/trends                 metrics_hourly rollup             72 ms     7.4 ms (cached)
/analytics/top                    raw events aggregation            112 ms    2.9 ms (cached)
```

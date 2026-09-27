# Funnel: raw events vs rollup vs Redis cache

- **Captured:** 2026-09-27T19:06:35.450Z
- **Shows:** The same 14-day ordered funnel computed three ways. The rollup gives identical numbers to the raw aggregation but reads 14 small documents instead of 93,994 events; the Redis cache avoids MongoDB entirely.
- **Report section:** 9. Strengths: pre-aggregation & caching / 11. Evaluation: performance
- **Command:** `median of repeated runs; API = GET /analytics/funnel?from=2026-09-15&to=2026-09-28 as analyst (includes HTTP + session lookup)`

```text
correctness (sessions reaching each step, in order)
  step                 raw events   rollup   match
  product_view               9788     9788   yes
  add_to_cart                1565     1565   yes
  checkout_started            753      753   yes
  order_placed                574      574   yes

speed
  raw ordered-funnel pipeline over 93,994 events       144 ms
  read 14 funnel_daily docs (analyst, secondary)          2.2 ms   (65x faster)
  API, cache miss (rollup + JSON + store in Redis)        14 ms
  API, cache hit (Redis only)                            2.5 ms
  bare Redis GET of the cached result                    0.2 ms

The raw pipeline's cost grows with the number of events; the rollup's cost grows only with
the number of days. The price: rollups are recomputed every 5 minutes (stale by up to one
interval) and the cache adds up to 60 s more (eventual consistency, accepted for analytics).
```

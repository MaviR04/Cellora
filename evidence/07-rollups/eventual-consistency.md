# Eventual consistency: raw events vs rollup

- **Captured:** 2026-09-27T19:06:36.935Z
- **Shows:** A new order reaches the raw events collection within about a second (via the stream and worker) but the funnel rollup still shows the old number until its next run. After the rollup runs, both agree. This is the staleness window accepted for analytics.
- **Report section:** 7. Characteristics: eventual consistency (BASE)
- **Command:** `count today's ordered-funnel orders from raw events and from funnel_daily, before and after one new order`

```text
                                   raw events   funnel_daily rollup
before the new order                        8           8
new order ORD-20260928-0049                9           8   <- rollup is stale
after the next rollup run                   9           9   <- consistent again
```

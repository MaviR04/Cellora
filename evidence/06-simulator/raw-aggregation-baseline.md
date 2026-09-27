# Baseline: funnel counts computed from raw events

- **Captured:** 2026-09-27T18:55:47.242Z
- **Shows:** Sessions reaching each funnel step, computed by scanning every raw event: median 94 ms over 5 runs on 99,233 events. This is the baseline the Phase 7 rollups and Redis cache are compared against.
- **Report section:** 9. Strengths / 11. Evaluation: performance
- **Command:** `db.events.aggregate([$match funnel types, $group by session+type, $group by type])  (median of 5 runs)`

```text
product_view        10332 sessions
add_to_cart          1650 sessions   (16.0% of previous step)
checkout_started      796 sessions   (48.2% of previous step)
order_placed          609 sessions   (76.5% of previous step)

overall: 5.89% of sessions that viewed a product placed an order
median query time: 94 ms (full scan of 99,233 events; grows linearly with data)
```

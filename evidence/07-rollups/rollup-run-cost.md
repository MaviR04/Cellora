# Rollup run cost: full rebuild vs incremental

- **Captured:** 2026-09-27T19:06:36.220Z
- **Shows:** Each rollup is an aggregation ending in $merge (upsert into the target collection). The worker runs them incrementally every 5 minutes, recomputing only the recent window, so the cost stays small as history grows. A full rebuild is only needed after a logic change (Admin: UC6).
- **Report section:** 6. Implementation: rollups / 11. Evaluation
- **Command:** `rollupSessions / rollupHourly / rollupFunnel with since = epoch (full) and since = 1 hour ago (incremental)`

```text
rollup               documents   full rebuild   incremental (last hour)
session_summaries        12984         403 ms          15 ms
metrics_hourly            2601         144 ms         3.5 ms
funnel_daily                15         178 ms          20 ms
```

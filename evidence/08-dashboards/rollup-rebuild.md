# Admin-triggered full rollup rebuild (UC6)

- **Captured:** 2026-09-27T19:33:19.460Z
- **Shows:** The API only sets a flag in Redis (it returns 202 at once); the worker's scheduler picks it up with GETDEL within 15 s and recomputes every materialised view from all raw events.
- **Report section:** 6. Implementation: pre-aggregated views (UC6)
- **Command:** `POST /api/admin/rollups/rebuild · GET rollups:rebuild · db.settings.findOne({_id:'rollups'})`

```text
POST /admin/rollups/rebuild -> 202 {"ok":true,"message":"The worker will run a full rebuild within 15 seconds."}
Redis rollups:rebuild       -> 2026-09-27T19:33:15.864Z
worker finished full rebuild 3.3 s after the request (run started then)
durations (ms):              {"session_summaries":539,"metrics_hourly":179,"funnel_daily":165}
```

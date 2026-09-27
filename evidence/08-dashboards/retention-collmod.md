# Data retention setting changes the time-series TTL (UC5)

- **Captured:** 2026-09-27T19:33:15.857Z
- **Shows:** Saving the retention setting runs collMod on the events time-series collection. MongoDB then drops whole buckets once all their events are older than the limit: no cron job, no batch deletes in application code.
- **Report section:** 6. Implementation: retention (UC5); 7. time-series collections
- **Command:** `PATCH /api/admin/settings {eventRetentionDays} → db.runCommand({collMod:'events', expireAfterSeconds}) · db.getCollectionInfos({name:'events'})`

```text
before:              expireAfterSeconds = 7776000 (90 days)
PATCH 60 days:       200; settings.eventRetentionDays = 60
MongoDB now:         expireAfterSeconds = 5184000 (60 days)
PATCH 90 days:       restored, expireAfterSeconds = 7776000
```

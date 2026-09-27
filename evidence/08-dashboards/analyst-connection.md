# Analyst dashboards read from a secondary, as a read-only user

- **Captured:** 2026-09-27T20:06:36.707Z
- **Shows:** The analyst connection (da2_analyst, readPreference secondaryPreferred) is served by a secondary member, so dashboard load stays off the primary that handles checkouts. A write through it is rejected by MongoDB itself.
- **Report section:** 7. Characteristics: replication & read scaling; security
- **Command:** `analyst.funnel_daily.find(...).explain(); analyst.funnel_daily.insertOne(...)`

```text
replica set primary:               host.docker.internal:27017
analyst query was served by:       62e25768437a:27019
analyst connection readPreference: secondaryPreferred

insert through the analyst connection -> not authorized
```

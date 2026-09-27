# Database-level access control

- **Captured:** 2026-09-27T12:05:23.175Z
- **Shows:** MongoDB itself enforces roles: the analyst login can read but every write is rejected, and unauthenticated connections are refused.
- **Report section:** 7. Characteristics: security model (UC4)
- **Command:** `connectionStatus + attempted operations per user`

```text
app user (da2_app) roles:          clusterMonitor@admin, dbAdmin@da2, readWrite@da2
analyst user (da2_analyst) roles:  read@da2

analyst: read settings                       ALLOWED
analyst: insert into settings                REJECTED (Unauthorized)
analyst: drop events collection              REJECTED (Unauthorized)
no credentials: read products                REJECTED (Unauthorized)
```
